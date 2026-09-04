import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const passwordSchema = (minimum: number) => z.string().max(512)
  .transform(value => value.normalize("NFC"))
  .refine(value => [...value].length >= minimum && [...value].length <= 128,
    `Password must contain ${minimum} to 128 Unicode characters`);

export const registerSchema = z.strictObject({ email: emailSchema, password: passwordSchema(15) });
export const loginSchema = z.strictObject({ email: emailSchema, password: passwordSchema(1) });
export const logoutSchema = z.strictObject({});
export type AuthInput = z.infer<typeof loginSchema>;
