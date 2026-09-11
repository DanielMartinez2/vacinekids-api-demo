import { createHash } from "node:crypto";

type DecimalValue = { toFixed(decimalPlaces: number): string };

export type PaymentIntent = {
  orderId: string;
  amount: DecimalValue;
  currency: string;
  method: "DEMO";
};

export const canonicalizePaymentIntent = (intent: PaymentIntent) => JSON.stringify({
  version: 1,
  orderId: intent.orderId.toLowerCase(),
  amount: intent.amount.toFixed(2),
  currency: intent.currency,
  method: intent.method
});

export const paymentRequestHash = (intent: PaymentIntent) =>
  createHash("sha256").update(canonicalizePaymentIntent(intent)).digest("hex");
