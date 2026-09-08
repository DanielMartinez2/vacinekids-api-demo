import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  birthDateSchema,
  createDependentSchema,
  customerNameSchema,
  dependentListQuerySchema,
  profileInputSchema,
  updateDependentSchema
} from "./customer.schemas";

test("normalizes customer names with NFC, trim and collapsed Unicode whitespace", () => {
  assert.equal(customerNameSchema.parse("  Maria   Jose\u0301  "), "Maria José");
  assert.equal(customerNameSchema.parse("李  小龍"), "李 小龍");
  assert.equal(customerNameSchema.parse("Ana\tMaría\nD'Ávila-Santos"), "Ana María D'Ávila-Santos");
});

test("validates names by Unicode code points after normalization", () => {
  assert.equal(customerNameSchema.safeParse("A").success, false);
  assert.equal(customerNameSchema.safeParse("😀😀").success, true);
  assert.equal(customerNameSchema.safeParse("á".repeat(160)).success, true);
  assert.equal(customerNameSchema.safeParse("á".repeat(161)).success, false);
});

test("accepts only canonical E.164 profile phones and a complete strict payload", () => {
  assert.deepEqual(profileInputSchema.parse({ name: " Cliente Exemplo ", phone: "+5511999990001" }), {
    name: "Cliente Exemplo",
    phone: "+5511999990001"
  });
  for (const phone of ["11999990001", "+55 (11) 99999-0001", "+0511999990001", "+5512345", "+" + "1".repeat(16)]) {
    assert.equal(profileInputSchema.safeParse({ name: "Cliente Exemplo", phone }).success, false);
  }
  for (const input of [
    { name: "Cliente Exemplo" },
    { phone: "+5511999990001" },
    { name: "Cliente Exemplo", phone: "+5511999990001", userId: randomUUID() }
  ]) assert.equal(profileInputSchema.safeParse(input).success, false);
});

test("accepts real non-future civil dates and transforms them to UTC midnight", () => {
  assert.equal(birthDateSchema.parse("2020-02-29").toISOString(), "2020-02-29T00:00:00.000Z");
  assert.equal(birthDateSchema.safeParse("2021-02-29").success, false);
  assert.equal(birthDateSchema.safeParse("0000-01-01").success, false);
  assert.equal(birthDateSchema.safeParse("2020-01-01T00:00:00.000Z").success, false);
  const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  assert.equal(birthDateSchema.safeParse(tomorrow).success, false);
});

test("uses strict create and partial non-empty update contracts for dependents", () => {
  const created = createDependentSchema.parse({ name: " Lia   Exemplo ", birthDate: "2021-05-12" });
  assert.equal(created.name, "Lia Exemplo");
  assert.equal(created.birthDate.toISOString().slice(0, 10), "2021-05-12");
  assert.equal(createDependentSchema.safeParse({ name: "Lia", birthDate: "2021-05-12", customerProfileId: randomUUID() }).success, false);
  assert.equal(updateDependentSchema.safeParse({}).success, false);
  assert.equal(updateDependentSchema.safeParse({ name: "Lia Atualizada" }).success, true);
  assert.equal(updateDependentSchema.safeParse({ birthDate: "2019-03-10" }).success, true);
  assert.equal(updateDependentSchema.safeParse({ name: "Lia", deletedAt: null }).success, false);
});

test("parses strict dependent pagination with existing limits", () => {
  assert.deepEqual(dependentListQuerySchema.parse({}), { page: 1, pageSize: 20 });
  assert.deepEqual(dependentListQuerySchema.parse({ page: "2", pageSize: "100" }), { page: 2, pageSize: 100 });
  for (const query of [{ page: "0" }, { pageSize: "101" }, { pageSize: "1.5" }, { includeDeleted: "true" }]) {
    assert.equal(dependentListQuerySchema.safeParse(query).success, false);
  }
});
