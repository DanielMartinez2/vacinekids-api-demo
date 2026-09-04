import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { registerSchema, loginSchema } from "./auth.schemas";
import { hashPassword, verifyPassword, getDummyHash, passwordOptions } from "./auth.password";
import { hashToken, newSessionToken, validToken, SESSION_SECONDS } from "./auth.session";
import { sessionCookie } from "./auth.cookies";
import { HttpError } from "../../lib/http-error";
import { requireRole } from "../../middlewares/auth";
import type { Request, Response } from "express";
import type { AuthService, PublicUser } from "./auth.service";

// Unit HTTP tests inject a service; never connect to the inherited .env database.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://unit:unit@127.0.0.1:1/vacinekids_demo?schema=integration_test";
process.env.DATABASE_URL_UNPOOLED = "";
process.env.FRONTEND_URL = "http://localhost:5173";
const { createApp } = await import("../../app");
const user: PublicUser = { id: "00000000-0000-4000-8000-000000000001", email: "unit@example.test", role: "CUSTOMER", status: "ACTIVE" };
const fakeService = (overrides: Partial<AuthService> = {}): AuthService => ({
  register: async () => {}, login: async () => ({ user, token: newSessionToken().token }),
  authenticate: async () => user, logout: async () => {}, ...overrides
});
const post = (app: ReturnType<typeof createApp>, route: string) => request(app).post(`/api/v1/auth/${route}`)
  .set("Origin", "http://localhost:5173").set("X-VacineKids-CSRF", "1");
const credentials = { email: "unit@example.test", password: "long unit test passphrase" };

test("registration normalizes email and NFC without trimming passwords; Unicode code points", () => {
  const value = registerSchema.parse({ email: "  USER@Example.test  ", password: "  e\u0301".repeat(6) });
  assert.equal(value.email, "user@example.test");
  assert.equal(value.password, "  é".repeat(6));
  for (const password of ["a".repeat(15), " ".repeat(15), "😀".repeat(128)]) assert.ok(registerSchema.safeParse({ ...credentials, password }).success);
  for (const password of ["a".repeat(14), "😀".repeat(129)]) assert.equal(registerSchema.safeParse({ ...credentials, password }).success, false);
  assert.ok(loginSchema.safeParse({ ...credentials, password: "x" }).success);
});

test("strict auth payloads reject role/status/passwordHash and malformed email", () => {
  for (const key of ["role", "status", "passwordHash"]) {
    assert.equal(registerSchema.safeParse({ ...credentials, [key]: "ADMIN" }).success, false);
    assert.equal(loginSchema.safeParse({ ...credentials, [key]: "ADMIN" }).success, false);
  }
  assert.equal(registerSchema.safeParse({ ...credentials, email: "bad" }).success, false);
});

test("Argon2id parameters, unique salts, verify and NFC equivalence", async () => {
  const first = await hashPassword("e\u0301".repeat(16));
  const second = await hashPassword("é".repeat(16));
  assert.match(first, /^\$argon2id\$v=19\$/);
  assert.deepEqual(first.split("$")[3].split(",").sort(), ["m=65536", "p=1", "t=3"]);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(first, "é".repeat(16)), true);
  assert.equal(await verifyPassword(first, "wrong password"), false);
  assert.equal(passwordOptions.hashLength, 32);
  assert.deepEqual((await getDummyHash()).split("$")[3].split(",").sort(), ["m=65536", "p=1", "t=3"]);
});

test("session entropy/format, SHA-256 and absolute seven-day expiry", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const session = newSessionToken(now);
  assert.ok(validToken(session.token));
  assert.equal(session.token.length, 43);
  assert.match(session.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(hashToken(session.token), session.tokenHash);
  assert.notEqual(session.token, session.tokenHash);
  assert.notEqual(newSessionToken().token, session.token);
  assert.equal(session.expiresAt.getTime() - now.getTime(), SESSION_SECONDS * 1000);
  for (const token of [null, [], {}, "x", "a".repeat(44), "!".repeat(43)]) assert.equal(validToken(token), false);
});

test("cookies explicitly distinguish local and production without Domain", () => {
  for (const environment of ["development", "test", "production"]) {
    const cookie = sessionCookie(environment);
    assert.equal(cookie.name, environment === "production" ? "__Host-vacinekids_session" : "vacinekids_session");
    assert.deepEqual(cookie.options, { httpOnly: true, secure: environment === "production", sameSite: "lax", path: "/" });
  }
});

test("requireRole fails closed if invoked without requireAuth", () => {
  assert.throws(() => requireRole("ADMIN")({} as Request, {} as Response, () => {}),
    (error: unknown) => error instanceof HttpError && error.statusCode === 401);
});

