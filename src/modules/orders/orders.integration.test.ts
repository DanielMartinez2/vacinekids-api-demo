import "../../../scripts/integration-bootstrap";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import request from "supertest";

const { createApp } = await import("../../app");
const { prisma } = await import("../../config/database");
const { hashPassword } = await import("../auth/auth.password");
const { createAuthService } = await import("../auth/auth.service");
const { createCustomerService } = await import("../customer/customer.service");
const { createOrderService } = await import("./orders.service");

const origin = "http://localhost:5173";
const password = "orders integration test password";
let passwordHash: string;
let app: ReturnType<typeof createApp>;

const clear = async () => {
  await prisma.orderItemComponent.deleteMany();
  await prisma.orderItemRecipient.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.dependent.deleteMany();
  await prisma.customerProfile.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.packageVaccine.deleteMany();
  await prisma.packageFaq.deleteMany();
  await prisma.package.deleteMany();
  await prisma.vaccineAgeRange.deleteMany();
  await prisma.vaccineFaq.deleteMany();
  await prisma.vaccine.deleteMany();
  await prisma.ageRange.deleteMany();
};

before(async () => { passwordHash = await hashPassword(password); });
beforeEach(async () => { await clear(); app = createApp(); });
after(async () => { await clear(); await prisma.$disconnect(); });

const createIdentity = async (
  label: string,
  role: "CUSTOMER" | "ADMIN" = "CUSTOMER",
  withProfile = true
) => {
  const user = await prisma.user.create({
    data: { email: `${label}@example.test`, passwordHash, role }
  });
  const profile = withProfile && role === "CUSTOMER" ? await prisma.customerProfile.create({
    data: { userId: user.id, name: `Cliente ${label}`, phone: "+5511999990001" }
  }) : null;
  const login = await request(app).post("/api/v1/auth/login")
    .set("Origin", origin).set("X-VacineKids-CSRF", "1")
    .send({ email: user.email, password });
  assert.equal(login.status, 200);
  const cookie = String(login.headers["set-cookie"][0]).split(";")[0];
  return { user, profile, cookie };
};

const createVaccine = (suffix = "A", price = "120.00") => prisma.vaccine.create({
  data: {
    name: `Vacina Orders ${suffix}`,
    description: "Vacina local para testes de pedidos.",
    manufacturer: `Fabricante ${suffix}`,
    price
  }
});

const createPackage = async (suffix = "A", componentQuantity = 2) => {
  const component = await createVaccine(`Componente ${suffix}`, "40.00");
  const packageItem = await prisma.package.create({
    data: {
      name: `Pacote Orders ${suffix}`,
      description: "Pacote local para testes de pedidos.",
      price: "199.90",
      vaccines: { create: { vaccineId: component.id, quantity: componentQuantity } }
    }
  });
  return { packageItem, component };
};

const write = (path: string, cookie?: string) => {
  let operation = request(app).post(path).set("Origin", origin).set("X-VacineKids-CSRF", "1");
  if (cookie) operation = operation.set("Cookie", cookie);
  return operation;
};

const preview = (cookie: string, items: unknown[]) => write("/api/v1/checkout/preview", cookie).send({ items });
const create = (cookie: string, key: string, body: object) =>
  write("/api/v1/orders", cookie).set("Idempotency-Key", key).send(body);
const item = (productType: "VACCINE" | "PACKAGE", productId: string, recipients: unknown[] = [{ type: "CUSTOMER" }]) =>
  ({ productType, productId, recipients });
const createBody = (previewResponse: request.Response, items: unknown[]) => ({
  checkoutFingerprintVersion: previewResponse.body.data.checkoutFingerprintVersion,
  checkoutFingerprint: previewResponse.body.data.checkoutFingerprint,
  items
});

