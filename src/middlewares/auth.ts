import type { RequestHandler } from "express";
import { HttpError } from "../lib/http-error";
import { readSessionCookie } from "../modules/auth/auth.cookies";
import type { AuthService, PublicUser } from "../modules/auth/auth.service";
import { unauthenticated } from "../modules/auth/auth.service";

declare global {
  namespace Express { interface Request { auth?: PublicUser } }
}

export const requireAuth = (service: AuthService, environment: string): RequestHandler => async (req, _res, next) => {
  req.auth = await service.authenticate(readSessionCookie(req, environment));
  next();
};

export const requireRole = (role: PublicUser["role"]): RequestHandler => (req, _res, next) => {
  if (!req.auth) throw unauthenticated();
  if (req.auth.role !== role) throw new HttpError(403, "FORBIDDEN", "Permissão insuficiente.");
  next();
};
