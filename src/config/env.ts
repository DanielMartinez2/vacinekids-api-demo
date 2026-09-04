import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  TEST_DATABASE_URL: z.string().min(1).optional(),
  FRONTEND_URL: z.string().url("FRONTEND_URL must be a valid URL")
    .refine(value => { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && url.origin === value; },
      "FRONTEND_URL must be an exact HTTP(S) origin without path, query or credentials")
    .default("http://localhost:5173")
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("Invalid environment configuration:");
  console.error(z.treeifyError(parsedEnv.error));
  process.exit(1);
}

export const env = parsedEnv.data;
