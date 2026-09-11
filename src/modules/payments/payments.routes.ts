import { Router } from "express";
import { HttpError } from "../../lib/http-error";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { createPaymentRateLimits, type PaymentRateLimitOptions } from "../../middlewares/payment-rate-limit";
import type { AuthService } from "../auth/auth.service";
import {
  createPaymentAttemptSchema,
  paymentIdempotencyKeySchema,
  paymentOrderParamsSchema
} from "./payments.schemas";
import type { PaymentService } from "./payments.service";

const success = <T>(data: T) => ({ data, error: null });

const readIdempotencyKey = (value: string | undefined) => {
  if (!value) {
    throw new HttpError(400, "PAYMENT_IDEMPOTENCY_KEY_REQUIRED", "O header Idempotency-Key é obrigatório.");
  }
  const result = paymentIdempotencyKeySchema.safeParse(value);
  if (!result.success) {
    throw new HttpError(422, "PAYMENT_IDEMPOTENCY_KEY_INVALID", "O header Idempotency-Key deve ser um UUID válido.");
  }
  return result.data;
};

export const createPaymentsRouter = (
  authService: AuthService,
  paymentService: PaymentService,
  environment: string,
  rateLimitOptions?: PaymentRateLimitOptions
) => {
  const router = Router();
  const limits = createPaymentRateLimits(rateLimitOptions);
  const authenticate = requireAuth(authService, environment);
  const authorizeCustomer = requireRole("CUSTOMER");

  router.get("/:orderId/payment", authenticate, authorizeCustomer, limits.read, async (req, res) => {
    const { orderId } = paymentOrderParamsSchema.parse(req.params);
    res.status(200).json(success(await paymentService.get(req.auth!.id, orderId)));
  });

  router.post("/:orderId/payment-attempts", authenticate, authorizeCustomer, (req, res, next) => {
    res.locals.paymentIdempotencyKey = readIdempotencyKey(req.get("Idempotency-Key"));
    createPaymentAttemptSchema.parse(req.body);
    next();
  }, limits.attempt, async (req, res) => {
    const { orderId } = paymentOrderParamsSchema.parse(req.params);
    const result = await paymentService.createAttempt(req.auth!.id, orderId, res.locals.paymentIdempotencyKey);
    res.status(result.replay ? 200 : 201).json(success(result.payment));
  });

  return router;
};
