import "../../../scripts/integration-bootstrap";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import request from "supertest";
import type { PaymentProviderAdapter, ProviderAttemptInput } from "./payments.provider";
import type { PaymentServiceOptions } from "./payments.service";

const { createApp } = await import("../../app");
const { prisma } = await import("../../config/database");
const { hashPassword } = await import("../auth/auth.password");
const { createAuthService } = await import("../auth/auth.service");
const { createCustomerService } = await import("../customer/customer.service");
const { createOrderService } = await import("../orders/orders.service");
const { createPaymentService } = await import("./payments.service");
const { DemoPaymentProvider } = await import("./providers/demo-payment-provider");
const { PaymentProviderFailure } = await import("./payments.provider");

const origin = "http://localhost:5173";
const password = "payments integration test password";
let passwordHash: string;
let app: ReturnType<typeof createApp>;

type Handler = (input: ProviderAttemptInput, call: number) => unknown | Promise<unknown>;

class FakeProvider implements PaymentProviderAdapter {
  readonly provider = "DEMO" as const;
  readonly method = "DEMO" as const;
  readonly calls: ProviderAttemptInput[] = [];

  constructor(private readonly handler: Handler, private readonly available = true) {}
  isAvailable() { return this.available; }
  async createOrResumeAttempt(input: ProviderAttemptInput) {
    this.calls.push(input);
    return this.handler(input, this.calls.length);
  }
  async getAttemptStatus(input: ProviderAttemptInput) {
    return this.handler(input, this.calls.length);
  }
}

const providerId = (key: string) => `demo_${createHash("sha256").update(key).digest("hex").slice(0, 40)}`;
const result = (input: ProviderAttemptInput, status: "APPROVED" | "REJECTED" | "PROCESSING" | "ERROR") => ({
  providerPaymentId: providerId(input.providerIdempotencyKey),
  status,
  providerStatus: status.toLowerCase(),
  providerStatusDetail: `demo_${status.toLowerCase()}`,
  expiresAt: null
});

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

const createIdentity = async (label: string, role: "CUSTOMER" | "ADMIN" = "CUSTOMER") => {
  const user = await prisma.user.create({
    data: { email: `${label}@example.test`, passwordHash, role }
  });
  const profile = role === "CUSTOMER" ? await prisma.customerProfile.create({
    data: { userId: user.id, name: `Cliente ${label}`, phone: "+5511999990001" }
  }) : null;
  const login = await request(app).post("/api/v1/auth/login")
    .set("Origin", origin).set("X-VacineKids-CSRF", "1")
    .send({ email: user.email, password });
  assert.equal(login.status, 200);
  return { user, profile, cookie: String(login.headers["set-cookie"][0]).split(";")[0] };
};

const createOrder = (profileId: string, amount = "979.60", status: "PENDING_PAYMENT" | "CANCELLED" = "PENDING_PAYMENT") =>
  prisma.order.create({
    data: {
      number: `VK-${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`,
      customerProfileId: profileId,
      status,
      currency: "BRL",
      totalAmount: amount,
      customerNameSnapshot: "Cliente Payment",
      customerEmailSnapshot: "payment@example.test",
      customerPhoneSnapshot: "+5511999990001",
      idempotencyKey: randomUUID(),
      requestHash: "a".repeat(64),
      checkoutFingerprint: "b".repeat(64),
      checkoutFingerprintVersion: 1,
      cancelledAt: status === "CANCELLED" ? new Date() : null
    }
  });

const useProvider = (
  provider: PaymentProviderAdapter,
  options: PaymentServiceOptions = {},
  rateLimits?: { windowMs?: number; attemptLimit?: number; readLimit?: number }
) => {
  const auth = createAuthService(prisma, undefined, "integration_test");
  const customer = createCustomerService(prisma, "integration_test");
  const orders = createOrderService(prisma, undefined, undefined, "integration_test");
  const payments = createPaymentService(prisma, provider, { ...options, schema: "integration_test" });
  app = createApp(auth, customer, orders, payments, rateLimits);
};

