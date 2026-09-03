import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/database";

let childAgeRangeId: string;
let adultAgeRangeId: string;
let primaryVaccineId: string;
let packageVaccineAId: string;
let packageVaccineBId: string;
let packageId: string;

const childAgeRangeSlug = "crianca-teste";
const adultAgeRangeSlug = "adulto-teste";
const unmatchedAgeRangeSlug = "sem-pacotes-teste";

const clearCatalog = async () => {
  await prisma.packageVaccine.deleteMany();
  await prisma.packageFaq.deleteMany();
  await prisma.package.deleteMany();
  await prisma.vaccineAgeRange.deleteMany();
  await prisma.vaccineFaq.deleteMany();
  await prisma.vaccine.deleteMany();
  await prisma.ageRange.deleteMany();
};

const createAgeRange = async (slug: string, name: string, minAgeMonths: number, maxAgeMonths: number | null) => {
  const response = await request(app).post("/api/v1/age-ranges").send({
    slug,
    name,
    minAgeMonths,
    maxAgeMonths,
    sortOrder: minAgeMonths
  });
  assert.equal(response.status, 201);
  return response.body.data.id as string;
};

const createVaccine = async (name: string, manufacturer: string, ageRangeIds: string[]) => {
  const response = await request(app).post("/api/v1/vaccines").send({
    name,
    description: `${name} usada somente pelos testes de integração.`,
    manufacturer,
    price: 129.9,
    ageRangeIds,
    faqs: []
  });
  assert.equal(response.status, 201);
  return response.body.data.id as string;
};

const createPackage = async (
  name: string,
  vaccines: Array<{ vaccineId: string; quantity?: number }>
) => {
  const response = await request(app).post("/api/v1/packages").send({
    name,
    description: `${name} usado somente pelos testes de integração.`,
    price: 349.9,
    vaccines,
    faqs: []
  });
  assert.equal(response.status, 201);
  return response.body.data.id as string;
};

before(async () => {
  await clearCatalog();
  childAgeRangeId = await createAgeRange(childAgeRangeSlug, "Criança Teste", 24, 143);
  adultAgeRangeId = await createAgeRange(adultAgeRangeSlug, "Adulto Teste", 216, 719);
});

after(async () => {
  await clearCatalog();
  await prisma.$disconnect();
});

test("health check confirms the process and PostgreSQL connection", async () => {
  const response = await request(app).get("/health");
  assert.equal(response.status, 200);
  assert.equal(response.body.data.process, "running");
  assert.equal(response.body.data.database, "connected");
});

