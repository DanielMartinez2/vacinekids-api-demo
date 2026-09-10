import { Router } from "express";
import { HttpError } from "../../lib/http-error";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { createOrderRateLimits, type OrderRateLimitOptions } from "../../middlewares/order-rate-limit";
import type { AuthService } from "../auth/auth.service";
import {
  cancelOrderSchema,
  checkoutPreviewSchema,
  createOrderSchema,
  idempotencyKeySchema,
  orderIdParamsSchema,
  orderListQuerySchema
} from "./orders.schemas";
import type { OrderService } from "./orders.service";

const success = <T>(data: T, meta?: unknown) => ({
  data,
  ...(meta ? { meta } : {}),
  error: null
});

const readIdempotencyKey = (value: string | undefined) => {
  if (!value) {
    throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED", "O header Idempotency-Key é obrigatório.");
  }
  const result = idempotencyKeySchema.safeParse(value);
  if (!result.success) {
    throw new HttpError(422, "IDEMPOTENCY_KEY_INVALID", "O header Idempotency-Key deve ser um UUID válido.");
  }
  return result.data;
};

export const createOrdersRouter = (
  authService: AuthService,
  orderService: OrderService,
  environment: string,
  rateLimitOptions?: OrderRateLimitOptions
) => {
  const router = Router();
  const checkoutRouter = Router();
  const ordersRouter = Router();
  const limits = createOrderRateLimits(rateLimitOptions);
  const protect = (resourceRouter: ReturnType<typeof Router>) => {
    resourceRouter.use(requireAuth(authService, environment));
    resourceRouter.use(requireRole("CUSTOMER"));
  };
  protect(checkoutRouter);
  protect(ordersRouter);

  checkoutRouter.post("/preview", limits.preview, async (req, res) => {
    const input = checkoutPreviewSchema.parse(req.body);
    res.status(200).json(success(await orderService.preview(req.auth!.id, input)));
  });

  ordersRouter.post("/", (req, res, next) => {
    res.locals.idempotencyKey = readIdempotencyKey(req.get("Idempotency-Key"));
    res.locals.orderInput = createOrderSchema.parse(req.body);
    next();
  }, limits.mutation, async (req, res) => {
    const result = await orderService.create(req.auth!.id, res.locals.idempotencyKey, res.locals.orderInput);
    res.status(result.replay ? 200 : 201).json(success(result.order));
  });

  ordersRouter.get("/", async (req, res) => {
    const query = orderListQuerySchema.parse(req.query);
    const result = await orderService.list(req.auth!.id, query);
    res.status(200).json(success(result.items, result.meta));
  });

  ordersRouter.get("/:id", async (req, res) => {
    const { id } = orderIdParamsSchema.parse(req.params);
    res.status(200).json(success(await orderService.detail(req.auth!.id, id)));
  });

  ordersRouter.post("/:id/cancel", limits.mutation, async (req, res) => {
    const { id } = orderIdParamsSchema.parse(req.params);
    cancelOrderSchema.parse(req.body);
    res.status(200).json(success(await orderService.cancel(req.auth!.id, id)));
  });

  router.use("/checkout", checkoutRouter);
  router.use("/orders", ordersRouter);
  return router;
};