const postAttempt = (cookie: string, orderId: string, key: string, body: object | string = {}) =>
  request(app).post(`/api/v1/orders/${orderId}/payment-attempts`)
    .set("Cookie", cookie).set("Origin", origin).set("X-VacineKids-CSRF", "1")
    .set("Idempotency-Key", key).send(body);

const getPayment = (cookie: string, orderId: string) =>
  request(app).get(`/api/v1/orders/${orderId}/payment`).set("Cookie", cookie);

test("payment routes enforce authentication, CUSTOMER ownership and GET null", async () => {
  const owner = await createIdentity("payment-owner");
  const other = await createIdentity("payment-other");
  const admin = await createIdentity("payment-admin", "ADMIN");
  const order = await createOrder(owner.profile!.id);
  useProvider(new DemoPaymentProvider(true));

  assert.equal((await request(app).get(`/api/v1/orders/${order.id}/payment`)).status, 401);
  assert.equal((await getPayment(admin.cookie, order.id)).status, 403);
  assert.equal((await postAttempt(admin.cookie, order.id, randomUUID())).status, 403);
  assert.equal((await getPayment(other.cookie, order.id)).status, 404);
  assert.equal((await postAttempt(other.cookie, order.id, randomUUID())).status, 404);
  const empty = await getPayment(owner.cookie, order.id);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { data: null, error: null });
  assert.equal(empty.headers["cache-control"], "no-store");
});

test("nominal DEMO creates one lazy Payment and atomically pays the Order", async () => {
  const customer = await createIdentity("payment-nominal");
  const order = await createOrder(customer.profile!.id, "0.30");
  useProvider(new DemoPaymentProvider(true));
  const response = await postAttempt(customer.cookie, order.id, randomUUID());
  assert.equal(response.status, 201);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(
    { status: response.body.data.status, amount: response.body.data.amount, currency: response.body.data.currency },
    { status: "PAID", amount: "0.30", currency: "BRL" }
  );
  assert.equal(response.body.data.latestAttempt.status, "APPROVED");
  for (const privateField of [
    "idempotencyKey", "requestHash", "providerIdempotencyKey", "providerPaymentId",
    "providerStatus", "providerStatusDetail", "providerRequestedAt", "dispatchLeaseUntil"
  ]) assert.equal(privateField in response.body.data.latestAttempt, false);
  const stored = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id }, include: { attempts: true } });
  assert.equal(stored.amount.toFixed(2), "0.30");
  assert.equal(stored.attempts.length, 1);
  assert.equal(stored.attempts[0].providerIdempotencyKey, stored.attempts[0].id);
  assert.equal(stored.attempts[0].completedAt?.getTime(), stored.paidAt?.getTime());
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PAID");
  assert.equal((await request(app).get(`/api/v1/orders/${order.id}`).set("Cookie", customer.cookie)).body.data.status, "PAID");
  assert.equal((await request(app).get("/api/v1/orders").set("Cookie", customer.cookie)).body.data[0].status, "PAID");
});

test("same-key replay preserves IDs, provider ID and terminal timestamps while a new key is blocked", async () => {
  const customer = await createIdentity("payment-replay");
  const order = await createOrder(customer.profile!.id);
  const provider = new FakeProvider((input) => result(input, "APPROVED"));
  useProvider(provider);
  const key = randomUUID();
  const first = await postAttempt(customer.cookie, order.id, key);
  const storedFirst = await prisma.paymentAttempt.findFirstOrThrow();
  const repeated = await postAttempt(customer.cookie, order.id, key);
  const storedRepeated = await prisma.paymentAttempt.findFirstOrThrow();
  assert.equal(first.status, 201);
  assert.equal(repeated.status, 200);
  assert.equal(first.body.data.id, repeated.body.data.id);
  assert.equal(first.body.data.latestAttempt.id, repeated.body.data.latestAttempt.id);
  assert.equal(provider.calls.length, 1);
  assert.equal(storedFirst.providerPaymentId, storedRepeated.providerPaymentId);
  assert.equal(storedFirst.completedAt?.getTime(), storedRepeated.completedAt?.getTime());
  const blocked = await postAttempt(customer.cookie, order.id, randomUUID());
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, "PAYMENT_ALREADY_PAID");
});