test("orders routes require authentication, CUSTOMER role and profile according to each contract", async () => {
  const vaccine = await createVaccine();
  const intent = [item("VACCINE", vaccine.id)];
  assert.equal((await preview("vacinekids_session=invalid", intent)).status, 401);

  const admin = await createIdentity("orders-admin", "ADMIN");
  assert.equal((await preview(admin.cookie, intent)).status, 403);
  assert.equal((await request(app).get("/api/v1/orders").set("Cookie", admin.cookie)).status, 403);
  assert.equal((await create(admin.cookie, randomUUID(), {
    checkoutFingerprintVersion: 1, checkoutFingerprint: "a".repeat(64), items: intent
  })).status, 403);
  assert.equal((await request(app).get(`/api/v1/orders/${randomUUID()}`).set("Cookie", admin.cookie)).status, 403);
  assert.equal((await write(`/api/v1/orders/${randomUUID()}/cancel`, admin.cookie).send({})).status, 403);

  const noProfile = await createIdentity("orders-no-profile", "CUSTOMER", false);
  assert.equal((await preview(noProfile.cookie, intent)).body.error.code, "PROFILE_REQUIRED");
  const fakeCreation = { checkoutFingerprintVersion: 1, checkoutFingerprint: "a".repeat(64), items: intent };
  assert.equal((await create(noProfile.cookie, randomUUID(), fakeCreation)).body.error.code, "PROFILE_REQUIRED");
  const list = await request(app).get("/api/v1/orders").set("Cookie", noProfile.cookie);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.data, []);
  assert.equal(list.body.meta.total, 0);
  assert.equal((await request(app).get(`/api/v1/orders/${randomUUID()}`).set("Cookie", noProfile.cookie)).status, 404);
  assert.equal((await write(`/api/v1/orders/${randomUUID()}/cancel`, noProfile.cookie).send({})).status, 404);
});

test("preview validates strict limits and product uniqueness at the HTTP boundary", async () => {
  const customer = await createIdentity("orders-validation");
  const valid = await createVaccine();
  const duplicate = item("VACCINE", valid.id);
  const invalidBodies = [
    {},
    { items: [{ ...duplicate, price: "0.01" }] },
    { items: [item("VACCINE", "invalid")] },
    { items: [duplicate, duplicate] },
    { items: Array.from({ length: 11 }, () => item("VACCINE", randomUUID())) },
    { items: [item("VACCINE", valid.id, Array.from({ length: 11 }, () => ({ type: "CUSTOMER" })))] },
    { items: Array.from({ length: 4 }, () => item("VACCINE", randomUUID(), Array.from({ length: 8 }, () => ({ type: "CUSTOMER" })))) }
  ];
  for (const body of invalidBodies) {
    const response = await write("/api/v1/checkout/preview", customer.cookie).send(body);
    assert.equal(response.status, 422);
  }
});

test("authoritative preview resolves vaccines, package composition, recipients and exact Decimal totals", async () => {
  const customer = await createIdentity("orders-preview");
  const dependent = await prisma.dependent.create({
    data: { customerProfileId: customer.profile!.id, name: "Criança Preview", birthDate: new Date("2020-02-29T00:00:00Z") }
  });
  const vaccine = await createVaccine("Preview", "120.01");
  const { packageItem, component } = await createPackage("Preview", 2);
  const intents = [
    item("VACCINE", vaccine.id, [{ type: "CUSTOMER" }, { type: "DEPENDENT", dependentId: dependent.id }]),
    item("PACKAGE", packageItem.id, [
      { type: "DEPENDENT", dependentId: dependent.id },
      { type: "DEPENDENT", dependentId: dependent.id }
    ])
  ];
  const response = await preview(customer.cookie, intents);
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.body.data.currency, "BRL");
  assert.equal(response.body.data.totalAmount, "639.82");
  assert.match(response.body.data.checkoutFingerprint, /^[0-9a-f]{64}$/);
  const vaccineLine = response.body.data.items.find((value: { productType: string }) => value.productType === "VACCINE");
  const packageLine = response.body.data.items.find((value: { productType: string }) => value.productType === "PACKAGE");
  assert.deepEqual({ unitPrice: vaccineLine.unitPrice, quantity: vaccineLine.quantity, lineTotal: vaccineLine.lineTotal },
    { unitPrice: "120.01", quantity: 2, lineTotal: "240.02" });
  assert.equal(vaccineLine.manufacturer, "Fabricante Preview");
  assert.equal(packageLine.manufacturer, null);
  assert.equal(packageLine.lineTotal, "399.80");
  assert.equal(packageLine.recipients.length, 2);
  assert.deepEqual(packageLine.components, [{
    vaccineId: component.id,
    name: component.name,
    manufacturer: component.manufacturer,
    quantity: 2
  }]);
  assert.equal(await prisma.order.count(), 0);
});

