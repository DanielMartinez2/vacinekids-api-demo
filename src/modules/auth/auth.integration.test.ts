import "../../../scripts/integration-bootstrap";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import request from "supertest";

// Validation above executes before either database-aware module is imported.
const { prisma } = await import("../../config/database");
const { createApp } = await import("../../app");
const { hashPassword, verifyPassword } = await import("./auth.password");
const { newSessionToken, hashToken } = await import("./auth.session");
const { promoteAdmin } = await import("../../../scripts/promote-admin.service");
const { createAuthService } = await import("./auth.service");
const origin = "http://localhost:5173";
const password = "uma senha longa de teste";
const email = "customer@example.test";
let fixtureHash: string;
let app: ReturnType<typeof createApp>;

const clear = async () => {
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.ageRange.deleteMany();
};
before(async () => { fixtureHash = await hashPassword(password); });
beforeEach(async () => { await clear(); app = createApp(); });
after(async () => { await clear(); await prisma.$disconnect(); });

const post = (route: string) => request(app).post(`/api/v1/auth/${route}`)
  .set("Origin", origin).set("X-VacineKids-CSRF", "1");
const fixture = (role: "CUSTOMER" | "ADMIN" = "CUSTOMER", status: "ACTIVE" | "DISABLED" = "ACTIVE", userEmail = email) =>
  prisma.user.create({ data: { email: userEmail, passwordHash: fixtureHash, role, status } });
const cookieFrom = (response: request.Response) => String(response.headers["set-cookie"][0]).split(";")[0];
const tokenFrom = (cookie: string) => cookie.slice(cookie.indexOf("=") + 1);
const login = async (userEmail = email) => {
  const result = await post("login").send({ email: userEmail, password });
  assert.equal(result.status, 200);
  return { result, cookie: cookieFrom(result) };
};
const me = (cookie?: string) => {
  const req = request(app).get("/api/v1/auth/me");
  return cookie ? req.set("Cookie", cookie) : req;
};
const assertPublic = (data: Record<string, unknown>) => assert.deepEqual(Object.keys(data).sort(), ["email", "id", "role", "status"]);

test("register creates normalized ACTIVE CUSTOMER, hash only, no auto-login; duplicate contract", async () => {
  const first = await post("register").send({ email: "  CUSTOMER@Example.test ", password });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { data: { message: "Solicitação processada. Você já pode tentar entrar com os dados informados." }, error: null });
  assert.equal(first.headers["set-cookie"], undefined);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  assert.equal(user.role, "CUSTOMER");
  assert.equal(user.status, "ACTIVE");
  assert.notEqual(user.passwordHash, password);
  assert.equal(await verifyPassword(user.passwordHash, password), true);
  await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN", status: "DISABLED" } });
  const duplicate = await post("register").send({ email, password: "a different long password" });
  assert.equal(duplicate.status, 200);
  assert.deepEqual(duplicate.body, first.body);
  const unchanged = await prisma.user.findUniqueOrThrow({ where: { email } });
  assert.equal(unchanged.passwordHash, user.passwordHash);
  assert.equal(unchanged.role, "ADMIN");
  assert.equal(unchanged.status, "DISABLED");
  assert.equal(await prisma.session.count(), 0);
});

test("register rejects privileged extra properties without creating accounts", async () => {
  for (const [key, value] of [["role", "ADMIN"], ["status", "DISABLED"], ["passwordHash", "secret"]]) {
    assert.equal((await post("register").send({ email, password, [key]: value })).status, 422);
  }
  assert.equal(await prisma.user.count(), 0);
});

test("concurrent duplicate registration produces one user and identical success", async () => {
  const responses = await Promise.all([post("register").send({ email, password }), post("register").send({ email, password })]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.deepEqual(responses[0].body, responses[1].body);
  assert.equal(await prisma.user.count(), 1);
  assert.equal(await prisma.session.count(), 0);
});

test("database CHECK rejects unnormalized email; FK cascade and unique hash", async () => {
  await assert.rejects(prisma.user.create({ data: { email: " Upper@Example.test ", passwordHash: fixtureHash } }));
  const user = await fixture();
  const session = newSessionToken();
  const data = { userId: user.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt };
  await prisma.session.create({ data });
  await assert.rejects(prisma.session.create({ data }));
  await prisma.user.delete({ where: { id: user.id } });
  assert.equal(await prisma.session.count(), 0);
});

test("login sets safe cookie, returns public user and persists only SHA-256", async () => {
  const user = await fixture();
  const { result, cookie } = await login();
  assertPublic(result.body.data);
  assert.equal(result.body.data.id, user.id);
  const header = String(result.headers["set-cookie"][0]);
  for (const attribute of ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=604800"]) assert.ok(header.includes(attribute));
  assert.equal(header.includes("Secure"), false);
  assert.equal(header.includes("Domain="), false);
  const session = await prisma.session.findFirstOrThrow();
  const token = tokenFrom(cookie);
  assert.equal(session.tokenHash, hashToken(token));
  assert.notEqual(session.tokenHash, token);
  assert.equal(JSON.stringify(session).includes(token), false);
  assert.equal(JSON.stringify(result.body).includes(token), false);
  assert.ok(Math.abs(session.expiresAt.getTime() - session.createdAt.getTime() - 604800000) < 2000);
});

test("unknown email, incorrect password and disabled user have identical 401", async () => {
  const user = await fixture();
  const unknown = await post("login").send({ email: "missing@example.test", password });
  const wrong = await post("login").send({ email, password: "a different wrong password" });
  await prisma.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });
  const disabled = await post("login").send({ email, password });
  for (const result of [unknown, wrong, disabled]) {
    assert.equal(result.status, 401);
    assert.equal(result.headers["set-cookie"], undefined);
    assert.equal(result.body.error.message, "Email ou senha inválidos.");
    assert.deepEqual(result.body, unknown.body);
  }
  assert.equal(await prisma.session.count(), 0);
});