test("same-key concurrency creates one Payment/Attempt and dispatches once", async () => {
  const customer = await createIdentity("payment-same-concurrency");
  const order = await createOrder(customer.profile!.id);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const providerStarted = new Promise<void>((resolve) => { started = resolve; });
  const provider = new FakeProvider(async (input) => { started(); await gate; return result(input, "APPROVED"); });
  useProvider(provider);
  const key = randomUUID();
  const firstPromise = postAttempt(customer.cookie, order.id, key).then((value) => value);
  await providerStarted;
  const concurrent = await postAttempt(customer.cookie, order.id, key);
  release();
  const first = await firstPromise;
  assert.equal(first.status, 201);
  assert.equal(concurrent.status, 200);
  assert.equal(first.body.data.id, concurrent.body.data.id);
  assert.equal(await prisma.payment.count(), 1);
  assert.equal(await prisma.paymentAttempt.count(), 1);
  assert.equal(provider.calls.length, 1);
});

test("different-key concurrency is rejected while the first Attempt is active", async () => {
  const customer = await createIdentity("payment-different-concurrency");
  const order = await createOrder(customer.profile!.id);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const providerStarted = new Promise<void>((resolve) => { started = resolve; });
  const provider = new FakeProvider(async (input) => { started(); await gate; return result(input, "PROCESSING"); });
  useProvider(provider);
  const firstPromise = postAttempt(customer.cookie, order.id, randomUUID()).then((value) => value);
  await providerStarted;
  const blocked = await postAttempt(customer.cookie, order.id, randomUUID());
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, "PAYMENT_ALREADY_PROCESSING");
  release();
  assert.equal((await firstPromise).status, 201);
  assert.equal(await prisma.payment.count(), 1);
  assert.equal(await prisma.paymentAttempt.count(), 1);
});

test("terminal rejection permits a new key and increments sequence without rewriting history", async () => {
  const customer = await createIdentity("payment-rejected");
  const order = await createOrder(customer.profile!.id);
  const provider = new FakeProvider((input, call) => result(input, call === 1 ? "REJECTED" : "APPROVED"));
  useProvider(provider);
  const rejected = await postAttempt(customer.cookie, order.id, randomUUID());
  assert.equal(rejected.status, 201);
  assert.equal(rejected.body.data.status, "PENDING");
  assert.equal(rejected.body.data.latestAttempt.status, "REJECTED");
  const approved = await postAttempt(customer.cookie, order.id, randomUUID());
  assert.equal(approved.status, 201);
  assert.equal(approved.body.data.status, "PAID");
  const attempts = await prisma.paymentAttempt.findMany({ orderBy: { sequence: "asc" } });
  assert.deepEqual(attempts.map(({ sequence, status }) => ({ sequence, status })), [
    { sequence: 1, status: "REJECTED" }, { sequence: 2, status: "APPROVED" }
  ]);
});

test("confirmed PROCESSING is readable, not redispatched, and blocks a new key", async () => {
  const customer = await createIdentity("payment-processing");
  const order = await createOrder(customer.profile!.id);
  const provider = new FakeProvider((input) => result(input, "PROCESSING"));
  useProvider(provider);
  const key = randomUUID();
  const first = await postAttempt(customer.cookie, order.id, key);
  const replay = await postAttempt(customer.cookie, order.id, key);
  const blocked = await postAttempt(customer.cookie, order.id, randomUUID());
  assert.equal(first.status, 201);
  assert.equal(first.body.data.status, "PROCESSING");
  assert.equal(replay.status, 200);
  assert.equal(provider.calls.length, 1);
  assert.equal(blocked.status, 409);
  assert.equal((await getPayment(customer.cookie, order.id)).body.data.status, "PROCESSING");
  assert.equal((await prisma.paymentAttempt.findFirstOrThrow()).dispatchLeaseUntil, null);
});

