import { rateLimit } from "express-rate-limit";

const message = {
  data: null,
  error: { code: "RATE_LIMITED", message: "Muitas solicitações. Tente novamente mais tarde." }
};

export type PaymentRateLimitOptions = {
  windowMs?: number;
  attemptLimit?: number;
  readLimit?: number;
};

// MemoryStore is process-local; database locks and constraints remain the financial boundary.
export const createPaymentRateLimits = (options: PaymentRateLimitOptions = {}) => {
  const common = {
    windowMs: options.windowMs ?? 15 * 60 * 1000,
    standardHeaders: "draft-8" as const,
    legacyHeaders: false,
    message,
    keyGenerator: (req: Express.Request) => req.auth!.id
  };
  return {
    attempt: rateLimit({ ...common, limit: options.attemptLimit ?? 10 }),
    read: rateLimit({ ...common, limit: options.readLimit ?? 60 })
  };
};
