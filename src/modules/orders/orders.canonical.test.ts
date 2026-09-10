import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../../../generated/prisma/client";
import {
  canonicalCheckoutDocument,
  canonicalRequestDocument,
  checkoutFingerprint,
  requestHash,
  type ResolvedCheckout
} from "./orders.canonical";
import type { CreateOrderInput } from "./orders.schemas";

const vaccineA = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const vaccineB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const dependent = "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC";

const checkout = (): ResolvedCheckout => ({
  customer: { name: "Cliente", email: "cliente@example.test", phone: "+5511999990001" },
  currency: "BRL",
  items: [{
    productType: "PACKAGE",
    productId: vaccineB,
    name: "Pacote",
    manufacturer: null,
    unitPrice: new Prisma.Decimal("0.10"),
    quantity: 3,
    lineTotal: new Prisma.Decimal("0.30"),
    recipients: [
      { type: "DEPENDENT", dependentId: dependent, name: "Criança", birthDate: "2020-02-29" },
      { type: "CUSTOMER", dependentId: null, name: "Cliente", birthDate: null },
      { type: "DEPENDENT", dependentId: dependent, name: "Criança", birthDate: "2020-02-29" }
    ],
    components: [
      { vaccineId: vaccineB, name: "Vacina B", manufacturer: "Fabricante B", quantity: 2 },
      { vaccineId: vaccineA, name: "Vacina A", manufacturer: "Fabricante A", quantity: 1 }
    ]
  }, {
    productType: "VACCINE",
    productId: vaccineA,
    name: "Vacina A",
    manufacturer: "Fabricante A",
    unitPrice: new Prisma.Decimal("120"),
    quantity: 1,
    lineTotal: new Prisma.Decimal("120"),
    recipients: [{ type: "CUSTOMER", dependentId: null, name: "Cliente", birthDate: null }],
    components: []
  }],
  totalAmount: new Prisma.Decimal("120.30")
});

test("canonical checkout is deterministic, lowercase, ordered, duplicate-safe and money-safe", () => {
  const first = canonicalCheckoutDocument(checkout());
  const reordered = checkout();
  reordered.items.reverse();
  reordered.items[1]!.recipients.reverse();
  reordered.items[1]!.components.reverse();
  assert.deepEqual(canonicalCheckoutDocument(reordered), first);
  assert.equal(first.version, 1);
  assert.equal(first.items[0]?.productId, vaccineB.toLowerCase());
  assert.equal(first.items[1]?.productId, vaccineA.toLowerCase());
  assert.equal(first.items[0]?.components[0]?.vaccineId, vaccineA.toLowerCase());
  assert.equal(first.items[0]?.recipients.length, 3);
  assert.equal(first.items[0]?.recipients.filter(({ type }) => type === "DEPENDENT").length, 2);
  assert.equal(first.items[1]?.unitPrice, "120.00");
  assert.equal(first.items[0]?.lineTotal, "0.30");
  assert.equal(first.totalAmount, "120.30");
  assert.equal(first.items[0]?.recipients[1]?.birthDate, "2020-02-29");
  assert.match(checkoutFingerprint(checkout()), /^[0-9a-f]{64}$/);
});

test("every commercial snapshot dimension changes the checkout fingerprint", () => {
  const base = checkoutFingerprint(checkout());
  const mutations: Array<(value: ResolvedCheckout) => void> = [
    value => { value.customer.name = "Outro nome"; },
    value => { value.customer.email = "outro@example.test"; },
    value => { value.customer.phone = "+5511888880002"; },
    value => { value.items[0]!.recipients[0]!.name = "Outro dependente"; },
    value => { value.items[0]!.recipients[0]!.birthDate = "2020-03-01"; },
    value => { value.items[0]!.unitPrice = new Prisma.Decimal("0.11"); },
    value => { value.items[1]!.manufacturer = "Outro fabricante"; },
    value => { value.items[0]!.components[0]!.manufacturer = "Outro fabricante"; },
    value => { value.items[0]!.components[0]!.quantity = 3; },
    value => { value.items[0]!.components.push({ vaccineId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "D", manufacturer: "D", quantity: 1 }); },
    value => { value.totalAmount = new Prisma.Decimal("120.31"); }
  ];
  for (const mutate of mutations) {
    const changed = checkout();
    mutate(changed);
    assert.notEqual(checkoutFingerprint(changed), base);
  }
});

const intent = (): CreateOrderInput => ({
  checkoutFingerprintVersion: 1,
  checkoutFingerprint: "a".repeat(64),
  items: [{
    productType: "VACCINE",
    productId: vaccineA.toLowerCase(),
    recipients: [{ type: "DEPENDENT", dependentId: dependent.toLowerCase() }, { type: "CUSTOMER" }, { type: "DEPENDENT", dependentId: dependent.toLowerCase() }]
  }, {
    productType: "PACKAGE",
    productId: vaccineB,
    recipients: [{ type: "CUSTOMER" }]
  }]
});

test("request hash canonicalizes semantic array order and preserves duplicate intent", () => {
  const base = intent();
  const reordered = intent();
  reordered.items.reverse();
  reordered.items[1]!.recipients.reverse();
  assert.deepEqual(canonicalRequestDocument(reordered), canonicalRequestDocument(base));
  assert.equal(requestHash(reordered), requestHash(base));
  assert.match(requestHash(base), /^[0-9a-f]{64}$/);

  const mutations: Array<(value: CreateOrderInput) => void> = [
    value => { value.items[0]!.productId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; },
    value => { value.items[0]!.recipients.pop(); },
    value => { value.items[0]!.recipients[0] = { type: "CUSTOMER" }; },
    value => { value.checkoutFingerprint = "b".repeat(64); },
    value => { value.checkoutFingerprintVersion = 2 as 1; }
  ];
  for (const mutate of mutations) {
    const changed = intent();
    mutate(changed);
    assert.notEqual(requestHash(changed), requestHash(base));
  }
});

test("request hash is independent from current catalog and Decimal arithmetic remains exact", () => {
  const body = intent();
  const before = requestHash(body);
  const catalog = checkout();
  catalog.items[0]!.name = "Novo nome";
  catalog.items[0]!.unitPrice = new Prisma.Decimal("999.99");
  assert.equal(requestHash(body), before);

  const cents = new Prisma.Decimal("0.10").mul(10);
  const packageLine = new Prisma.Decimal("79.99").mul(3);
  const total = cents.add(packageLine).add(new Prisma.Decimal("120.01"));
  assert.equal(cents.toFixed(2), "1.00");
  assert.equal(packageLine.toFixed(2), "239.97");
  assert.equal(total.toFixed(2), "360.98");
});