test("provider timeout remains unknown PROCESSING and keeps the lease", async () => {
  const customer = await createIdentity("payment-timeout");
  const order = await createOrder(customer.profile!.id);
  const provider = new FakeProvider(() => { throw new PaymentProviderFailure("TIMEOUT"); });
  useProvider(provider);
  const timedOut = await postAttempt(customer.cookie, order.id, randomUUID());
  assert.equal(timedOut.status, 504);
  assert.equal(timedOut.body.error.code, "PAYMENT_PROVIDER_TIMEOUT");
  const attempt = await prisma.paymentAttempt.findFirstOrThrow();
  assert.equal(attempt.status, "PROCESSING");
  assert.notEqual(attempt.dispatchLeaseUntil, null);
  assert.equal((await prisma.payment.findFirstOrThrow()).status, "PROCESSING");
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING_PAYMENT");
  assert.equal((await postAttempt(customer.cookie, order.id, randomUUID())).status, 409);
  assert.equal((await getPayment(customer.cookie, order.id)).body.data.status, "PROCESSING");
});

test("crash before provider resumes the same CREATED Attempt and provider key", async () => {
  const customer = await createIdentity("payment-crash-before");
  const order = await createOrder(customer.profile!.id);
  const provider = new FakeProvider((input) => result(input, "APPROVED"));
  const key = randomUUID();
  useProvider(provider, { hooks: { afterAttemptCreated: () => { throw new Error("simulated crash before provider"); } } });
  assert.equal((await postAttempt(customer.cookie, order.id, key)).status, 500);
  const created = await prisma.paymentAttempt.findFirstOrThrow();
  assert.equal(created.status, "CREATED");
  assert.equal(provider.calls.length, 0);
  useProvider(provider);
  const retried = await postAttempt(customer.cookie, order.id, key);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.data.latestAttempt.id, created.id);
  assert.equal(provider.calls[0].providerIdempotencyKey, created.providerIdempotencyKey);
  assert.equal(await prisma.paymentAttempt.count(), 1);
});

test("crash after provider result resumes after lease expiry with the same provider identity", async () => {
  const customer = await createIdentity("payment-crash-after");
  const order = await createOrder(customer.profile!.id);
  let now = new Date("2026-09-10T12:00:00.000Z");
  const provider = new FakeProvider((input) => result(input, "APPROVED"));
  const key = randomUUID();
  useProvider(provider, {
    clock: () => new Date(now),
    hooks: { afterProviderResult: () => { throw new Error("simulated crash after provider"); } }
  });
  assert.equal((await postAttempt(customer.cookie, order.id, key)).status, 502);
  const active = await prisma.paymentAttempt.findFirstOrThrow();
  assert.equal(active.status, "PROCESSING");
  now = new Date(now.getTime() + 31_000);
  useProvider(provider, { clock: () => new Date(now) });
  const retried = await postAttempt(customer.cookie, order.id, key);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.data.status, "PAID");
  assert.equal(await prisma.paymentAttempt.count(), 1);
  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[0].providerIdempotencyKey, provider.calls[1].providerIdempotencyKey);
  assert.equal(providerId(provider.calls[0].providerIdempotencyKey), (await prisma.paymentAttempt.findFirstOrThrow()).providerPaymentId);
});

test("definitive provider failure becomes ERROR while malformed unknown response stays PROCESSING", async () => {
  const customer = await createIdentity("payment-provider-errors");
  const definitiveOrder = await createOrder(customer.profile!.id);
  useProvider(new FakeProvider(() => { throw new PaymentProviderFailure("DEFINITIVE"); }));
  const definitive = await postAttempt(customer.cookie, definitiveOrder.id, randomUUID());
  assert.equal(definitive.status, 502);
  assert.equal((await prisma.paymentAttempt.findFirstOrThrow({ where: { payment: { orderId: definitiveOrder.id } } })).status, "ERROR");
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { orderId: definitiveOrder.id } })).status, "PENDING");

  const malformedOrder = await createOrder(customer.profile!.id);
  useProvider(new FakeProvider(() => ({ status: "APPROVED", raw: "not allowed" })));
  const malformed = await postAttempt(customer.cookie, malformedOrder.id, randomUUID());
  assert.equal(malformed.status, 502);
  assert.equal((await prisma.paymentAttempt.findFirstOrThrow({ where: { payment: { orderId: malformedOrder.id } } })).status, "PROCESSING");
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { orderId: malformedOrder.id } })).status, "PROCESSING");
});

