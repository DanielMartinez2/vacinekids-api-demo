import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Integration runners inject their isolated URL into DATABASE_URL. Outside tests,
// Neon migrations prefer the direct connection and local development falls back safely.
const migrationDatabaseUrl =
  process.env.NODE_ENV === "test"
    ? env("DATABASE_URL")
    : process.env.DATABASE_URL_UNPOOLED ?? env("DATABASE_URL");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: migrationDatabaseUrl
  }
});