test("Prisma adapter nested connection failures are 503 with no internal details", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    for (const kind of ["DatabaseNotReachable", "ConnectionClosed", "SocketTimeout", "TlsConnectionError"]) {
      const app = createApp(fakeService({ authenticate: async () => {
        throw { code: "P2010", meta: { driverAdapterError: { cause: { kind, host: "private-host", reason: "private-secret" } } } };
      } }));
      const result = await request(app).get("/api/v1/auth/me");
      assert.equal(result.status, 503);
      assert.equal(JSON.stringify(result.body).includes("private"), false);
    }
  } finally { console.error = original; }
});

test("Origin and CSRF rejected before service effects, including logout", async () => {
  let called = 0;
  const app = createApp(fakeService({ register: async () => { called++; }, logout: async () => { called++; } }));
  for (const origin of [undefined, "null", "http://localhost:5173.evil.test", "http://localhost:5173/path"]) {
    for (const route of ["register", "logout"]) {
      let req = request(app).post(`/api/v1/auth/${route}`).set("X-VacineKids-CSRF", "1");
      if (origin) req = req.set("Origin", origin);
      const result = await req.send(credentials);
      assert.equal(result.status, 403);
      assert.equal(result.headers["cache-control"], "no-store");
    }
  }
  assert.equal((await request(app).post("/api/v1/auth/register").set("Origin", "http://localhost:5173").send(credentials)).status, 403);
  assert.equal(called, 0);
  assert.equal((await post(app, "register").send(credentials)).status, 200);
  assert.equal(called, 1);
});

test("preflight allows exact origin and credentials without authentication", async () => {
  const response = await request(createApp(fakeService())).options("/api/v1/auth/login")
    .set("Origin", "http://localhost:5173").set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "Content-Type,X-VacineKids-CSRF");
  assert.equal(response.status, 204);
  assert.equal(response.headers["access-control-allow-origin"], "http://localhost:5173");
  assert.equal(response.headers["access-control-allow-credentials"], "true");
  assert.match(response.headers["access-control-allow-headers"], /X-VacineKids-CSRF/);
});

test("400/413/415/422 with no-store and no sensitive body reflection", async () => {
  const app = createApp(fakeService());
  for (const [body, contentType, status] of [["{broken", "application/json", 400],
    ["secret".repeat(2000), "application/json", 413], ["secret", "text/plain", 415]] as const) {
    const result = await post(app, "register").set("Content-Type", contentType).send(body);
    assert.equal(result.status, status);
    assert.equal(result.headers["cache-control"], "no-store");
    assert.equal(JSON.stringify(result.body).includes("secret"), false);
  }
  assert.equal((await post(app, "register").send({ ...credentials, role: "ADMIN" })).status, 422);
});

test("503 on database failure for me/logout, no false cookie removal; 500 logs redact secrets", async () => {
  const secret = "sensitive-password-cookie-database-url";
  const unavailable = Object.assign(new Error(secret), { code: "ECONNREFUSED" });
  const app = createApp(fakeService({ authenticate: async () => { throw unavailable; }, logout: async () => { throw unavailable; } }));
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    assert.equal((await request(app).get("/api/v1/auth/me")).status, 503);
    const result = await post(app, "logout").send({});
    assert.equal(result.status, 503);
    assert.equal(result.headers["set-cookie"], undefined);
    const unexpected = createApp(fakeService({ register: async () => { throw new Error(secret); } }));
    const error = await post(unexpected, "register").send(credentials);
    assert.equal(error.status, 500);
    assert.equal(JSON.stringify(error.body).includes(secret), false);
    assert.equal(JSON.stringify(logged).includes(secret), false);
    assert.ok(logged.length >= 3);
  } finally { console.error = original; }
});

test("identity limit: ten failures for existing and nonexistent identities, Retry-After", async () => {
  for (const email of ["existing@example.test", "absent@example.test"]) {
    const app = createApp(fakeService({ login: async () => { throw new HttpError(401, "INVALID_CREDENTIALS", "Email ou senha inválidos."); } }));
    for (let index = 0; index < 10; index++) assert.equal((await post(app, "login").send({ ...credentials, email })).status, 401);
    const denied = await post(app, "login").send({ ...credentials, email });
    assert.equal(denied.status, 429);
    assert.ok(Number(denied.headers["retry-after"]) > 0);
    assert.equal(JSON.stringify(denied.body).includes(email), false);
  }
});

test("login IP limit is fifty attempts; successful requests do not exhaust identity limit", async () => {
  const app = createApp(fakeService());
  for (let index = 0; index < 50; index++) assert.equal((await post(app, "login").send(credentials)).status, 200);
  const denied = await post(app, "login").send(credentials);
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers["retry-after"]) > 0);
});

test("registration IP limit five/hour and independent stores per application", async () => {
  const app = createApp(fakeService());
  for (let index = 0; index < 5; index++) assert.equal((await post(app, "register").send(credentials)).status, 200);
  const denied = await post(app, "register").send(credentials);
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers["retry-after"]) > 3500);
  assert.equal((await post(createApp(fakeService()), "register").send(credentials)).status, 200);
});