test("DEMO disabled fails safely before creating Payment or Attempt", async () => {
  const customer = await createIdentity("payment-disabled");
  const order = await createOrder(customer.profile!.id);
  useProvider(new DemoPaymentProvider(false));
  const response = await postAttempt(customer.cookie, order.id, randomUUID());
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, "PAYMENT_PROVIDER_UNAVAILABLE");
  assert.equal(await prisma.payment.count(), 0);
  assert.equal(await prisma.paymentAttempt.count(), 0);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING_PAYMENT");

  const cancelled = await createOrder(customer.profile!.id, "10.00", "CANCELLED");
  useProvider(new DemoPaymentProvider(true));
  const notPayable = await postAttempt(customer.cookie, cancelled.id, randomUUID());
  assert.equal(notPayable.status, 409);
  assert.equal(notPayable.body.error.code, "ORDER_NOT_PAYABLE");
  assert.equal(await prisma.payment.count(), 0);
});

test("cancel coordinates absent, rejected, processing and paid Payment states idempotently", async () => {
  const customer = await createIdentity("payment-cancel");
  const noPayment = await createOrder(customer.profile!.id);
  useProvider(new DemoPaymentProvider(true));
  const cancelNoPayment = await request(app).post(`/api/v1/orders/${noPayment.id}/cancel`)
    .set("Cookie", customer.cookie).set("Origin", origin).set("X-VacineKids-CSRF", "1").send({});
  assert.equal(cancelNoPayment.status, 200);
  assert.equal(cancelNoPayment.body.data.status, "CANCELLED");

  const rejectedOrder = await createOrder(customer.profile!.id);
  useProvider(new FakeProvider((input) => result(input, "REJECTED")));
  assert.equal((await postAttempt(customer.cookie, rejectedOrder.id, randomUUID())).status, 201);
  const cancelRejected = await request(app).post(`/api/v1/orders/${rejectedOrder.id}/cancel`)
    .set("Cookie", customer.cookie).set("Origin", origin).set("X-VacineKids-CSRF", "1").send({});
  assert.equal(cancelRejected.status, 200);
  const firstCancelledAt = cancelRejected.body.data.cancelledAt;
  const paymentCancelledAt = (await prisma.payment.findUniqueOrThrow({ where: { orderId: rejectedOrder.id } })).cancelledAt;
  const repeated = await request(app).post(`/api/v1/orders/${rejectedOrder.id}/cancel`)
    .set("Cookie", customer.cookie).set("Origin", origin).set("X-VacineKids-CSRF", "1").send({});
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.data.cancelledAt, firstCancelledAt);
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { orderId: rejectedOrder.id } })).cancelledAt?.getTime(), paymentCancelledAt?.getTime());
  assert.equal((await prisma.paymentAttempt.findFirstOrThrow({ where: { payment: { orderId: rejectedOrder.id } } })).status, "REJECTED");

  const processingOrder = await createOrder(customer.profile!.id);
  useProvider(new FakeProvider((input) => result(input, "PROCESSING")));
  await postAttempt(customer.cookie, processingOrder.id, randomUUID());
  const processingCancel = await request(app).post(`/api/v1/orders/${processingOrder.id}/cancel`)
    .set("Cookie", customer.cookie).set("Origin", origin).set("X-VacineKids-CSRF", "1").send({});
  assert.equal(processingCancel.status, 409);
  assert.equal(processingCancel.body.error.code, "ORDER_NOT_CANCELLABLE");

  const paidOrder = await createOrder(customer.profile!.id);
  useProvider(new DemoPaymentProvider(true));
  await postAttempt(customer.cookie, paidOrder.id, randomUUID());
  const paidCancel = await request(app).post(`/api/v1/orders/${paidOrder.id}/cancel`)
    .set("Cookie", customer.cookie).set("Origin", origin).set("X-VacineKids-CSRF", "1").send({});
  assert.equal(paidCancel.status, 409);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: paidOrder.id } })).status, "PAID");
});