test("NFC and passphrase spaces are consistent across registration/login", async () => {
  const decomposed = " e\u0301".repeat(8) + " ";
  assert.equal((await post("register").send({ email, password: decomposed })).status, 200);
  assert.equal((await post("login").send({ email, password: decomposed.normalize("NFC") })).status, 200);
  assert.equal((await post("login").send({ email, password: decomposed.trim() })).status, 401);
});

test("me is safe, no-store, reads current role and never slides expiration", async () => {
  const user = await fixture();
  const { cookie } = await login();
  const before = await prisma.session.findFirstOrThrow();
  const result = await me(cookie);
  assert.equal(result.status, 200);
  assertPublic(result.body.data);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.headers["set-cookie"], undefined);
  await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
  assert.equal((await me(cookie)).body.data.role, "ADMIN");
  const after = await prisma.session.findFirstOrThrow();
  assert.deepEqual(after, before);
});

test("me rejects missing, malformed, unknown, expired, revoked and disabled sessions", async () => {
  const user = await fixture();
  const { cookie } = await login();
  for (const value of [undefined, "vacinekids_session=bad", `vacinekids_session=${newSessionToken().token}`]) assert.equal((await me(value)).status, 401);
  await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
  assert.equal((await me(cookie)).status, 401);
  await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() + 60000), revokedAt: new Date() } });
  assert.equal((await me(cookie)).status, 401);
  await prisma.session.updateMany({ data: { revokedAt: null } });
  await prisma.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });
  assert.equal((await me(cookie)).status, 401);
});

test("login rotates only the browser's previous session, preserving other devices", async () => {
  await fixture();
  const first = await login();
  const other = await login();
  const rotated = await post("login").set("Cookie", first.cookie).send({ email, password });
  assert.equal(rotated.status, 200);
  assert.notEqual(cookieFrom(rotated), first.cookie);
  assert.equal((await me(first.cookie)).status, 401);
  assert.equal((await me(other.cookie)).status, 200);
  assert.equal((await me(cookieFrom(rotated))).status, 200);
});

test("logout revokes server session, clears exact cookie, blocks replay and is idempotent", async () => {
  await fixture();
  const { cookie } = await login();
  const result = await post("logout").set("Cookie", cookie).send({});
  assert.equal(result.status, 204);
  assert.equal(result.text, "");
  const header = String(result.headers["set-cookie"][0]);
  assert.match(header, /^vacinekids_session=;/);
  for (const value of ["Path=/", "HttpOnly", "SameSite=Lax", "Expires=Thu, 01 Jan 1970"]) assert.ok(header.includes(value));
  assert.ok((await prisma.session.findFirstOrThrow()).revokedAt);
  assert.equal((await me(cookie)).status, 401);
  assert.equal((await post("logout").set("Cookie", cookie).send({})).status, 204);
  assert.equal((await post("logout").send({})).status, 204);
});

test("catalog writes require ADMIN and public reads remain available", async () => {
  await fixture();
  const customer = await login();
  await fixture("ADMIN", "ACTIVE", "admin@example.test");
  const admin = await login("admin@example.test");
  const id = "00000000-0000-4000-8000-000000000001";
  for (const resource of ["vaccines", "packages", "age-ranges"]) {
    assert.equal((await request(app).get(`/api/v1/${resource}`)).status, 200);
    for (const method of ["post", "patch", "delete"] as const) {
      for (const [cookie, expected] of [[undefined, 401], [customer.cookie, 403]] as const) {
        let req = request(app)[method](`/api/v1/${resource}${method === "post" ? "" : `/${id}`}`)
          .set("Origin", origin).set("X-VacineKids-CSRF", "1");
        if (cookie) req = req.set("Cookie", cookie);
        assert.equal((await req.send({})).status, expected);
      }
    }
    for (const [cookie, expected] of [[undefined, 401], [customer.cookie, 403], [admin.cookie, 200]] as const) {
      let req = request(app).get(`/api/v1/${resource}?includeDeleted=true`);
      if (cookie) req = req.set("Cookie", cookie);
      assert.equal((await req).status, expected);
    }
  }
  const created = await request(app).post("/api/v1/age-ranges").set("Origin", origin)
    .set("X-VacineKids-CSRF", "1").set("Cookie", admin.cookie).send({ slug: "auth-test", name: "Auth Test", sortOrder: 0 });
  assert.equal(created.status, 201);
});

