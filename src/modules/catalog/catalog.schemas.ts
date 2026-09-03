import { z } from "zod";

const emptyStringToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalBooleanFromQuery = z.preprocess(
  emptyStringToUndefined,
  z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional()
    .default(false)
);

const optionalAgeRangeSlugFromQuery = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().max(60).optional()
);

const requiredText = (field: string, max: number) =>
  z
    .string({ error: `${field} must be a string` })
    .trim()
    .min(1, `${field} is required`)
    .max(max, `${field} must have at most ${max} characters`);

const priceSchema = z
  .number({ error: "price must be a number" })
  .finite()
  .nonnegative("price cannot be negative")
  .multipleOf(0.01, "price can have at most two decimal places");

const faqSchema = z.object({
  question: requiredText("question", 500),
  answer: requiredText("answer", 5000)
});

const faqsSchema = z.array(faqSchema).max(30, "faqs can contain at most 30 items");

const uniqueUuidArray = (field: string) =>
  z
    .array(z.uuid())
    .max(30, `${field} can contain at most 30 items`)
    .refine((values) => new Set(values).size === values.length, `${field} cannot contain duplicates`);

export const idParamsSchema = z.object({ id: z.uuid() });

export const catalogListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.preprocess(emptyStringToUndefined, z.string().trim().max(160).optional()),
  includeDeleted: optionalBooleanFromQuery
});

export const vaccineListQuerySchema = catalogListQuerySchema.extend({
  ageRange: optionalAgeRangeSlugFromQuery
});

export const packageListQuerySchema = catalogListQuerySchema.extend({
  vaccineId: z.preprocess(emptyStringToUndefined, z.uuid().optional()),
  ageRange: optionalAgeRangeSlugFromQuery
});

export const createVaccineSchema = z.object({
  name: requiredText("name", 160),
  description: requiredText("description", 10000),
  manufacturer: requiredText("manufacturer", 160),
  price: priceSchema,
  ageRangeIds: uniqueUuidArray("ageRangeIds").min(1, "at least one age range is required"),
  faqs: faqsSchema.default([])
});

export const updateVaccineSchema = createVaccineSchema
  .partial()
  .refine((input) => Object.keys(input).length > 0, "at least one field must be provided");

const packageVaccineSchema = z.object({
  vaccineId: z.uuid(),
  quantity: z.number().int().positive().max(100).default(1)
});

const packageVaccinesSchema = z
  .array(packageVaccineSchema)
  .min(1, "at least one vaccine is required")
  .max(50, "vaccines can contain at most 50 items")
  .refine(
    (items) => new Set(items.map((item) => item.vaccineId)).size === items.length,
    "vaccines cannot contain duplicate vaccineId values"
  );

export const createPackageSchema = z.object({
  name: requiredText("name", 160),
  description: requiredText("description", 10000),
  price: priceSchema,
  vaccines: packageVaccinesSchema,
  faqs: faqsSchema.default([])
});

export const updatePackageSchema = createPackageSchema
  .partial()
  .refine((input) => Object.keys(input).length > 0, "at least one field must be provided");

const ageBoundSchema = z.number().int().nonnegative().max(2400).nullable().optional();

const ageRangeSlugSchema = requiredText("slug", 60)
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must use lowercase letters, numbers and hyphens");

const hasValidAgeBounds = ({ minAgeMonths, maxAgeMonths }: {
  minAgeMonths?: number | null;
  maxAgeMonths?: number | null;
}) => minAgeMonths == null || maxAgeMonths == null || minAgeMonths <= maxAgeMonths;

export const createAgeRangeSchema = z
  .object({
    slug: ageRangeSlugSchema,
    name: requiredText("name", 100),
    minAgeMonths: ageBoundSchema,
    maxAgeMonths: ageBoundSchema,
    sortOrder: z.number().int().min(0).max(10000).default(0)
  })
  .refine(hasValidAgeBounds, {
    message: "minAgeMonths cannot be greater than maxAgeMonths",
    path: ["maxAgeMonths"]
  });

export const updateAgeRangeSchema = z
  .object({
    slug: ageRangeSlugSchema.optional(),
    name: requiredText("name", 100).optional(),
    minAgeMonths: ageBoundSchema,
    maxAgeMonths: ageBoundSchema,
    sortOrder: z.number().int().min(0).max(10000).optional()
  })
  .refine((input) => Object.keys(input).length > 0, "at least one field must be provided")
  .refine(hasValidAgeBounds, {
    message: "minAgeMonths cannot be greater than maxAgeMonths",
    path: ["maxAgeMonths"]
  });

export type CreateVaccineInput = z.infer<typeof createVaccineSchema>;
export type UpdateVaccineInput = z.infer<typeof updateVaccineSchema>;
export type CreatePackageInput = z.infer<typeof createPackageSchema>;
export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;
export type CreateAgeRangeInput = z.infer<typeof createAgeRangeSchema>;
export type UpdateAgeRangeInput = z.infer<typeof updateAgeRangeSchema>;
