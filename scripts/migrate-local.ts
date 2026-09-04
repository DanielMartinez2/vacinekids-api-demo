import "dotenv/config";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateLocalDatabase } from "./integration-environment";

try {
  validateLocalDatabase(process.env.DATABASE_URL ?? "", "public");
  if (process.env.DATABASE_URL_UNPOOLED) validateLocalDatabase(process.env.DATABASE_URL_UNPOOLED, "public");
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "inherit",
    env: { ...process.env, NODE_ENV: "test", DATABASE_URL_UNPOOLED: "" }
  });
  if (result.error || result.status !== 0) process.exitCode = 1;
} catch {
  console.error("Migration abortada: configure explicitamente o PostgreSQL local vacinekids_demo/schema=public.");
  process.exitCode = 1;
}