test("write guard blocks catalog side effects even for ADMIN", async () => {
  await fixture("ADMIN");
  const { cookie } = await login();
  for (const value of [undefined, "null", "https://evil.example"]) {
    let req = request(app).post("/api/v1/age-ranges").set("Cookie", cookie).set("X-VacineKids-CSRF", "1");
    if (value) req = req.set("Origin", value);
    assert.equal((await req.send({ slug: "csrf-test", name: "CSRF Test" })).status, 403);
  }
  assert.equal(await prisma.ageRange.count(), 0);
});

test("ADMIN CLI service defaults dry-run, requires exact confirmation, revokes all sessions", async () => {
  const user = await fixture();
  const first = await login();
  const second = await login();
  const preview = await promoteAdmin(prisma, " CUSTOMER@EXAMPLE.TEST ");
  assert.equal(preview.dryRun, true);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role, "CUSTOMER");
  await assert.rejects(promoteAdmin(prisma, email, "yes"));
  assert.equal(await prisma.session.count({ where: { revokedAt: null } }), 2);
  const promoted = await promoteAdmin(prisma, email, `PROMOTE ${user.id}`);
  assert.equal(promoted.user.role, "ADMIN");
  assert.equal(promoted.revokedSessions, 2);
  assert.equal((await me(first.cookie)).status, 401);
  assert.equal((await me(second.cookie)).status, 401);
  assert.equal((await login()).result.body.data.role, "ADMIN");
  await assert.rejects(promoteAdmin(prisma, email));
  await assert.rejects(promoteAdmin(prisma, "missing@example.test"));
});

test("CLI rejects disabled customers", async () => {
  const user = await fixture("CUSTOMER", "DISABLED");
  await assert.rejects(promoteAdmin(prisma, email, `PROMOTE ${user.id}`));
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role, "CUSTOMER");
});

test("CLI transaction rolls back promotion when session revocation fails", async () => {
  const user = await fixture();
  await login();
  const failingDb = prisma.$extends({ query: { session: { updateMany: async () => { throw new Error("injected revocation failure"); } } } });
  await assert.rejects(promoteAdmin(failingDb as unknown as typeof prisma, email, `PROMOTE ${user.id}`));
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role, "CUSTOMER");
  assert.equal(await prisma.session.count({ where: { revokedAt: null } }), 1);
});

test("expired session at the exact clock boundary is invalid", async () => {
  const user = await fixture();
  const session = newSessionToken();
  await prisma.session.create({ data: { userId: user.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt } });
  const service = createAuthService(prisma, () => session.expiresAt, "integration_test");
  await assert.rejects(service.authenticate(session.token), (error: unknown) => (error as { statusCode: number }).statusCode === 401);
});

test("login rate limit also applies to nonexistent accounts with the real service", async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await post("login").send({ email: "absent@example.test", password })).status, 401);
  }
  const limited = await post("login").send({ email: "absent@example.test", password });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers["retry-after"]) > 0);
  assert.equal(await prisma.user.count(), 0);
});

test("direct integration entry rejects inherited remote/runtime URLs before importing app", () => {
  const file = fileURLToPath(new URL("../catalog/catalog.integration.test.ts", import.meta.url));
  const child = spawnSync(process.execPath, ["--import", "tsx", file], {
    encoding: "utf8", env: { ...process.env, NODE_ENV: "production", DATABASE_URL: "postgresql://redacted@ep-test.neon.tech/neondb" }
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /Integration tests aborted/);
  assert.equal(child.stderr.includes("redacted@"), false);
});

test("me and logout handle injected database outage without exposing internals", async () => {
  const user = await fixture();
  const { cookie } = await login();
  // Fault injection does not stop PostgreSQL or affect public/local development data.
  const service = createAuthService(prisma, undefined, "integration_test");
  const unavailable = Object.assign(new Error("private database connection details"), { code: "P1001" });
  app = createApp({ ...service, authenticate: async () => { throw unavailable; }, logout: async () => { throw unavailable; } });
  assert.equal((await me(cookie)).status, 503);
  const result = await post("logout").set("Cookie", cookie).send({});
  assert.equal(result.status, 503);
  assert.equal(result.headers["set-cookie"], undefined);
  assert.equal(JSON.stringify(result.body).includes("private"), false);
  assert.equal(await prisma.session.count({ where: { userId: user.id, revokedAt: null } }), 1);
});
