import { z } from "zod";

export type ProviderAttemptInput = {
  attemptId: string;
  providerIdempotencyKey: string;
  amount: string;
  currency: "BRL";
  method: "DEMO";
  externalReference: string;
};

const normalizedProviderResultSchema = z.strictObject({
  providerPaymentId: z.string().trim().min(1).max(128).nullable().optional(),
  status: z.enum(["APPROVED", "REJECTED", "PROCESSING", "ERROR", "CANCELLED", "EXPIRED"]),
  providerStatus: z.string().trim().min(1).max(64).nullable().optional(),
  providerStatusDetail: z.string().trim().min(1).max(128).nullable().optional(),
  expiresAt: z.date().nullable().optional()
});

export type NormalizedProviderResult = z.infer<typeof normalizedProviderResultSchema>;

export interface PaymentProviderAdapter {
  readonly provider: "DEMO";
  readonly method: "DEMO";
  isAvailable(): boolean;
  createOrResumeAttempt(input: ProviderAttemptInput): Promise<unknown>;
  getAttemptStatus(input: ProviderAttemptInput): Promise<unknown>;
}

export type PaymentProviderFailureKind = "DEFINITIVE" | "TIMEOUT" | "UNKNOWN";

export class PaymentProviderFailure extends Error {
  constructor(public readonly kind: PaymentProviderFailureKind, message = "Payment provider failure") {
    super(message);
    this.name = "PaymentProviderFailure";
  }
}

export const parseProviderResult = (value: unknown) => normalizedProviderResultSchema.parse(value);
