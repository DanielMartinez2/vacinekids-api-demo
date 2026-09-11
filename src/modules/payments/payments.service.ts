import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../../../generated/prisma/client";
import { HttpError } from "../../lib/http-error";
import { paymentRequestHash } from "./payments.canonical";
import {
  type NormalizedProviderResult,
  type PaymentProviderAdapter,
  PaymentProviderFailure,
  parseProviderResult
} from "./payments.provider";
import {
  ACTIVE_PAYMENT_ATTEMPT_STATUSES,
  assertAttemptTransition,
  assertPaymentTransition,
  isTerminalAttempt,
  paymentStatusForAttempt
} from "./payments.state";

const paymentInclude = {
  attempts: { orderBy: { sequence: "desc" as const }, take: 1 }
} as const;

type PaymentWithLatestAttempt = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;
type TransactionClient = Prisma.TransactionClient;

export type PaymentServiceHooks = {
  afterAttemptCreated?: (attemptId: string) => void | Promise<void>;
  afterProviderResult?: (attemptId: string, result: unknown) => void | Promise<void>;
};

export type PaymentServiceOptions = {
  clock?: () => Date;
  dispatchLeaseSeconds?: number;
  schema?: string;
  hooks?: PaymentServiceHooks;
};

const orderNotFound = () => new HttpError(404, "ORDER_NOT_FOUND", "Pedido não encontrado.");
const orderNotPayable = () => new HttpError(409, "ORDER_NOT_PAYABLE", "O pedido não pode ser pago neste estado.");
const alreadyProcessing = () =>
  new HttpError(409, "PAYMENT_ALREADY_PROCESSING", "Já existe uma tentativa de pagamento em andamento.");
const alreadyPaid = () => new HttpError(409, "PAYMENT_ALREADY_PAID", "O pedido já está pago.");
const idempotencyReused = () =>
  new HttpError(409, "PAYMENT_IDEMPOTENCY_KEY_REUSED", "A chave de idempotência já foi utilizada com outra solicitação.");
const providerUnavailable = () =>
  new HttpError(503, "PAYMENT_PROVIDER_UNAVAILABLE", "O provedor de pagamento está temporariamente indisponível.");
const providerTimeout = () =>
  new HttpError(504, "PAYMENT_PROVIDER_TIMEOUT", "O resultado do pagamento ainda não pôde ser confirmado.");
const providerFailure = () =>
  new HttpError(502, "PAYMENT_PROVIDER_UNAVAILABLE", "O provedor de pagamento não concluiu a operação.");
const stateConflict = () =>
  new HttpError(409, "PAYMENT_STATE_CONFLICT", "O estado do pagamento mudou durante a operação.");

const serializePayment = (payment: PaymentWithLatestAttempt) => {
  const attempt = payment.attempts[0] ?? null;
  return {
    id: payment.id,
    orderId: payment.orderId,
    status: payment.status,
    amount: payment.amount.toFixed(2),
    currency: payment.currency,
    paidAt: payment.paidAt,
    cancelledAt: payment.cancelledAt,
    latestAttempt: attempt ? {
      id: attempt.id,
      sequence: attempt.sequence,
      status: attempt.status,
      provider: attempt.provider,
      method: attempt.method,
      expiresAt: attempt.expiresAt,
      completedAt: attempt.completedAt
    } : null
  };
};

const sqlTable = (schema: string, table: string) =>
  Prisma.raw(`"${schema.replaceAll('"', '""')}"."${table.replaceAll('"', '""')}"`);

const lockOwnedOrder = async (tx: TransactionClient, schema: string, userId: string, orderId: string) => {
  const orders = sqlTable(schema, "orders");
  const profiles = sqlTable(schema, "customer_profiles");
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT o."id"
      FROM ${orders} AS o
      JOIN ${profiles} AS cp ON cp."id" = o."customer_profile_id"
     WHERE o."id" = ${orderId}::uuid
       AND cp."user_id" = ${userId}::uuid
     FOR UPDATE OF o
  `);
  if (rows.length === 0) throw orderNotFound();
};

const lockPayment = async (tx: TransactionClient, schema: string, paymentId: string) => {
  const payments = sqlTable(schema, "payments");
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM ${payments} WHERE "id" = ${paymentId}::uuid FOR UPDATE`);
};

