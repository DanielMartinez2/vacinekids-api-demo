import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth";
import type { AuthService } from "../auth/auth.service";
import {
  createDependentSchema,
  dependentIdParamsSchema,
  dependentListQuerySchema,
  profileInputSchema,
  updateDependentSchema
} from "./customer.schemas";
import type { CustomerService } from "./customer.service";

export const createCustomerRouter = (
  authService: AuthService,
  customerService: CustomerService,
  environment: string
) => {
  const router = Router();
  const profileRouter = Router();
  const dependentsRouter = Router();
  const protect = (resourceRouter: ReturnType<typeof Router>) => {
    resourceRouter.use(requireAuth(authService, environment));
    resourceRouter.use(requireRole("CUSTOMER"));
  };
  protect(profileRouter);
  protect(dependentsRouter);

  const success = <T>(data: T, meta?: unknown) => ({
    data,
    ...(meta ? { meta } : {}),
    error: null
  });

  profileRouter.get("/", async (req, res) => {
    res.status(200).json(success(await customerService.getProfile(req.auth!.id)));
  });

  profileRouter.put("/", async (req, res) => {
    const input = profileInputSchema.parse(req.body);
    res.status(200).json(success(await customerService.upsertProfile(req.auth!.id, input)));
  });

  dependentsRouter.get("/", async (req, res) => {
    const query = dependentListQuerySchema.parse(req.query);
    const result = await customerService.listDependents(req.auth!.id, query);
    res.status(200).json(success(result.items, result.meta));
  });

  dependentsRouter.post("/", async (req, res) => {
    const input = createDependentSchema.parse(req.body);
    res.status(201).json(success(await customerService.createDependent(req.auth!.id, input)));
  });

  dependentsRouter.get("/:id", async (req, res) => {
    const { id } = dependentIdParamsSchema.parse(req.params);
    res.status(200).json(success(await customerService.getDependent(req.auth!.id, id)));
  });

  dependentsRouter.patch("/:id", async (req, res) => {
    const { id } = dependentIdParamsSchema.parse(req.params);
    const input = updateDependentSchema.parse(req.body);
    res.status(200).json(success(await customerService.updateDependent(req.auth!.id, id, input)));
  });

  dependentsRouter.delete("/:id", async (req, res) => {
    const { id } = dependentIdParamsSchema.parse(req.params);
    await customerService.deleteDependent(req.auth!.id, id);
    res.status(204).send();
  });

  router.use("/profile", profileRouter);
  router.use("/dependents", dependentsRouter);
  return router;
};
