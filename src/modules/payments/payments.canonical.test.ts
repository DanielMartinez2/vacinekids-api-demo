import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "../../../generated/prisma/client";
import { canonicalizePaymentIntent, paymentRequestHash } from "./payments.canonical";

test("payment intent canonicalizes UUID, Decimal, BRL and field order deterministically", () => {
  const intent = {
    orderId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    amount: new Prisma.Decimal("0.30"),
    currency: "BRL",
    method: "DEMO" as const
  };
  assert.equal(canonicalizePaymentIntent(intent),
    '{"version":1,"orderId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","amount":"0.30","currency":"BRL","method":"DEMO"}');
  assert.equal(paymentRequestHash(intent), paymentRequestHash({ ...intent }));
  assert.match(paymentRequestHash(intent), /^[0-9a-f]{64}$/);
});
test("payment hash changes with the semantic amount or order", () => {
  const base = {
    orderId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    amount: new Prisma.Decimal("10.00"),
    currency: "BRL",
    method: "DEMO" as const
  };
  assert.notEqual(paymentRequestHash(base), paymentRequestHash({ ...base, amount: new Prisma.Decimal("10.01") }));
  assert.notEqual(paymentRequestHash(base), paymentRequestHash({ ...base, orderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }));
});
