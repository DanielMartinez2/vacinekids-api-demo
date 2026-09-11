import type { PaymentAttemptStatus, PaymentStatus } from "../../../generated/prisma/client";
import { HttpError } from "../../lib/http-error";

export const ACTIVE_PAYMENT_ATTEMPT_STATUSES = ["CREATED", "PROCESSING"] as const;
export const TERMINAL_PAYMENT_ATTEMPT_STATUSES = [
  "APPROVED", "REJECTED", "ERROR", "CANCELLED", "EXPIRED"
] as const;

const attemptTransitions: Record<PaymentAttemptStatus, readonly PaymentAttemptStatus[]> = {
  CREATED: ["PROCESSING", "ERROR", "CANCELLED"],
  PROCESSING: ["APPROVED", "REJECTED", "ERROR", "CANCELLED", "EXPIRED"],
  APPROVED: [],
  REJECTED: [],
  ERROR: [],
  CANCELLED: [],
  EXPIRED: []
};
const paymentTransitions: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ["PROCESSING", "PAID", "CANCELLED"],
  PROCESSING: ["PENDING", "PAID"],
  PAID: [],
  CANCELLED: []
};

export const isActiveAttempt = (status: PaymentAttemptStatus) =>
  ACTIVE_PAYMENT_ATTEMPT_STATUSES.includes(status as (typeof ACTIVE_PAYMENT_ATTEMPT_STATUSES)[number]);

export const isTerminalAttempt = (status: PaymentAttemptStatus) =>
  TERMINAL_PAYMENT_ATTEMPT_STATUSES.includes(status as (typeof TERMINAL_PAYMENT_ATTEMPT_STATUSES)[number]);

export const canTransitionAttempt = (from: PaymentAttemptStatus, to: PaymentAttemptStatus) =>
  from === to || attemptTransitions[from].includes(to);

export const canTransitionPayment = (from: PaymentStatus, to: PaymentStatus) =>
  from === to || paymentTransitions[from].includes(to);

export const assertAttemptTransition = (from: PaymentAttemptStatus, to: PaymentAttemptStatus) => {
  if (!canTransitionAttempt(from, to)) {
    throw new HttpError(409, "PAYMENT_STATE_CONFLICT", "O estado do pagamento mudou durante a operação.");
  }
};

export const assertPaymentTransition = (from: PaymentStatus, to: PaymentStatus) => {
  if (!canTransitionPayment(from, to)) {
    throw new HttpError(409, "PAYMENT_STATE_CONFLICT", "O estado do pagamento mudou durante a operação.");
  }
};

export const paymentStatusForAttempt = (status: PaymentAttemptStatus): PaymentStatus => {
  if (status === "PROCESSING") return "PROCESSING";
  if (status === "APPROVED") return "PAID";
  return "PENDING";
};