test("preview hides unavailable products and foreign/deleted recipients behind stable errors", async () => {
  const customer = await createIdentity("orders-errors");
  const other = await createIdentity("orders-other");
  const validVaccine = await createVaccine("RecipientErrors");
  const external = await prisma.dependent.create({
    data: { customerProfileId: other.profile!.id, name: "Dependente Externo", birthDate: new Date("2020-01-01T00:00:00Z") }
  });
  const deletedRecipient = await prisma.dependent.create({
    data: { customerProfileId: customer.profile!.id, name: "Dependente Excluído", birthDate: new Date("2020-01-01T00:00:00Z"), deletedAt: new Date() }
  });
  for (const id of [external.id, deletedRecipient.id, randomUUID()]) {
    const response = await preview(customer.cookie, [item("VACCINE", validVaccine.id, [{ type: "DEPENDENT", dependentId: id }])]);
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, "RECIPIENT_NOT_FOUND");
  }

  const deleted = await createVaccine("Deleted");
  await prisma.vaccine.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
  const emptyPackage = await prisma.package.create({ data: { name: "Pacote Vazio", description: "Sem composição", price: "10.00" } });
  const componentDeleted = await createPackage("DeletedComponent");
  await prisma.vaccine.update({ where: { id: componentDeleted.component.id }, data: { deletedAt: new Date() } });
  for (const product of [
    item("VACCINE", deleted.id), item("VACCINE", randomUUID()),
    item("PACKAGE", emptyPackage.id), item("PACKAGE", componentDeleted.packageItem.id), item("PACKAGE", randomUUID())
  ]) {
    const response = await preview(customer.cookie, [product]);
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, "PRODUCT_UNAVAILABLE");
  }
});

test("fingerprint is deterministic and changes for every authoritative commercial snapshot", async () => {
  const customer = await createIdentity("orders-fingerprint");
  const dependent = await prisma.dependent.create({
    data: { customerProfileId: customer.profile!.id, name: "Dependente Original", birthDate: new Date("2020-01-01T00:00:00Z") }
  });
  const { packageItem, component } = await createPackage("Fingerprint", 1);
  const intent = [item("PACKAGE", packageItem.id, [{ type: "DEPENDENT", dependentId: dependent.id }])];
  const initial = await preview(customer.cookie, intent);
  const repeated = await preview(customer.cookie, intent);
  assert.equal(repeated.body.data.checkoutFingerprint, initial.body.data.checkoutFingerprint);
  let previous = initial.body.data.checkoutFingerprint;
  const mutations = [
    () => prisma.package.update({ where: { id: packageItem.id }, data: { price: "200.00", name: "Pacote Fingerprint Alterado" } }),
    () => prisma.vaccine.update({ where: { id: component.id }, data: { manufacturer: "Fabricante Componente Alterado" } }),
    () => prisma.packageVaccine.update({ where: { packageId_vaccineId: { packageId: packageItem.id, vaccineId: component.id } }, data: { quantity: 3 } }),
    () => prisma.dependent.update({ where: { id: dependent.id }, data: { name: "Dependente Alterado", birthDate: new Date("2021-01-01T00:00:00Z") } }),
    () => prisma.customerProfile.update({ where: { id: customer.profile!.id }, data: { name: "Cliente Alterado", phone: "+5511888880002" } }),
    () => prisma.user.update({ where: { id: customer.user.id }, data: { email: "orders-fingerprint-updated@example.test" } })
  ];
  for (const mutate of mutations) {
    await mutate();
    const changed = await preview(customer.cookie, intent);
    assert.notEqual(changed.body.data.checkoutFingerprint, previous);
    previous = changed.body.data.checkoutFingerprint;
  }
});

