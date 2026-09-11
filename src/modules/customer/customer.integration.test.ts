import "../../../scripts/integration-bootstrap";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import request from "supertest";

const { createApp } = await import("../../app");
const { prisma } = await import("../../config/database");
const { hashPassword } = await import("../auth/auth.password");
const { createAuthService } = await import("../auth/auth.service");
const { createCustomerService } = await import("./customer.service");

const origin = "http://localhost:5173";
const password = "customer phase two test password";
const customerEmail = "customer-phase-two@example.test";
let passwordHash: string;
let app: ReturnType<typeof createApp>;

const clear = async () => {
  await prisma.paymentAttempt.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItemComponent.deleteMany();
  await prisma.orderItemRecipient.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.dependent.deleteMany();
  await prisma.customerProfile.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
};

before(async () => { passwordHash = await hashPassword(password); });
beforeEach(async () => { await clear(); app = createApp(); });
after(async () => { await clear(); await prisma.$disconnect(); });

const createUser = (email = customerEmail, role: "CUSTOMER" | "ADMIN" = "CUSTOMER", status: "ACTIVE" | "DISABLED" = "ACTIVE") =>
  prisma.user.create({ data: { email, passwordHash, role, status } });

const login = async (email = customerEmail) => {
  const result = await request(app).post("/api/v1/auth/login")
    .set("Origin", origin).set("X-VacineKids-CSRF", "1")
    .send({ email, password });
  assert.equal(result.status, 200);
  return String(result.headers["set-cookie"][0]).split(";")[0];
};

const authenticatedPut = (path: string, cookie: string) => request(app).put(path)
  .set("Cookie", cookie).set("Origin", origin).set("X-VacineKids-CSRF", "1");
const authenticatedPost = (path: string, cookie: string) => request(app).post(path)
  .set("Cookie", cookie).set("Origin", origin).set("X-VacineKids-CSRF", "1");
const authenticatedPatch = (path: string, cookie: string) => request(app).patch(path)
  .set("Cookie", cookie).set("Origin", origin).set("X-VacineKids-CSRF", "1");
const authenticatedDelete = (path: string, cookie: string) => request(app).delete(path)
  .set("Cookie", cookie).set("Origin", origin).set("X-VacineKids-CSRF", "1");

const createProfile = (cookie: string, name = "Cliente Exemplo") =>
  authenticatedPut("/api/v1/profile", cookie).send({ name, phone: "+5511999990001" });

test("visitor receives 401 when write guard does not take precedence", async () => {
  assert.equal((await request(app).get("/api/v1/profile")).status, 401);
  assert.equal((await request(app).get("/api/v1/dependents")).status, 401);
  assert.equal((await request(app).put("/api/v1/profile").set("Origin", origin)
    .set("X-VacineKids-CSRF", "1").send({ name: "Visitante", phone: "+5511999990001" })).status, 401);
});

test("profile is absent initially and PUT creates, normalizes, updates and preserves its id", async () => {
  const user = await createUser();
  const cookie = await login();
  const empty = await request(app).get("/api/v1/profile").set("Cookie", cookie);
  assert.equal(empty.status, 200);
  assert.equal(empty.headers["cache-control"], "no-store");
  assert.equal(empty.body.data, null);

  const created = await createProfile(cookie, "  Maria   Jose\u0301  ");
  assert.equal(created.status, 200);
  assert.equal(created.body.data.name, "Maria José");
  assert.equal(created.body.data.phone, "+5511999990001");
  assert.equal("userId" in created.body.data, false);
  const id = created.body.data.id;

  const repeated = await createProfile(cookie, "Maria José");
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.data.id, id);

  const updated = await authenticatedPut("/api/v1/profile", cookie)
    .send({ name: "Maria José Atualizada", phone: "+5511988880002" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.id, id);
  assert.equal(updated.body.data.name, "Maria José Atualizada");
  assert.equal(await prisma.customerProfile.count({ where: { userId: user.id } }), 1);
});