const lockAttempt = async (tx: TransactionClient, schema: string, attemptId: string) => {
  const attempts = sqlTable(schema, "payment_attempts");
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM ${attempts} WHERE "id" = ${attemptId}::uuid FOR UPDATE`);
};

export const createPaymentService = (
  db: PrismaClient,
  provider: PaymentProviderAdapter,
  options: PaymentServiceOptions = {}
) => {
  const clock = options.clock ?? (() => new Date());
  const dispatchLeaseMs = (options.dispatchLeaseSeconds ?? 30) * 1000;
  const schema = options.schema ?? "public";
  const hooks = options.hooks ?? {};

  if (!Number.isInteger(dispatchLeaseMs) || dispatchLeaseMs <= 0) {
    throw new Error("Payment dispatch lease must be a positive integer number of seconds");
  }

  const findOwnedPayment = async (userId: string, orderId: string) => {
    const order = await db.order.findFirst({
      where: { id: orderId, customerProfile: { userId } },
      select: { payment: { include: paymentInclude } }
    });
    if (!order) throw orderNotFound();
    return order.payment;
  };

  const currentPayment = async (userId: string, orderId: string) => {
    const payment = await findOwnedPayment(userId, orderId);
    if (!payment) throw stateConflict();
    return serializePayment(payment);
  };

  const prepareAttempt = (userId: string, orderId: string, idempotencyKey: string) =>
    db.$transaction(async (tx) => {
      await lockOwnedOrder(tx, schema, userId, orderId);
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { id: true, status: true, totalAmount: true, currency: true, payment: { select: { id: true } } }
      });

      let payment = order.payment
        ? await tx.payment.findUniqueOrThrow({ where: { id: order.payment.id } })
        : null;
      if (payment) await lockPayment(tx, schema, payment.id);

      if (payment) {
        const expectedHash = paymentRequestHash({
          orderId: order.id,
          amount: payment.amount,
          currency: payment.currency,
          method: provider.method
        });
        const existing = await tx.paymentAttempt.findUnique({
          where: { paymentId_idempotencyKey: { paymentId: payment.id, idempotencyKey } }
        });
        if (existing) {
          if (existing.requestHash !== expectedHash) throw idempotencyReused();
          return { attemptId: existing.id, replay: true };
        }
      }

      if (order.status === "PAID" || payment?.status === "PAID") throw alreadyPaid();
      if (order.status !== "PENDING_PAYMENT" || payment?.status === "CANCELLED") throw orderNotPayable();
      if (!provider.isAvailable()) throw providerUnavailable();
      if (order.currency !== "BRL" || order.totalAmount.lte(0)) throw orderNotPayable();

      if (!payment) {
        payment = await tx.payment.create({
          data: { orderId: order.id, amount: order.totalAmount, currency: order.currency }
        });
      } else if (!payment.amount.equals(order.totalAmount) || payment.currency !== order.currency) {
        throw stateConflict();
      }

      const active = await tx.paymentAttempt.findFirst({
        where: { paymentId: payment.id, status: { in: [...ACTIVE_PAYMENT_ATTEMPT_STATUSES] } },
        select: { id: true }
      });
      if (active) throw alreadyProcessing();

      const latest = await tx.paymentAttempt.aggregate({
        where: { paymentId: payment.id },
        _max: { sequence: true }
      });
      const attemptId = randomUUID();
      const requestHash = paymentRequestHash({
        orderId: order.id,
        amount: payment.amount,
        currency: payment.currency,
        method: provider.method
      });
      await tx.paymentAttempt.create({
        data: {
          id: attemptId,
          paymentId: payment.id,
          sequence: (latest._max.sequence ?? 0) + 1,
          provider: provider.provider,
          method: provider.method,
          idempotencyKey,
          requestHash,
          providerIdempotencyKey: attemptId
        }
      });
      return { attemptId, replay: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

  const claimDispatch = (userId: string, orderId: string, attemptId: string) =>
    db.$transaction(async (tx) => {
      await lockOwnedOrder(tx, schema, userId, orderId);
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { status: true, payment: { select: { id: true, status: true, amount: true, currency: true } } }
      });
      if (!order.payment) throw stateConflict();
      await lockPayment(tx, schema, order.payment.id);
      await lockAttempt(tx, schema, attemptId);
      const attempt = await tx.paymentAttempt.findFirst({
        where: { id: attemptId, paymentId: order.payment.id }
      });
      if (!attempt) throw stateConflict();
      if (isTerminalAttempt(attempt.status)) return null;
      if (order.status === "CANCELLED" || order.payment.status === "CANCELLED") throw stateConflict();
      if (order.status === "PAID" || order.payment.status === "PAID") throw stateConflict();
      if (!provider.isAvailable()) throw providerUnavailable();

      const now = clock();
      if (attempt.status === "PROCESSING") {
        if (attempt.dispatchLeaseUntil === null) return null;
        if (attempt.dispatchLeaseUntil.getTime() > now.getTime()) return null;
      }

      assertAttemptTransition(attempt.status, "PROCESSING");
      assertPaymentTransition(order.payment.status, "PROCESSING");
      const dispatchLeaseUntil = new Date(now.getTime() + dispatchLeaseMs);
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "PROCESSING",
          providerRequestedAt: attempt.providerRequestedAt ?? now,
          dispatchLeaseUntil
        }
      });
      await tx.payment.update({ where: { id: order.payment.id }, data: { status: "PROCESSING" } });
      return {
        attemptId: attempt.id,
        providerIdempotencyKey: attempt.providerIdempotencyKey,
        amount: order.payment.amount.toFixed(2),
        currency: order.payment.currency as "BRL",
        method: attempt.method as "DEMO",
        externalReference: attempt.id
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

  const applyProviderResult = (
    userId: string,
    orderId: string,
    attemptId: string,
    result: NormalizedProviderResult
  ) => db.$transaction(async (tx) => {
    await lockOwnedOrder(tx, schema, userId, orderId);
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, payment: { select: { id: true, status: true } } }
    });
    if (!order.payment) throw stateConflict();
    await lockPayment(tx, schema, order.payment.id);
    await lockAttempt(tx, schema, attemptId);
    const attempt = await tx.paymentAttempt.findFirst({
      where: { id: attemptId, paymentId: order.payment.id }
    });
    if (!attempt) throw stateConflict();

    if (isTerminalAttempt(attempt.status)) {
      const sameResult = attempt.status === result.status &&
        (result.providerPaymentId == null || attempt.providerPaymentId === result.providerPaymentId);
      if (!sameResult) throw stateConflict();
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: order.payment.id }, include: paymentInclude });
      return serializePayment(payment);
    }
    if (order.status === "CANCELLED" || order.payment.status === "CANCELLED") throw stateConflict();

    assertAttemptTransition(attempt.status, result.status);
    const nextPaymentStatus = paymentStatusForAttempt(result.status);
    assertPaymentTransition(order.payment.status, nextPaymentStatus);
    const now = clock();
    const terminal = result.status !== "PROCESSING";
    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: result.status,
        providerPaymentId: result.providerPaymentId ?? null,
        providerStatus: result.providerStatus ?? null,
        providerStatusDetail: result.providerStatusDetail ?? null,
        expiresAt: result.expiresAt ?? null,
        completedAt: terminal ? now : null,
        dispatchLeaseUntil: null
      }
    });

    if (result.status === "APPROVED") {
      if (order.status !== "PENDING_PAYMENT") throw stateConflict();
      await tx.payment.update({
        where: { id: order.payment.id },
        data: { status: "PAID", paidAt: now, cancelledAt: null }
      });
      await tx.order.update({ where: { id: orderId }, data: { status: "PAID" } });
    } else {
      await tx.payment.update({
        where: { id: order.payment.id },
        data: { status: nextPaymentStatus, paidAt: null, cancelledAt: null }
      });
    }

    const payment = await tx.payment.findUniqueOrThrow({ where: { id: order.payment.id }, include: paymentInclude });
    return serializePayment(payment);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

  return {
    async get(userId: string, orderId: string) {
      const payment = await findOwnedPayment(userId, orderId);
      return payment ? serializePayment(payment) : null;
    },

    async createAttempt(userId: string, orderId: string, idempotencyKey: string) {
      const prepared = await prepareAttempt(userId, orderId, idempotencyKey);
      if (!prepared.replay) await hooks.afterAttemptCreated?.(prepared.attemptId);
      const input = await claimDispatch(userId, orderId, prepared.attemptId);
      if (!input) return { payment: await currentPayment(userId, orderId), replay: prepared.replay };

      let rawResult: unknown;
      try {
        rawResult = await provider.createOrResumeAttempt(input);
        await hooks.afterProviderResult?.(prepared.attemptId, rawResult);
      } catch (error) {
        if (error instanceof PaymentProviderFailure && error.kind === "DEFINITIVE") {
          await applyProviderResult(userId, orderId, prepared.attemptId, {
            status: "ERROR",
            providerStatus: "error",
            providerStatusDetail: "definitive_no_charge"
          });
          throw providerFailure();
        }
        if (error instanceof PaymentProviderFailure && error.kind === "TIMEOUT") throw providerTimeout();
        throw providerFailure();
      }

      let result: NormalizedProviderResult;
      try {
        result = parseProviderResult(rawResult);
      } catch {
        throw providerFailure();
      }
      const payment = await applyProviderResult(userId, orderId, prepared.attemptId, result);
      return { payment, replay: prepared.replay };
    }
  };
};

export type PaymentService = ReturnType<typeof createPaymentService>;
