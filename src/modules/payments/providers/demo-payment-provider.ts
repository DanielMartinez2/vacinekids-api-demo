import { createHash } from "node:crypto";
import type { PaymentProviderAdapter, ProviderAttemptInput } from "../payments.provider";

const resultFor = (input: ProviderAttemptInput) => ({
  providerPaymentId: `demo_${createHash("sha256").update(input.providerIdempotencyKey).digest("hex").slice(0, 40)}`,
  status: "APPROVED" as const,
  providerStatus: "approved",
  providerStatusDetail: "demo_approved",
  expiresAt: null
});

export class DemoPaymentProvider implements PaymentProviderAdapter {
  readonly provider = "DEMO" as const;
  readonly method = "DEMO" as const;

  constructor(private readonly enabled: boolean) {}

  isAvailable() {
    return this.enabled;
  }

  async createOrResumeAttempt(input: ProviderAttemptInput) {
    return resultFor(input);
  }

  async getAttemptStatus(input: ProviderAttemptInput) {
    return resultFor(input);
  }
}