test("create persists an immutable Order graph with exact snapshots and invariants", async () => {
  const customer = await createIdentity("orders-create");
  const dependent = await prisma.dependent.create({
    data: { customerProfileId: customer.profile!.id, name: "Dependente Create", birthDate: new Date("2019-06-15T00:00:00Z") }
  });
  const vaccine = await createVaccine("Create", "19.99");
  const { packageItem } = await createPackage("Create", 2);
  const intents = [
    item("VACCINE", vaccine.id, [{ type: "CUSTOMER" }, { type: "DEPENDENT", dependentId: dependent.id }]),
    item("PACKAGE", packageItem.id, [{ type: "DEPENDENT", dependentId: dependent.id }])
  ];
  const previewResponse = await preview(customer.cookie, intents);
  const response = await create(customer.cookie, randomUUID(), createBody(previewResponse, intents));
  assert.equal(response.status, 201);
  assert.match(response.body.data.number, /^VK-[0-9A-F]{20}$/);
  assert.equal(response.body.data.totalAmount, "239.88");
  assert.equal("idempotencyKey" in response.body.data, false);
  assert.equal("requestHash" in response.body.data, false);
  assert.equal("checkoutFingerprint" in response.body.data, false);
  const stored = await prisma.order.findUniqueOrThrow({
    where: { id: response.body.data.id },
    include: { items: { include: { recipients: true, components: true } } }
  });
  assert.equal(stored.items.reduce((sum, value) => sum.add(value.lineTotal), new (await import("../../../generated/prisma/client")).Prisma.Decimal(0)).eq(stored.totalAmount), true);
  for (const storedItem of stored.items) assert.equal(storedItem.quantity, storedItem.recipients.length);
  const packageStored = stored.items.find(({ productType }) => productType === "PACKAGE")!;
  assert.equal(packageStored.productManufacturerSnapshot, null);
  assert.equal(packageStored.components.length, 1);
  assert.equal(packageStored.components[0]!.quantity, 2);
  const vaccineStored = stored.items.find(({ productType }) => productType === "VACCINE")!;
  assert.equal(vaccineStored.productManufacturerSnapshot, vaccine.manufacturer);
  assert.equal(vaccineStored.components.length, 0);
});

test("create rejects stale checkout atomically and reports unavailable/deleted state precisely", async () => {
  const customer = await createIdentity("orders-changed");
  const vaccine = await createVaccine("Changed");
  const intent = [item("VACCINE", vaccine.id)];
  const shown = await preview(customer.cookie, intent);
  await prisma.vaccine.update({ where: { id: vaccine.id }, data: { price: "121.00" } });
  const changed = await create(customer.cookie, randomUUID(), createBody(shown, intent));
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error.code, "CHECKOUT_CHANGED");
  assert.equal(await prisma.order.count(), 0);
  assert.equal(await prisma.orderItem.count(), 0);

  await prisma.vaccine.update({ where: { id: vaccine.id }, data: { deletedAt: new Date() } });
  const unavailable = await create(customer.cookie, randomUUID(), createBody(shown, intent));
  assert.equal(unavailable.body.error.code, "PRODUCT_UNAVAILABLE");
  assert.equal(await prisma.order.count(), 0);

  const recipientVaccine = await createVaccine("RecipientChanged");
  const dependent = await prisma.dependent.create({
    data: { customerProfileId: customer.profile!.id, name: "Recipient Changed", birthDate: new Date("2020-01-01T00:00:00Z") }
  });
  const recipientIntent = [item("VACCINE", recipientVaccine.id, [{ type: "DEPENDENT", dependentId: dependent.id }])];
  const recipientShown = await preview(customer.cookie, recipientIntent);
  await prisma.dependent.update({ where: { id: dependent.id }, data: { deletedAt: new Date() } });
  const missingRecipient = await create(customer.cookie, randomUUID(), createBody(recipientShown, recipientIntent));
  assert.equal(missingRecipient.status, 404);
  assert.equal(missingRecipient.body.error.code, "RECIPIENT_NOT_FOUND");
  assert.equal(await prisma.order.count(), 0);
});

