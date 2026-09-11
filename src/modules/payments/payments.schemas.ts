import { z } from "zod";

const canonicalUuid = z.uuid().transform((value) => value.toLowerCase());

export const paymentOrderParamsSchema = z.strictObject({ orderId: canonicalUuid });
export const createPaymentAttemptSchema = z.strictObject({});
export const paymentIdempotencyKeySchema = canonicalUuid;
