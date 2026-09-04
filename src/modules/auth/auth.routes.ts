import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { createAuthRateLimits } from "../../middlewares/auth-rate-limit";
import { clearSessionCookie, readSessionCookie, setSessionCookie } from "./auth.cookies";
import { loginSchema, logoutSchema, registerSchema } from "./auth.schemas";
import type { AuthService } from "./auth.service";

export const REGISTER_MESSAGE = "Solicitação processada. Você já pode tentar entrar com os dados informados.";
export const createAuthRouter = (service: AuthService, environment: string) => {
  const router = Router();
  const limits = createAuthRateLimits();
  router.post("/register", limits.registerIp, async (req, res) => {
    await service.register(registerSchema.parse(req.body));
    res.status(200).json({ data: { message: REGISTER_MESSAGE }, error: null });
  });
  router.post("/login", limits.loginIp, limits.loginIdentity, async (req, res) => {
    const result = await service.login(loginSchema.parse(req.body), readSessionCookie(req, environment));
    setSessionCookie(res, result.token, environment);
    res.status(200).json({ data: result.user, error: null });
  });
  router.post("/logout", async (req, res) => {
    logoutSchema.parse(req.body ?? {});
    await service.logout(readSessionCookie(req, environment));
    clearSessionCookie(res, environment);
    res.status(204).send();
  });
  router.get("/me", requireAuth(service, environment), (req, res) => {
    res.status(200).json({ data: req.auth, error: null });
  });
  return router;
};
