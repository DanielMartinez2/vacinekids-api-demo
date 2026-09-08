import { z } from "zod";
import { normalizeName } from "../../lib/normalize-name";

const unicodeLength = (value: string) => [...value].length;

export const customerNameSchema = z
  .string({ error: "name must be a string" })
  .transform(normalizeName)
  .refine((value) => unicodeLength(value) >= 2, "name must contain at least 2 characters")
  .refine((value) => unicodeLength(value) <= 160, "name must contain at most 160 characters");

export const e164PhoneSchema = z
  .string({ error: "phone must be a string" })
  .regex(/^\+[1-9][0-9]{7,14}$/, "phone must use canonical E.164 format");

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

const todayInBrazil = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

const isRealCivilDate = (value: string) => {
  const match = isoDatePattern.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  if (year === "0000") return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day);
};

export const birthDateSchema = z
  .string({ error: "birthDate must be a string" })
  .regex(isoDatePattern, "birthDate must use YYYY-MM-DD")
  .refine(isRealCivilDate, "birthDate must be a real calendar date")
  .refine((value) => value <= todayInBrazil(), "birthDate cannot be in the future")
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

export const profileInputSchema = z.strictObject({
  name: customerNameSchema,
  phone: e164PhoneSchema
});

export const createDependentSchema = z.strictObject({
  name: customerNameSchema,
  birthDate: birthDateSchema
});

export const updateDependentSchema = z
  .strictObject({
    name: customerNameSchema.optional(),
    birthDate: birthDateSchema.optional()
  })
  .refine((input) => Object.keys(input).length > 0, "at least one field must be provided");

export const dependentIdParamsSchema = z.strictObject({ id: z.uuid() });

export const dependentListQuerySchema = z.strictObject({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export type ProfileInput = z.infer<typeof profileInputSchema>;
export type CreateDependentInput = z.infer<typeof createDependentSchema>;
export type UpdateDependentInput = z.infer<typeof updateDependentSchema>;
export type DependentListQuery = z.infer<typeof dependentListQuerySchema>;
