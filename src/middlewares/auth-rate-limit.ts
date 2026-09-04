import { createHmac, randomBytes } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { emailSchema } from "../modules/auth/auth.schemas";

// A new set of memory stores per app instance; no process-global test bypass.
export const createAuthRateLimits = () => {
  const identityKey = randomBytes(32);
  const common = {
    standardHeaders: "draft-8" as const, legacyHeaders: false,
    message: { data: null, error: { code: "RATE_LIMITED", message: "Muitas tentativas. Tente novamente mais tarde." } }
  };
  return {
    loginIp: rateLimit({ ...common, windowMs: 15 * 60 * 1000, limit: 50 }),
    loginIdentity: rateLimit({ ...common, windowMs: 15 * 60 * 1000, limit: 10,
      skipSuccessfulRequests: true,
      requestWasSuccessful: (_req, res) => res.statusCode !== 401,
      keyGenerator: req => {
        const email = emailSchema.safeParse(req.body?.email);
        return createHmac("sha256", identityKey).update(email.success ? email.data : "invalid-input").digest("hex");
      }
    }),
    registerIp: rateLimit({ ...common, windowMs: 60 * 60 * 1000, limit: 5 })
  };
};