test("cancel versus approval never produces CANCELLED Order with PAID Payment", async () => {
  const customer = await createIdentity("payment-cancel-race");
  const order = await createOrder(customer.profile!.id);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const providerStarted = new Promise<void>((resolve) => { started = resolve; });
  useProvider(new FakeProvider(async (input) => { started(); await gate; return result(input, "APPROVED"); }));
  const paymentPromise = postAttempt(customer.cookie, order.id, randomUUID()).then((value) => value);
  await providerStarted;
  const cancelled = await request(app).post(`/api/v1/orders/${order.id}/cancel`)
    .set("Cookie", customer.cookie).set("Origin", origin).set("X-VacineKids-CSRF", "1").send({});
  assert.equal(cancelled.status, 409);
  release();
  assert.equal((await paymentPromise).status, 201);
  const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  const finalPayment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
  assert.deepEqual([finalOrder.status, finalPayment.status], ["PAID", "PAID"]);
});

test("database physically enforces one active Attempt and unique non-null provider payment ID", async () => {
  const customer = await createIdentity("payment-db-constraints");
  const order = await createOrder(customer.profile!.id);
  const payment = await prisma.payment.create({ data: { orderId: order.id, amount: order.totalAmount, currency: "BRL" } });
  const base = { paymentId: payment.id, provider: "DEMO" as const, method: "DEMO" as const, requestHash: "c".repeat(64) };
  await prisma.paymentAttempt.create({ data: {
    ...base, sequence: 1, status: "CREATED", idempotencyKey: randomUUID(), providerIdempotencyKey: randomUUID()
  } });
  await assert.rejects(() => prisma.paymentAttempt.create({ data: {
    ...base, sequence: 2, status: "PROCESSING", idempotencyKey: randomUUID(), providerIdempotencyKey: randomUUID()
  } }));
  await prisma.paymentAttempt.update({
    where: { paymentId_sequence: { paymentId: payment.id, sequence: 1 } },
    data: { status: "REJECTED", completedAt: new Date() }
  });
  const providerPaymentId = "demo_unique_provider_payment";
  await prisma.paymentAttempt.create({ data: {
    ...base, sequence: 2, status: "REJECTED", completedAt: new Date(), idempotencyKey: randomUUID(),
    providerIdempotencyKey: randomUUID(), providerPaymentId
  } });
  await assert.rejects(() => prisma.paymentAttempt.create({ data: {
    ...base, sequence: 3, status: "REJECTED", completedAt: new Date(), idempotencyKey: randomUUID(),
    providerIdempotencyKey: randomUUID(), providerPaymentId
  } }));
  await prisma.paymentAttempt.create({ data: {
    ...base, sequence: 3, status: "REJECTED", completedAt: new Date(), idempotencyKey: randomUUID(),
    providerIdempotencyKey: randomUUID(), providerPaymentId: null
  } });
  await prisma.paymentAttempt.create({ data: {
    ...base, sequence: 4, status: "REJECTED", completedAt: new Date(), idempotencyKey: randomUUID(),
    providerIdempotencyKey: randomUUID(), providerPaymentId: null
  } });
});

