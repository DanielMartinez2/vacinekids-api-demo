import assert from "node:assert/strict";
import test from "node:test";
import {
  createPaymentAttemptSchema,
  paymentIdempotencyKeySchema,
  paymentOrderParamsSchema
} from "./payments.schemas";

test("payment attempt body accepts only an empty strict object", () => {
  assert.deepEqual(createPaymentAttemptSchema.parse({}), {});
  for (const body of [{ amount: "0.01" }, { status: "APPROVED" }, { method: "DEMO" }, { approved: true }]) {
    assert.equal(createPaymentAttemptSchema.safeParse(body).success, false);
  }
});
test("payment identifiers require canonical UUIDs", () => {
  const upper = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
  assert.equal(paymentIdempotencyKeySchema.parse(upper), upper.toLowerCase());
  assert.equal(paymentOrderParamsSchema.parse({ orderId: upper }).orderId, upper.toLowerCase());
  assert.equal(paymentIdempotencyKeySchema.safeParse("not-a-uuid").success, false);
});