test("Idempotency-Key contracts, replay and lost-response retry bypass changed current data", async () => {
  const customer = await createIdentity("orders-idempotency");
  const dependent = await prisma.dependent.create({
    data: { customerProfileId: customer.profile!.id, name: "Dependente Retry", birthDate: new Date("2020-01-01T00:00:00Z") }
  });
  const vaccine = await createVaccine("Retry");
  const intent = [item("VACCINE", vaccine.id, [{ type: "DEPENDENT", dependentId: dependent.id }])];
  const shown = await preview(customer.cookie, intent);
  const body = createBody(shown, intent);
  assert.equal((await write("/api/v1/orders", customer.cookie).send(body)).body.error.code, "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal((await write("/api/v1/orders", customer.cookie).set("Idempotency-Key", "invalid").send(body)).body.error.code, "IDEMPOTENCY_KEY_INVALID");

  const key = randomUUID();
  const first = await create(customer.cookie, key, body);
  assert.equal(first.status, 201);
  const different = await create(customer.cookie, key, { ...body, checkoutFingerprint: "b".repeat(64) });
  assert.equal(different.status, 409);
  assert.equal(different.body.error.code, "IDEMPOTENCY_KEY_REUSED");

  await prisma.order.update({ where: { id: first.body.data.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  await prisma.vaccine.update({ where: { id: vaccine.id }, data: { name: "Vacina Alterada Após Commit", price: "999.00", deletedAt: new Date() } });
  await prisma.dependent.update({ where: { id: dependent.id }, data: { name: "Dependente Alterado", deletedAt: new Date() } });
  await prisma.customerProfile.update({ where: { id: customer.profile!.id }, data: { name: "Cliente Alterado" } });
  const replay = await create(customer.cookie, key, body);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.id, first.body.data.id);
  assert.equal(replay.body.data.status, "CANCELLED");
  assert.equal(replay.body.data.items[0].name, vaccine.name);
  assert.equal(await prisma.order.count(), 1);
});

test("concurrent identical creates have one winner and same key with different hashes has one order", async () => {
  const customer = await createIdentity("orders-concurrency");
  const vaccine = await createVaccine("Concurrency");
  const intent = [item("VACCINE", vaccine.id)];
  const shown = await preview(customer.cookie, intent);
  const body = createBody(shown, intent);
  const key = randomUUID();
  const responses = await Promise.all([create(customer.cookie, key, body), create(customer.cookie, key, body)]);
  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 201]);
  assert.equal(responses[0].body.data.id, responses[1].body.data.id);
  assert.equal(await prisma.order.count(), 1);

  const secondKey = randomUUID();
  const otherVaccine = await createVaccine("ConcurrencyOther");
  const otherIntent = [item("VACCINE", otherVaccine.id)];
  const otherShown = await preview(customer.cookie, otherIntent);
  const otherBody = createBody(otherShown, otherIntent);
  const conflict = await Promise.all([
    create(customer.cookie, secondKey, body),
    create(customer.cookie, secondKey, otherBody)
  ]);
  assert.equal(conflict.filter(({ status }) => status === 201).length, 1);
  assert.equal(conflict.filter(({ body: value }) => value.error?.code === "IDEMPOTENCY_KEY_REUSED").length, 1);
  assert.equal(await prisma.order.count(), 2);
});

test("number collision retries separately and a transaction failure leaves no partial graph", async () => {
  const customer = await createIdentity("orders-transaction");
  const vaccine = await createVaccine("Transaction");
  const intent = [item("VACCINE", vaccine.id)];
  const shown = await preview(customer.cookie, intent);
  const body = createBody(shown, intent);
  const auth = createAuthService(prisma, undefined, "integration_test");
  const customerService = createCustomerService(prisma, "integration_test");
  const fixed = "VK-AAAAAAAAAAAAAAAAAAAA";
  app = createApp(auth, customerService, createOrderService(prisma, undefined, () => fixed));
  const first = await create(customer.cookie, randomUUID(), body);
  assert.equal(first.status, 201);
  let calls = 0;
  app = createApp(auth, customerService, createOrderService(prisma, undefined, () => calls++ === 0 ? fixed : "VK-BBBBBBBBBBBBBBBBBBBB"));
  assert.equal((await create(customer.cookie, randomUUID(), body)).status, 201);

  app = createApp(auth, customerService, createOrderService(prisma, undefined, () => "INVALID"));
  const failedKey = randomUUID();
  const failed = await create(customer.cookie, failedKey, body);
  assert.equal(failed.status, 500);
  assert.equal(await prisma.order.count(), 2);
  assert.equal(await prisma.orderItem.count(), 2);
  assert.equal(await prisma.orderItemRecipient.count(), 2);
  app = createApp();
  assert.equal((await create(customer.cookie, failedKey, body)).status, 201);
});

test("history, detail and cancellation enforce BOLA while preserving immutable snapshots", async () => {
  const owner = await createIdentity("orders-owner");
  const other = await createIdentity("orders-attacker");
  const vaccineA = await createVaccine("History A", "10.00");
  const vaccineB = await createVaccine("History B", "20.00");
  const dependent = await prisma.dependent.create({
    data: { customerProfileId: owner.profile!.id, name: "Dependente Histórico", birthDate: new Date("2018-05-10T00:00:00Z") }
  });
  const makeOrder = async (vaccineId: string, recipients: unknown[] = [{ type: "CUSTOMER" }]) => {
    const intent = [item("VACCINE", vaccineId, recipients)];
    const shown = await preview(owner.cookie, intent);
    return create(owner.cookie, randomUUID(), createBody(shown, intent));
  };
  const first = await makeOrder(vaccineA.id, [{ type: "DEPENDENT", dependentId: dependent.id }]);
  await new Promise(resolve => setTimeout(resolve, 5));
  const second = await makeOrder(vaccineB.id);
  const list = await request(app).get("/api/v1/orders?page=1&pageSize=1").set("Cookie", owner.cookie);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.meta, { page: 1, pageSize: 1, total: 2, totalPages: 2 });
  assert.equal(list.body.data[0].id, second.body.data.id);
  assert.equal(list.body.data[0].itemCount, 1);
  assert.equal((await request(app).get("/api/v1/orders").set("Cookie", other.cookie)).body.meta.total, 0);

  assert.equal((await request(app).get(`/api/v1/orders/${first.body.data.id}`).set("Cookie", other.cookie)).status, 404);
  assert.equal((await write(`/api/v1/orders/${first.body.data.id}/cancel`, other.cookie).send({})).status, 404);
  assert.equal((await request(app).get(`/api/v1/orders/${randomUUID()}`).set("Cookie", owner.cookie)).status, 404);

  await prisma.vaccine.update({ where: { id: vaccineA.id }, data: { name: "Nome novo", deletedAt: new Date() } });
  await prisma.dependent.update({ where: { id: dependent.id }, data: { name: "Dependente novo", deletedAt: new Date() } });
  await prisma.customerProfile.update({ where: { id: owner.profile!.id }, data: { name: "Cliente novo" } });
  const detail = await request(app).get(`/api/v1/orders/${first.body.data.id}`).set("Cookie", owner.cookie);
  assert.equal(detail.body.data.items[0].name, vaccineA.name);
  assert.equal(detail.body.data.items[0].recipients[0].name, "Dependente Histórico");
  assert.equal(detail.body.data.customer.name, "Cliente orders-owner");

  const cancelled = await write(`/api/v1/orders/${first.body.data.id}/cancel`, owner.cookie).send({});
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data.status, "CANCELLED");
  const cancelledAt = cancelled.body.data.cancelledAt;
  const childSnapshot = JSON.stringify(cancelled.body.data.items);
  const repeated = await write(`/api/v1/orders/${first.body.data.id}/cancel`, owner.cookie).send({});
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.data.cancelledAt, cancelledAt);
  assert.equal(JSON.stringify(repeated.body.data.items), childSnapshot);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: second.body.data.id } })).status, "PENDING_PAYMENT");
});

