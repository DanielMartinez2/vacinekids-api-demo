import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  cancelOrderSchema,
  checkoutPreviewSchema,
  createOrderSchema,
  idempotencyKeySchema,
  orderIdParamsSchema,
  orderListQuerySchema
} from "./orders.schemas";

const vaccineItem = (recipients: unknown[] = [{ type: "CUSTOMER" }]) => ({
  productType: "VACCINE",
  productId: randomUUID(),
  recipients
});

test("checkout schemas accept only the authoritative intent and canonicalize UUIDs", () => {
  const productId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
  const dependentId = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";
  const parsed = checkoutPreviewSchema.parse({
    items: [{ productType: "VACCINE", productId, recipients: [{ type: "DEPENDENT", dependentId }] }]
  });
  assert.equal(parsed.items[0].productId, productId.toLowerCase());
  assert.equal(parsed.items[0].recipients[0]?.type, "DEPENDENT");
  if (parsed.items[0].recipients[0]?.type === "DEPENDENT") {
    assert.equal(parsed.items[0].recipients[0].dependentId, dependentId.toLowerCase());
  }
  for (const extra of ["name", "price", "quantity", "lineTotal", "currency", "manufacturer", "userId"]) {
    assert.equal(checkoutPreviewSchema.safeParse({ items: [{ ...vaccineItem(), [extra]: "untrusted" }] }).success, false);
  }
});

test("checkout schemas enforce item and recipient limits while preserving duplicate recipients", () => {
  const dependentId = randomUUID();
  const duplicateRecipients = Array.from({ length: 10 }, () => ({ type: "DEPENDENT", dependentId }));
  assert.equal(checkoutPreviewSchema.safeParse({ items: [vaccineItem(duplicateRecipients)] }).success, true);
  assert.equal(checkoutPreviewSchema.safeParse({ items: [vaccineItem([])] }).success, false);
  assert.equal(checkoutPreviewSchema.safeParse({ items: [vaccineItem(Array.from({ length: 11 }, () => ({ type: "CUSTOMER" })))] }).success, false);
  assert.equal(checkoutPreviewSchema.safeParse({ items: Array.from({ length: 11 }, () => vaccineItem()) }).success, false);
  assert.equal(checkoutPreviewSchema.safeParse({ items: Array.from({ length: 4 }, () => vaccineItem(Array.from({ length: 8 }, () => ({ type: "CUSTOMER" })))) }).success, false);
});

test("duplicate products and invalid conditional recipient fields are rejected", () => {
  const item = vaccineItem();
  assert.equal(checkoutPreviewSchema.safeParse({ items: [item, item] }).success, false);
  for (const recipient of [
    { type: "DEPENDENT" },
    { type: "DEPENDENT", dependentId: "not-a-uuid" },
    { type: "CUSTOMER", dependentId: randomUUID() },
    { type: "OTHER" }
  ]) {
    assert.equal(checkoutPreviewSchema.safeParse({ items: [vaccineItem([recipient])] }).success, false);
  }
});

test("creation, params, pagination, idempotency and cancellation contracts are strict", () => {
  const body = { checkoutFingerprintVersion: 1, checkoutFingerprint: "a".repeat(64), items: [vaccineItem()] };
  assert.equal(createOrderSchema.safeParse(body).success, true);
  assert.equal(createOrderSchema.safeParse({ ...body, checkoutFingerprintVersion: 2 }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...body, checkoutFingerprint: "A".repeat(64) }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...body, total: "1.00" }).success, false);
  assert.equal(orderIdParamsSchema.safeParse({ id: randomUUID(), extra: true }).success, false);
  assert.deepEqual(orderListQuerySchema.parse({}), { page: 1, pageSize: 20 });
  assert.deepEqual(orderListQuerySchema.parse({ page: "2", pageSize: "100" }), { page: 2, pageSize: 100 });
  assert.equal(orderListQuerySchema.safeParse({ page: 0 }).success, false);
  assert.equal(orderListQuerySchema.safeParse({ pageSize: 101 }).success, false);
  assert.equal(orderListQuerySchema.safeParse({ unknown: "x" }).success, false);
  assert.equal(idempotencyKeySchema.safeParse(randomUUID()).success, true);
  assert.equal(idempotencyKeySchema.safeParse("invalid").success, false);
  assert.equal(cancelOrderSchema.safeParse({}).success, true);
  assert.equal(cancelOrderSchema.safeParse({ status: "CANCELLED" }).success, false);
});
