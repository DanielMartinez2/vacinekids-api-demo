import "dotenv/config";
import { defineConfig } from "prisma/config";
import { resolvePrismaDatabaseUrl } from "./src/config/prisma-database-url";

// Integration runners inject their isolated URL into DATABASE_URL and clear the direct URL.
// Administrative operations prefer a non-empty direct URL and otherwise fall back safely.
const migrationDatabaseUrl = resolvePrismaDatabaseUrl(process.env);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: migrationDatabaseUrl
  }
});
