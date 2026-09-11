import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { DemoPaymentProvider } from "./demo-payment-provider";

const input = (providerIdempotencyKey: string) => ({
  attemptId: randomUUID(),
  providerIdempotencyKey,
  amount: "10.00",
  currency: "BRL" as const,
  method: "DEMO" as const,
  externalReference: randomUUID()
});

test("DEMO availability is explicit and disabled safely", () => {
  assert.equal(new DemoPaymentProvider(false).isAvailable(), false);
  assert.equal(new DemoPaymentProvider(true).isAvailable(), true);
});

test("DEMO deterministically approves the same provider key without network or randomness", async () => {
  const provider = new DemoPaymentProvider(true);
  const key = randomUUID();
  const first = await provider.createOrResumeAttempt(input(key));
  const second = await new DemoPaymentProvider(true).createOrResumeAttempt(input(key));
  assert.deepEqual(first, second);
  assert.equal((first as { status: string }).status, "APPROVED");
  assert.match((first as { providerPaymentId: string }).providerPaymentId, /^demo_[0-9a-f]{40}$/);
});

test("DEMO produces different provider IDs for different provider keys", async () => {
  const provider = new DemoPaymentProvider(true);
  const first = await provider.createOrResumeAttempt(input(randomUUID()));
  const second = await provider.createOrResumeAttempt(input(randomUUID()));
  assert.notEqual((first as { providerPaymentId: string }).providerPaymentId,
    (second as { providerPaymentId: string }).providerPaymentId);
});
