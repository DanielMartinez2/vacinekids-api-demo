import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth";
import type { AuthService } from "../auth/auth.service";
import {
  catalogListQuerySchema,
  createAgeRangeSchema,
  createPackageSchema,
  createVaccineSchema,
  idParamsSchema,
  packageListQuerySchema,
  updateAgeRangeSchema,
  updatePackageSchema,
  updateVaccineSchema,
  vaccineListQuerySchema
} from "./catalog.schemas";
import { catalogService } from "./catalog.service";

export const createCatalogRouter = (service: AuthService, environment: string) => {
  const catalogRouter = Router();
  const authenticate = requireAuth(service, environment);
  const admin = requireRole("ADMIN");
  catalogRouter.use((req, _res, next) => {
    const needsAdmin = !["GET", "HEAD", "OPTIONS"].includes(req.method) || req.query.includeDeleted === "true";
    if (!needsAdmin) return next();
    // Express 5 propagates a rejected promise returned by this middleware.
    return authenticate(req, _res, error => error ? next(error) : admin(req, _res, next));
  });

  const success = <T>(data: T, meta?: unknown) => ({ data, ...(meta ? { meta } : {}), error: null });

  catalogRouter.get("/vaccines", async (req, res) => {
    const query = vaccineListQuerySchema.parse(req.query);
    const result = await catalogService.listVaccines(query);
    res.status(200).json(success(result.items, result.meta));
  });

  catalogRouter.get("/vaccines/:id", async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.status(200).json(success(await catalogService.getVaccine(id)));
  });

  catalogRouter.post("/vaccines", async (req, res) => {
    const input = createVaccineSchema.parse(req.body);
    res.status(201).json(success(await catalogService.createVaccine(input)));
  });

  catalogRouter.patch("/vaccines/:id", async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = updateVaccineSchema.parse(req.body);
    res.status(200).json(success(await catalogService.updateVaccine(id, input)));
  });

  catalogRouter.delete("/vaccines/:id", async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    await catalogService.deleteVaccine(id);
    res.status(204).send();
  });

  catalogRouter.get("/packages", async (req, res) => {
    const query = packageListQuerySchema.parse(req.query);
    const result = await catalogService.listPackages(query);
    res.status(200).json(success(result.items, result.meta));
  });

  catalogRouter.get("/packages/:id", async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.status(200).json(success(await catalogService.getPackage(id)));
  });

  catalogRouter.post("/packages", async (req, res) => {
    const input = createPackageSchema.parse(req.body);
    res.status(201).json(success(await catalogService.createPackage(input)));
  });

  catalogRouter.patch("/packages/:id", async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = updatePackageSchema.parse(req.body);
    res.status(200).json(success(await catalogService.updatePackage(id, input)));
  });

  catalogRouter.delete("/packages/:id", async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    await catalogService.deletePackage(id);
    res.status(204).send();
  });

  catalogRouter.get("/age-ranges", async (req, res) => {
    const query = catalogListQuerySchema.parse(req.query);
    const result = await catalogService.listAgeRanges(query);
    res.status(200).json(success(result.items, result.meta));
  });

  catalogRouter.get("/age-ranges/:id", async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    res.status(200).json(success(await catalogService.getAgeRange(id)));
  });

  catalogRouter.post("/age-ranges", async (req, res) => {
    const input = createAgeRangeSchema.parse(req.body);
    res.status(201).json(success(await catalogService.createAgeRange(input)));
  });

  catalogRouter.patch("/age-ranges/:id", async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = updateAgeRangeSchema.parse(req.body);
    res.status(200).json(success(await catalogService.updateAgeRange(id, input)));
  });

  catalogRouter.delete("/age-ranges/:id", async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    await catalogService.deleteAgeRange(id);
    res.status(204).send();
  });
  return catalogRouter;
};