test("creates a vaccine with FAQ and age range", async () => {
  const response = await request(app).post("/api/v1/vaccines").send({
    name: "Vacina Integração A",
    description: "Produto fictício para testar criação no PostgreSQL.",
    manufacturer: "Laboratório Teste",
    price: 159.9,
    ageRangeIds: [childAgeRangeId],
    faqs: [{ question: "Pergunta inicial?", answer: "Resposta inicial." }]
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.data.price, "159.90");
  assert.equal(response.body.data.faqs.length, 1);
  assert.equal(response.body.data.ageRanges[0].slug, "crianca-teste");
  primaryVaccineId = response.body.data.id;
});

test("lists active vaccines", async () => {
  const response = await request(app).get("/api/v1/vaccines");
  assert.equal(response.status, 200);
  assert.equal(response.body.data.some((item: { id: string }) => item.id === primaryVaccineId), true);
  assert.equal(response.body.meta.total, 1);
});

test("filters vaccines by search and age range slug", async () => {
  await createVaccine("Vacina Somente Adulto", "Bio Teste", [adultAgeRangeId]);

  const bySearch = await request(app).get("/api/v1/vaccines").query({ search: "integração a" });
  assert.equal(bySearch.status, 200);
  assert.deepEqual(bySearch.body.data.map((item: { id: string }) => item.id), [primaryVaccineId]);

  const byAge = await request(app).get("/api/v1/vaccines").query({ ageRange: "crianca-teste" });
  assert.equal(byAge.status, 200);
  assert.deepEqual(byAge.body.data.map((item: { id: string }) => item.id), [primaryVaccineId]);
});

test("updates a vaccine", async () => {
  const response = await request(app).patch(`/api/v1/vaccines/${primaryVaccineId}`).send({
    name: "Vacina Integração Atualizada",
    price: 179.5
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.name, "Vacina Integração Atualizada");
  assert.equal(response.body.data.price, "179.50");
});

test("soft deletes a vaccine and hides it from list and detail by default", async () => {
  const deleted = await request(app).delete(`/api/v1/vaccines/${primaryVaccineId}`);
  assert.equal(deleted.status, 204);

  const list = await request(app).get("/api/v1/vaccines");
  assert.equal(list.body.data.some((item: { id: string }) => item.id === primaryVaccineId), false);

  const detail = await request(app).get(`/api/v1/vaccines/${primaryVaccineId}`);
  assert.equal(detail.status, 404);

  const databaseRecord = await prisma.vaccine.findUniqueOrThrow({ where: { id: primaryVaccineId } });
  assert.notEqual(databaseRecord.deletedAt, null);
});

test("creates a package with vaccine composition", async () => {
  packageVaccineAId = await createVaccine("Vacina Pacote A", "Instituto Teste", [childAgeRangeId]);
  packageVaccineBId = await createVaccine("Vacina Pacote B", "Instituto Teste", [adultAgeRangeId]);

  const response = await request(app).post("/api/v1/packages").send({
    name: "Pacote Integração",
    description: "Pacote fictício usado somente nos testes de integração.",
    price: 349.9,
    vaccines: [
      { vaccineId: packageVaccineAId, quantity: 1 },
      { vaccineId: packageVaccineBId, quantity: 2 }
    ],
    faqs: [
      { question: "FAQ antiga 1?", answer: "Resposta antiga 1." },
      { question: "FAQ antiga 2?", answer: "Resposta antiga 2." }
    ]
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.data.vaccines.length, 2);
  packageId = response.body.data.id;
});

test("lists packages unchanged when ageRange is absent", async () => {
  const response = await request(app).get("/api/v1/packages");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.map((item: { id: string }) => item.id), [packageId]);
  assert.equal(response.body.meta.total, 1);
});

test("filters a package through a compatible vaccine age range", async () => {
  const response = await request(app).get("/api/v1/packages").query({ ageRange: childAgeRangeSlug });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.map((item: { id: string }) => item.id), [packageId]);
  assert.equal(response.body.meta.total, 1);
});

test("does not return a package without a compatible vaccine", async () => {
  const adultOnlyPackageId = await createPackage("Pacote Somente Adulto", [
    { vaccineId: packageVaccineBId, quantity: 1 }
  ]);

  const response = await request(app).get("/api/v1/packages").query({ ageRange: childAgeRangeSlug });
  const returnedIds = response.body.data.map((item: { id: string }) => item.id);

  assert.equal(response.status, 200);
  assert.equal(returnedIds.includes(packageId), true);
  assert.equal(returnedIds.includes(adultOnlyPackageId), false);
});

test("returns a package only once when multiple vaccines match the age range", async () => {
  const secondChildVaccineId = await createVaccine(
    "Vacina Pacote Criança Extra",
    "Instituto Teste",
    [childAgeRangeId]
  );
  const packageWithTwoMatchesId = await createPackage("Pacote Duas Vacinas Compatíveis", [
    { vaccineId: packageVaccineAId, quantity: 1 },
    { vaccineId: secondChildVaccineId, quantity: 1 }
  ]);

  const response = await request(app).get("/api/v1/packages").query({ ageRange: childAgeRangeSlug });
  const occurrences = response.body.data.filter(
    (item: { id: string }) => item.id === packageWithTwoMatchesId
  );

  assert.equal(response.status, 200);
  assert.equal(occurrences.length, 1);
});

let unmatchedAgeRangeId: string;

test("returns an empty list for a valid age range without matches", async () => {
  unmatchedAgeRangeId = await createAgeRange(unmatchedAgeRangeSlug, "Sem Pacotes Teste", 900, null);

  const response = await request(app).get("/api/v1/packages").query({
    ageRange: unmatchedAgeRangeSlug
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, []);
  assert.equal(response.body.meta.total, 0);
  assert.equal(response.body.meta.totalPages, 0);
});

test("returns an empty list for a nonexistent age range slug", async () => {
  const response = await request(app).get("/api/v1/packages").query({
    ageRange: "faixa-inexistente"
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, []);
  assert.equal(response.body.meta.total, 0);
});

test("returns validation error for an invalid ageRange format", async () => {
  const response = await request(app).get("/api/v1/packages").query({ ageRange: "a".repeat(61) });

  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
});

test("combines ageRange and search with AND semantics", async () => {
  const response = await request(app).get("/api/v1/packages").query({
    ageRange: childAgeRangeSlug,
    search: "fictício"
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.map((item: { id: string }) => item.id), [packageId]);
  assert.equal(response.body.meta.total, 1);
});

test("applies the age range filter before pagination and count", async () => {
  await createPackage("Pacote Criança Página A", [{ vaccineId: packageVaccineAId, quantity: 1 }]);
  await createPackage("Pacote Criança Página B", [{ vaccineId: packageVaccineAId, quantity: 1 }]);

  const firstPage = await request(app).get("/api/v1/packages").query({
    ageRange: childAgeRangeSlug,
    page: 1,
    pageSize: 2
  });
  const secondPage = await request(app).get("/api/v1/packages").query({
    ageRange: childAgeRangeSlug,
    page: 2,
    pageSize: 2
  });

  assert.equal(firstPage.status, 200);
  assert.equal(firstPage.body.data.length, 2);
  assert.equal(firstPage.body.meta.total, 4);
  assert.equal(firstPage.body.meta.totalPages, 2);
  assert.equal(secondPage.body.data.length, 2);
  assert.equal(secondPage.body.meta.total, 4);
  assert.equal(secondPage.body.meta.totalPages, 2);
  assert.equal(
    firstPage.body.data.some((first: { id: string }) =>
      secondPage.body.data.some((second: { id: string }) => second.id === first.id)
    ),
    false
  );
});

test("does not match a package through a soft-deleted vaccine", async () => {
  const vaccineId = await createVaccine("Vacina Excluída para Filtro", "Instituto Teste", [
    childAgeRangeId
  ]);
  const packageWithDeletedVaccineId = await createPackage("Pacote com Vacina Excluída", [
    { vaccineId, quantity: 1 }
  ]);

  const deleted = await request(app).delete(`/api/v1/vaccines/${vaccineId}`);
  assert.equal(deleted.status, 204);

  const response = await request(app).get("/api/v1/packages").query({ ageRange: childAgeRangeSlug });
  assert.equal(
    response.body.data.some((item: { id: string }) => item.id === packageWithDeletedVaccineId),
    false
  );
});

test("does not match a package through a soft-deleted age range", async () => {
  const vaccineId = await createVaccine("Vacina com Faixa Excluída", "Instituto Teste", [
    unmatchedAgeRangeId
  ]);
  const packageWithDeletedAgeRangeId = await createPackage("Pacote com Faixa Excluída", [
    { vaccineId, quantity: 1 }
  ]);

  const deleted = await request(app).delete(`/api/v1/age-ranges/${unmatchedAgeRangeId}`);
  assert.equal(deleted.status, 204);

  const response = await request(app).get("/api/v1/packages").query({
    ageRange: unmatchedAgeRangeSlug
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, []);
  assert.equal(
    response.body.data.some((item: { id: string }) => item.id === packageWithDeletedAgeRangeId),
    false
  );
});

test("keeps a soft-deleted package out of an age range result", async () => {
  const deletedPackageId = await createPackage("Pacote Excluído para Filtro", [
    { vaccineId: packageVaccineAId, quantity: 1 }
  ]);
  const deleted = await request(app).delete(`/api/v1/packages/${deletedPackageId}`);
  assert.equal(deleted.status, 204);

  const response = await request(app).get("/api/v1/packages").query({ ageRange: childAgeRangeSlug });
  assert.equal(
    response.body.data.some((item: { id: string }) => item.id === deletedPackageId),
    false
  );
});

test("atomically replaces package FAQs", async () => {
  const response = await request(app).patch(`/api/v1/packages/${packageId}`).send({
    faqs: [{ question: "FAQ substituta?", answer: "Única resposta atual." }]
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    response.body.data.faqs.map((faq: { question: string }) => faq.question),
    ["FAQ substituta?"]
  );
  assert.equal(await prisma.packageFaq.count({ where: { packageId } }), 1);
});

test("atomically replaces package vaccine composition", async () => {
  const response = await request(app).patch(`/api/v1/packages/${packageId}`).send({
    vaccines: [{ vaccineId: packageVaccineBId, quantity: 3 }]
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.vaccines.length, 1);
  assert.equal(response.body.data.vaccines[0].vaccine.id, packageVaccineBId);
  assert.equal(response.body.data.vaccines[0].quantity, 3);
  assert.equal(await prisma.packageVaccine.count({ where: { packageId } }), 1);
});

test("returns 422 for invalid catalog data", async () => {
  const response = await request(app).post("/api/v1/vaccines").send({
    name: "",
    description: "",
    manufacturer: "",
    price: -1,
    ageRangeIds: []
  });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
});

test("lists only active age ranges and soft deletes packages", async () => {
  const ageRanges = await request(app).get("/api/v1/age-ranges");
  assert.equal(ageRanges.status, 200);
  assert.equal(ageRanges.body.data.length, 2);

  const deleted = await request(app).delete(`/api/v1/packages/${packageId}`);
  assert.equal(deleted.status, 204);

  const packages = await request(app).get("/api/v1/packages");
  assert.equal(packages.status, 200);
  assert.equal(packages.body.data.some((item: { id: string }) => item.id === packageId), false);
});