test("payment HTTP boundary enforces empty body, CSRF, CORS, 16kb, media type and rate limits", async () => {
  const customer = await createIdentity("payment-security");
  const order = await createOrder(customer.profile!.id);
  useProvider(new DemoPaymentProvider(true), {}, { windowMs: 60_000, attemptLimit: 2, readLimit: 2 });
  assert.equal((await request(app).post(`/api/v1/orders/${order.id}/payment-attempts`).set("Cookie", customer.cookie)
    .set("Origin", origin).set("Idempotency-Key", randomUUID()).send({})).status, 403);
  assert.equal((await request(app).post(`/api/v1/orders/${order.id}/payment-attempts`).set("Cookie", customer.cookie)
    .set("Origin", "https://evil.example").set("X-VacineKids-CSRF", "1").set("Idempotency-Key", randomUUID()).send({})).status, 403);
  const preflight = await request(app).options(`/api/v1/orders/${order.id}/payment-attempts`)
    .set("Origin", origin).set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "Content-Type,X-VacineKids-CSRF,Idempotency-Key");
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers["access-control-allow-headers"], /Idempotency-Key/);

  const missingKey = await request(app).post(`/api/v1/orders/${order.id}/payment-attempts`)
    .set("Cookie", customer.cookie).set("Origin", origin).set("X-VacineKids-CSRF", "1").send({});
  assert.equal(missingKey.status, 400);
  assert.equal(missingKey.body.error.code, "PAYMENT_IDEMPOTENCY_KEY_REQUIRED");
  const invalidKey = await postAttempt(customer.cookie, order.id, "invalid");
  assert.equal(invalidKey.status, 422);
  assert.equal(invalidKey.body.error.code, "PAYMENT_IDEMPOTENCY_KEY_INVALID");
  for (const body of [
    { amount: "0.01" }, { currency: "USD" }, { status: "APPROVED" }, { provider: "DEMO" },
    { method: "DEMO" }, { approved: true }, { result: "APPROVED" }
  ]) assert.equal((await postAttempt(customer.cookie, order.id, randomUUID(), body)).status, 422);
  assert.equal(await prisma.payment.count(), 0);
  const malformed = await request(app).post(`/api/v1/orders/${order.id}/payment-attempts`)
    .set("Cookie", customer.cookie).set("Origin", origin).set("X-VacineKids-CSRF", "1")
    .set("Idempotency-Key", randomUUID()).set("Content-Type", "application/json").send("{broken");
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers["cache-control"], "no-store");
  assert.equal((await request(app).post(`/api/v1/orders/${order.id}/payment-attempts`)
    .set("Cookie", customer.cookie).set("Origin", origin).set("X-VacineKids-CSRF", "1")
    .set("Idempotency-Key", randomUUID()).set("Content-Type", "text/plain").send("plain")).status, 415);
  assert.equal((await postAttempt(customer.cookie, order.id, randomUUID(), { padding: "x".repeat(17 * 1024) })).status, 413);

  const firstOrder = await createOrder(customer.profile!.id);
  const secondOrder = await createOrder(customer.profile!.id);
  const thirdOrder = await createOrder(customer.profile!.id);
  assert.equal((await postAttempt(customer.cookie, firstOrder.id, randomUUID())).status, 201);
  assert.equal((await postAttempt(customer.cookie, secondOrder.id, randomUUID())).status, 201);
  const limited = await postAttempt(customer.cookie, thirdOrder.id, randomUUID());
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, "RATE_LIMITED");
  assert.equal((await getPayment(customer.cookie, thirdOrder.id)).status, 200);
  assert.equal((await getPayment(customer.cookie, thirdOrder.id)).status, 200);
  assert.equal((await getPayment(customer.cookie, thirdOrder.id)).status, 429);
});

test("database dependency failures are redacted for Payment GET and POST", async () => {
  const customer = await createIdentity("payment-db-failure");
  const order = await createOrder(customer.profile!.id);
  const auth = createAuthService(prisma, undefined, "integration_test");
  const customerService = createCustomerService(prisma, "integration_test");
  const orderService = createOrderService(prisma, undefined, undefined, "integration_test");
  const real = createPaymentService(prisma, new DemoPaymentProvider(true), { schema: "integration_test" });
  const unavailable = Object.assign(new Error("private payment database URL"), { code: "P1001" });
  const broken = { ...real, get: async () => { throw unavailable; }, createAttempt: async () => { throw unavailable; } };
  app = createApp(auth, customerService, orderService, broken);
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const get = await getPayment(customer.cookie, order.id);
    assert.equal(get.status, 503);
    assert.equal(get.headers["cache-control"], "no-store");
    const post = await postAttempt(customer.cookie, order.id, randomUUID());
    assert.equal(post.status, 503);
    assert.equal(JSON.stringify([get.body, post.body, logged]).includes("private"), false);
  } finally { console.error = original; }
});
