import { z } from "zod";

export const MAX_ORDER_ITEMS = 10;
export const MAX_RECIPIENTS_PER_ITEM = 10;
export const MAX_ORDER_RECIPIENTS = 30;
export const CHECKOUT_FINGERPRINT_VERSION = 1;

const canonicalUuid = z.uuid().transform((value) => value.toLowerCase());

const customerRecipientSchema = z.strictObject({
  type: z.literal("CUSTOMER")
});

const dependentRecipientSchema = z.strictObject({
  type: z.literal("DEPENDENT"),
  dependentId: canonicalUuid
});

export const orderRecipientInputSchema = z.discriminatedUnion("type", [
  customerRecipientSchema,
  dependentRecipientSchema
]);

export const orderItemInputSchema = z.strictObject({
  productType: z.enum(["VACCINE", "PACKAGE"]),
  productId: canonicalUuid,
  recipients: z
    .array(orderRecipientInputSchema)
    .min(1, "at least one recipient is required")
    .max(MAX_RECIPIENTS_PER_ITEM, `recipients can contain at most ${MAX_RECIPIENTS_PER_ITEM} items`)
});

const checkoutItemsSchema = z
  .array(orderItemInputSchema)
  .min(1, "at least one order item is required")
  .max(MAX_ORDER_ITEMS, `items can contain at most ${MAX_ORDER_ITEMS} products`)
  .refine(
    (items) => new Set(items.map(({ productType, productId }) => `${productType}:${productId}`)).size === items.length,
    "items cannot contain duplicate products"
  )
  .refine(
    (items) => items.reduce((total, item) => total + item.recipients.length, 0) <= MAX_ORDER_RECIPIENTS,
    `order can contain at most ${MAX_ORDER_RECIPIENTS} recipients`
  );

export const checkoutPreviewSchema = z.strictObject({
  items: checkoutItemsSchema
});

export const createOrderSchema = z.strictObject({
  checkoutFingerprintVersion: z.literal(CHECKOUT_FINGERPRINT_VERSION),
  checkoutFingerprint: z.string().regex(/^[0-9a-f]{64}$/, "checkoutFingerprint must be lowercase SHA-256 hex"),
  items: checkoutItemsSchema
});

export const orderIdParamsSchema = z.strictObject({ id: canonicalUuid });

export const orderListQuerySchema = z.strictObject({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const cancelOrderSchema = z.strictObject({});

export const idempotencyKeySchema = canonicalUuid;

export type OrderRecipientInput = z.infer<typeof orderRecipientInputSchema>;
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;
export type CheckoutPreviewInput = z.infer<typeof checkoutPreviewSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