test("security middleware enforces CSRF, CORS Idempotency-Key, no-store, 32kb, media type and rate limit", async () => {
  const customer = await createIdentity("orders-security");
  const vaccine = await createVaccine("Security");
  const intent = [item("VACCINE", vaccine.id)];
  assert.equal((await request(app).post("/api/v1/checkout/preview").set("Cookie", customer.cookie)
    .set("Origin", "https://evil.example").set("X-VacineKids-CSRF", "1").send({ items: intent })).status, 403);
  assert.equal((await request(app).post("/api/v1/checkout/preview").set("Cookie", customer.cookie)
    .set("Origin", origin).send({ items: intent })).status, 403);

  const preflight = await request(app).options("/api/v1/orders")
    .set("Origin", origin).set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "Content-Type,X-VacineKids-CSRF,Idempotency-Key");
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers["access-control-allow-headers"], /Idempotency-Key/);
  assert.equal(preflight.headers["access-control-allow-credentials"], "true");

  const malformed = await write("/api/v1/checkout/preview", customer.cookie)
    .set("Content-Type", "application/json").send("{broken");
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers["cache-control"], "no-store");
  assert.equal((await write("/api/v1/checkout/preview", customer.cookie)
    .set("Content-Type", "text/plain").send("plain")).status, 415);
  const huge = await write("/api/v1/checkout/preview", customer.cookie)
    .send({ items: intent, padding: "x".repeat(33 * 1024) });
  assert.equal(huge.status, 413);

  const shown = await preview(customer.cookie, intent);
  assert.equal(shown.status, 200);
  for (let index = 1; index < 60; index++) {
    assert.equal((await preview(customer.cookie, intent)).status, 200);
  }
  const limited = await preview(customer.cookie, intent);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, "RATE_LIMITED");

  const body = createBody(shown, intent);
  let createdId = "";
  for (let index = 0; index < 10; index++) {
    const response = await create(customer.cookie, randomUUID(), body);
    assert.equal(response.status, 201);
    createdId = response.body.data.id;
  }
  assert.equal((await create(customer.cookie, randomUUID(), body)).status, 429);
  assert.equal((await write(`/api/v1/orders/${createdId}/cancel`, customer.cookie).send({})).status, 429);
});

test("database dependency failures return redacted 503 responses", async () => {
  const customer = await createIdentity("orders-outage");
  const auth = createAuthService(prisma, undefined, "integration_test");
  const customerService = createCustomerService(prisma, "integration_test");
  const real = createOrderService(prisma);
  const unavailable = Object.assign(new Error("private orders database URL"), { code: "P1001" });
  app = createApp(auth, customerService, {
    ...real,
    preview: async () => { throw unavailable; },
    cancel: async () => { throw unavailable; }
  });
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const response = await write("/api/v1/checkout/preview", customer.cookie)
      .send({ items: [item("VACCINE", randomUUID())] });
    assert.equal(response.status, 503);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(JSON.stringify(response.body).includes("private"), false);
    assert.equal(JSON.stringify(logged).includes("private"), false);
    const cancel = await write(`/api/v1/orders/${randomUUID()}/cancel`, customer.cookie).send({});
    assert.equal(cancel.status, 503);
    assert.equal(JSON.stringify(cancel.body).includes("private"), false);
  } finally { console.error = original; }
});
