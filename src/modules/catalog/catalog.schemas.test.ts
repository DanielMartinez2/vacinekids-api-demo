import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgeRangeSchema,
  createPackageSchema,
  createVaccineSchema,
  packageListQuerySchema,
  vaccineListQuerySchema
} from "./catalog.schemas";

const idA = "d9428888-122b-4c42-8aeb-8f4d56d7891a";
const idB = "a2f1b2f0-d3ec-4bf0-8462-7f8c58a51019";

test("accepts a complete vaccine payload", () => {
  const result = createVaccineSchema.safeParse({
    name: "Vacina A",
    description: "Descrição da vacina",
    manufacturer: "Laboratório Demo",
    price: 125.9,
    ageRangeIds: [idA, idB],
    faqs: [{ question: "Dúvida?", answer: "Resposta." }]
  });
  assert.equal(result.success, true);
});

test("rejects duplicate age ranges and prices with more than two decimals", () => {
  const result = createVaccineSchema.safeParse({
    name: "Vacina A",
    description: "Descrição",
    manufacturer: "Demo",
    price: 10.999,
    ageRangeIds: [idA, idA]
  });
  assert.equal(result.success, false);
});

test("rejects duplicate vaccines in a package", () => {
  const result = createPackageSchema.safeParse({
    name: "Pacote infantil",
    description: "Pacote de demonstração",
    price: 300,
    vaccines: [
      { vaccineId: idA, quantity: 1 },
      { vaccineId: idA, quantity: 2 }
    ]
  });
  assert.equal(result.success, false);
});

test("validates age range bounds", () => {
  const result = createAgeRangeSchema.safeParse({
    slug: "crianca",
    name: "Criança",
    minAgeMonths: 144,
    maxAgeMonths: 24
  });
  assert.equal(result.success, false);
});

test("parses pagination and boolean query values", () => {
  const parsed = vaccineListQuerySchema.parse({ page: "2", pageSize: "10", includeDeleted: "false" });
  assert.deepEqual(parsed, { page: 2, pageSize: 10, includeDeleted: false });
});

test("uses the same optional ageRange slug contract in vaccine and package queries", () => {
  const packageQuery = packageListQuerySchema.parse({ ageRange: " crianca " });
  const vaccineQuery = vaccineListQuerySchema.parse({ ageRange: " crianca " });
  assert.equal(packageQuery.ageRange, "crianca");
  assert.equal(vaccineQuery.ageRange, "crianca");

  const withoutAgeRange = packageListQuerySchema.parse({});
  assert.equal(withoutAgeRange.ageRange, undefined);
});

test("applies the same ageRange length validation to vaccine and package queries", () => {
  const invalidSlug = "a".repeat(61);
  assert.equal(packageListQuerySchema.safeParse({ ageRange: invalidSlug }).success, false);
  assert.equal(vaccineListQuerySchema.safeParse({ ageRange: invalidSlug }).success, false);
});
