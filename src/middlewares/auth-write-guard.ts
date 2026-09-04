import type { RequestHandler } from "express";
import { HttpError } from "../lib/http-error";

export const writeGuard = (origin: string): RequestHandler => (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("Origin") !== origin || req.get("X-VacineKids-CSRF") !== "1") {
    throw new HttpError(403, "INVALID_ORIGIN_OR_CSRF", "Origem ou proteção CSRF inválida.");
  }
  const hasBody = req.get("transfer-encoding") !== undefined || Number(req.get("content-length") ?? 0) > 0;
  if ((hasBody || req.method === "POST" || req.method === "PATCH") && !req.is("application/json")) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Utilize application/json.");
  }
  next();
};
