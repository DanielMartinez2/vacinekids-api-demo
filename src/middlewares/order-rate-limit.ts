import { rateLimit } from "express-rate-limit";

const message = {
  data: null,
  error: { code: "RATE_LIMITED", message: "Muitas solicitações. Tente novamente mais tarde." }
};

export type OrderRateLimitOptions = {
  windowMs?: number;
  previewLimit?: number;
  mutationLimit?: number;
};

// MemoryStore is intentionally process-local. Idempotency remains the correctness boundary.
export const createOrderRateLimits = (options: OrderRateLimitOptions = {}) => {
  const common = {
    windowMs: options.windowMs ?? 15 * 60 * 1000,
    standardHeaders: "draft-8" as const,
    legacyHeaders: false,
    message,
    keyGenerator: (req: Express.Request) => req.auth!.id
  };
  return {
    preview: rateLimit({ ...common, limit: options.previewLimit ?? 60 }),
    mutation: rateLimit({ ...common, limit: options.mutationLimit ?? 10 })
  };
};