test("profile validates strict input, guards writes, rejects disabled users and does not leak data", async () => {
  const user = await createUser();
  const cookie = await login();
  for (const body of [
    { name: "A", phone: "+5511999990001" },
    { name: "Cliente Exemplo", phone: "(11) 99999-0001" },
    { name: "Cliente Exemplo", phone: "+5511999990001", userId: user.id }
  ]) assert.equal((await authenticatedPut("/api/v1/profile", cookie).send(body)).status, 422);

  const invalidJson = await request(app).put("/api/v1/profile").set("Cookie", cookie)
    .set("Origin", origin).set("X-VacineKids-CSRF", "1").set("Content-Type", "application/json")
    .send("{broken");
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJson.headers["cache-control"], "no-store");

  assert.equal((await request(app).put("/api/v1/profile").set("Cookie", cookie)
    .set("Origin", "https://evil.example").set("X-VacineKids-CSRF", "1")
    .send({ name: "Cliente Exemplo", phone: "+5511999990001" })).status, 403);
  assert.equal((await request(app).put("/api/v1/profile").set("Cookie", cookie).set("Origin", origin)
    .send({ name: "Cliente Exemplo", phone: "+5511999990001" })).status, 403);
  assert.equal(await prisma.customerProfile.count(), 0);

  await prisma.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });
  assert.equal((await request(app).get("/api/v1/profile").set("Cookie", cookie)).status, 401);
});

test("ADMIN receives 403 on every customer route and cannot create customer records", async () => {
  await createUser("admin-phase-two@example.test", "ADMIN");
  const cookie = await login("admin-phase-two@example.test");
  const id = "00000000-0000-4000-8000-000000000001";
  const responses = [
    await request(app).get("/api/v1/profile").set("Cookie", cookie),
    await authenticatedPut("/api/v1/profile", cookie).send({ name: "Admin Exemplo", phone: "+5511999990001" }),
    await request(app).get("/api/v1/dependents").set("Cookie", cookie),
    await authenticatedPost("/api/v1/dependents", cookie).send({ name: "Dependente", birthDate: "2020-01-01" }),
    await request(app).get(`/api/v1/dependents/${id}`).set("Cookie", cookie),
    await authenticatedPatch(`/api/v1/dependents/${id}`, cookie).send({ name: "Alterado" }),
    await authenticatedDelete(`/api/v1/dependents/${id}`, cookie)
  ];
  for (const response of responses) {
    assert.equal(response.status, 403);
    assert.equal(response.headers["cache-control"], "no-store");
  }
  assert.equal(await prisma.customerProfile.count(), 0);
  assert.equal(await prisma.dependent.count(), 0);
});

test("dependents require a profile and list is empty before profile creation", async () => {
  await createUser();
  const cookie = await login();
  const list = await request(app).get("/api/v1/dependents").set("Cookie", cookie);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.data, []);
  assert.deepEqual(list.body.meta, { page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const create = await authenticatedPost("/api/v1/dependents", cookie)
    .send({ name: "Lia Exemplo", birthDate: "2021-05-12" });
  assert.equal(create.status, 409);
  assert.equal(create.body.error.code, "PROFILE_REQUIRED");
});

test("creates, paginates, reads and partially updates owned dependents", async () => {
  await createUser();
  const cookie = await login();
  assert.equal((await createProfile(cookie)).status, 200);
  const inputs = [
    { name: "Zoe Exemplo", birthDate: "2022-01-15" },
    { name: "Ana Exemplo", birthDate: "2020-02-29" },
    { name: "Lia Exemplo", birthDate: "2021-05-12" }
  ];
  const created = [];
  for (const input of inputs) {
    const response = await authenticatedPost("/api/v1/dependents", cookie).send(input);
    assert.equal(response.status, 201);
    assert.equal(response.body.data.birthDate, input.birthDate);
    assert.equal("customerProfileId" in response.body.data, false);
    assert.equal("deletedAt" in response.body.data, false);
    created.push(response.body.data);
  }
  const list = await request(app).get("/api/v1/dependents?page=1&pageSize=2").set("Cookie", cookie);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.meta, { page: 1, pageSize: 2, total: 3, totalPages: 2 });
  assert.deepEqual(list.body.data.map((item: { name: string }) => item.name), ["Ana Exemplo", "Lia Exemplo"]);

  const own = await request(app).get(`/api/v1/dependents/${created[0].id}`).set("Cookie", cookie);
  assert.equal(own.status, 200);
  const renamed = await authenticatedPatch(`/api/v1/dependents/${created[0].id}`, cookie)
    .send({ name: "  Zoé   Atualizada " });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.data.name, "Zoé Atualizada");
  const reborn = await authenticatedPatch(`/api/v1/dependents/${created[0].id}`, cookie)
    .send({ birthDate: "2019-03-10" });
  assert.equal(reborn.body.data.birthDate, "2019-03-10");
});

