import { createHash } from "node:crypto";
import type { Prisma } from "../../../generated/prisma/client";
import type { CreateOrderInput } from "./orders.schemas";
import { CHECKOUT_FINGERPRINT_VERSION } from "./orders.schemas";

export type ResolvedRecipient = {
  type: "CUSTOMER" | "DEPENDENT";
  dependentId: string | null;
  name: string;
  birthDate: string | null;
};

export type ResolvedComponent = {
  vaccineId: string;
  name: string;
  manufacturer: string;
  quantity: number;
};

export type ResolvedOrderItem = {
  productType: "VACCINE" | "PACKAGE";
  productId: string;
  name: string;
  manufacturer: string | null;
  unitPrice: Prisma.Decimal;
  quantity: number;
  lineTotal: Prisma.Decimal;
  recipients: ResolvedRecipient[];
  components: ResolvedComponent[];
};

export type ResolvedCheckout = {
  customer: { name: string; email: string; phone: string };
  items: ResolvedOrderItem[];
  currency: "BRL";
  totalAmount: Prisma.Decimal;
};

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const lowerUuid = (value: string) => value.toLowerCase();
const recipientKey = (recipient: { type: string; dependentId?: string | null }) =>
  recipient.type === "CUSTOMER" ? "CUSTOMER:" : `DEPENDENT:${recipient.dependentId?.toLowerCase() ?? ""}`;

export const canonicalizeResolvedCheckout = (checkout: ResolvedCheckout): ResolvedCheckout => ({
  ...checkout,
  items: [...checkout.items]
    .sort((left, right) => `${left.productType}:${lowerUuid(left.productId)}`.localeCompare(`${right.productType}:${lowerUuid(right.productId)}`))
    .map((item) => ({
      ...item,
      productId: lowerUuid(item.productId),
      recipients: [...item.recipients]
        .map((recipient) => ({ ...recipient, dependentId: recipient.dependentId ? lowerUuid(recipient.dependentId) : null }))
        .sort((left, right) => recipientKey(left).localeCompare(recipientKey(right))),
      components: [...item.components]
        .map((component) => ({ ...component, vaccineId: lowerUuid(component.vaccineId) }))
        .sort((left, right) => left.vaccineId.localeCompare(right.vaccineId))
    }))
});

export const canonicalCheckoutDocument = (input: ResolvedCheckout) => {
  const checkout = canonicalizeResolvedCheckout(input);
  return {
    version: CHECKOUT_FINGERPRINT_VERSION,
    currency: checkout.currency,
    customer: {
      name: checkout.customer.name,
      email: checkout.customer.email,
      phone: checkout.customer.phone
    },
    items: checkout.items.map((item) => ({
      productType: item.productType,
      productId: item.productId,
      name: item.name,
      manufacturer: item.manufacturer,
      unitPrice: item.unitPrice.toFixed(2),
      quantity: item.quantity,
      lineTotal: item.lineTotal.toFixed(2),
      recipients: item.recipients.map((recipient) => ({
        type: recipient.type,
        dependentId: recipient.dependentId,
        name: recipient.name,
        birthDate: recipient.birthDate
      })),
      components: item.components.map((component) => ({
        vaccineId: component.vaccineId,
        name: component.name,
        manufacturer: component.manufacturer,
        quantity: component.quantity
      }))
    })),
    totalAmount: checkout.totalAmount.toFixed(2)
  };
};

export const checkoutFingerprint = (checkout: ResolvedCheckout) => hash(canonicalCheckoutDocument(checkout));

export const canonicalRequestDocument = (input: CreateOrderInput) => ({
  version: 1,
  checkoutFingerprintVersion: input.checkoutFingerprintVersion,
  checkoutFingerprint: input.checkoutFingerprint,
  items: [...input.items]
    .sort((left, right) => `${left.productType}:${lowerUuid(left.productId)}`.localeCompare(`${right.productType}:${lowerUuid(right.productId)}`))
    .map((item) => ({
      productType: item.productType,
      productId: lowerUuid(item.productId),
      recipients: [...item.recipients]
        .map((recipient) => ({
          type: recipient.type,
          dependentId: recipient.type === "DEPENDENT" ? lowerUuid(recipient.dependentId) : null
        }))
        .sort((left, right) => recipientKey(left).localeCompare(recipientKey(right)))
    }))
});

export const requestHash = (input: CreateOrderInput) => hash(canonicalRequestDocument(input));