test("soft delete hides a dependent and repeated access consistently returns 404", async () => {
  await createUser();
  const cookie = await login();
  await createProfile(cookie);
  const created = await authenticatedPost("/api/v1/dependents", cookie)
    .send({ name: "Dependente Removível", birthDate: "2020-01-01" });
  const path = `/api/v1/dependents/${created.body.data.id}`;
  assert.equal((await authenticatedDelete(path, cookie)).status, 204);
  const stored = await prisma.dependent.findUniqueOrThrow({ where: { id: created.body.data.id } });
  assert.ok(stored.deletedAt);
  assert.deepEqual((await request(app).get("/api/v1/dependents").set("Cookie", cookie)).body.data, []);
  assert.equal((await request(app).get(path).set("Cookie", cookie)).status, 404);
  assert.equal((await authenticatedPatch(path, cookie).send({ name: "Não alterar" })).status, 404);
  assert.equal((await authenticatedDelete(path, cookie)).status, 404);
});

test("BOLA attempts return 404 and cannot read, modify or delete another customer's dependent", async () => {
  const userA = await createUser("customer-a@example.test");
  const cookieA = await login("customer-a@example.test");
  await createProfile(cookieA, "Cliente A");
  const dependent = await authenticatedPost("/api/v1/dependents", cookieA)
    .send({ name: "Dependente A", birthDate: "2018-10-03" });

  await createUser("customer-b@example.test");
  const cookieB = await login("customer-b@example.test");
  await createProfile(cookieB, "Cliente B");
  const path = `/api/v1/dependents/${dependent.body.data.id}`;
  assert.equal((await request(app).get(path).set("Cookie", cookieB)).status, 404);
  assert.equal((await authenticatedPatch(path, cookieB).send({ name: "Ataque BOLA" })).status, 404);
  assert.equal((await authenticatedDelete(path, cookieB)).status, 404);

  const stored = await prisma.dependent.findUniqueOrThrow({ where: { id: dependent.body.data.id } });
  assert.equal(stored.name, "Dependente A");
  assert.equal(stored.birthDate.toISOString().slice(0, 10), "2018-10-03");
  assert.equal(stored.deletedAt, null);
  assert.equal((await prisma.customerProfile.findUniqueOrThrow({ where: { userId: userA.id } })).name, "Cliente A");
});

test("dependent schemas reject invalid UUID, impossible/future dates, extras and invalid queries", async () => {
  await createUser();
  const cookie = await login();
  await createProfile(cookie);
  assert.equal((await request(app).get("/api/v1/dependents/not-a-uuid").set("Cookie", cookie)).status, 422);
  assert.equal((await request(app).get("/api/v1/dependents/00000000-0000-4000-8000-000000000099").set("Cookie", cookie)).status, 404);
  for (const body of [
    { name: "Dependente", birthDate: "2021-02-29" },
    { name: "Dependente", birthDate: "2999-01-01" },
    { name: "Dependente", birthDate: "2020-01-01T00:00:00Z" },
    { name: "Dependente", birthDate: "2020-01-01", customerProfileId: randomUUID() }
  ]) assert.equal((await authenticatedPost("/api/v1/dependents", cookie).send(body)).status, 422);
  assert.equal((await request(app).get("/api/v1/dependents?includeDeleted=true").set("Cookie", cookie)).status, 422);
  assert.equal((await authenticatedPatch("/api/v1/dependents/00000000-0000-4000-8000-000000000099", cookie).send({})).status, 422);
});

test("dependent writes enforce Origin and CSRF before causing side effects", async () => {
  await createUser();
  const cookie = await login();
  await createProfile(cookie);
  const body = { name: "Dependente Protegido", birthDate: "2020-01-01" };
  assert.equal((await request(app).post("/api/v1/dependents").set("Cookie", cookie)
    .set("Origin", "https://evil.example").set("X-VacineKids-CSRF", "1").send(body)).status, 403);
  assert.equal((await request(app).post("/api/v1/dependents").set("Cookie", cookie)
    .set("Origin", origin).send(body)).status, 403);
  assert.equal(await prisma.dependent.count(), 0);
});

test("database outage is 503 and neither response nor logs expose private details", async () => {
  const identity = { id: randomUUID(), email: customerEmail, role: "CUSTOMER" as const, status: "ACTIVE" as const };
  const auth = createAuthService(prisma, undefined, "integration_test");
  const customer = createCustomerService(prisma, "integration_test");
  const unavailable = Object.assign(new Error("private customer database details"), { code: "P1001" });
  app = createApp(
    { ...auth, authenticate: async () => identity },
    { ...customer, getProfile: async () => { throw unavailable; } }
  );
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const response = await request(app).get("/api/v1/profile");
    assert.equal(response.status, 503);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(JSON.stringify(response.body).includes("private"), false);
    assert.equal(JSON.stringify(logged).includes("private"), false);
  } finally { console.error = original; }
});
