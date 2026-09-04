import "dotenv/config";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { validateIntegrationEnvironment } from "./integration-environment";

const catalogTables = [
  "age_ranges",
  "package_faqs",
  "package_vaccines",
  "packages",
  "vaccine_age_ranges",
  "vaccine_faqs",
  "vaccines",
  "users",
  "sessions"
] as const;

type CatalogSnapshot = Record<
  (typeof catalogTables)[number],
  { count: number; fingerprint: string }
>;

const snapshotCatalog = async (databaseUrl: string, schema: "public" | "integration_test") => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const entries: Array<readonly [
      (typeof catalogTables)[number],
      { count: number; fingerprint: string }
    ]> = [];

    for (const table of catalogTables) {
      const result = await client.query<{ row: unknown }>(
        `SELECT to_jsonb(record) AS row
           FROM "${schema}"."${table}" AS record
          ORDER BY to_jsonb(record)::text`
      );
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(result.rows.map(({ row }) => row)))
        .digest("hex");
      entries.push([table, { count: result.rowCount ?? 0, fingerprint }] as const);
    }

    return Object.fromEntries(entries) as CatalogSnapshot;
  } finally {
    await client.end();
  }
};

const formatCounts = (snapshot: CatalogSnapshot) =>
  catalogTables.map((table) => `${table}=${snapshot[table].count}`).join(", ");

const environment = validateIntegrationEnvironment(
  process.env.DATABASE_URL,
  process.env.TEST_DATABASE_URL
);

const root = fileURLToPath(new URL("../", import.meta.url));
const prismaCli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
const tsxCli = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
const integrationTest = fileURLToPath(
  new URL("../src/modules/catalog/catalog.integration.test.ts", import.meta.url)
);
const authIntegrationTest = fileURLToPath(new URL("../src/modules/auth/auth.integration.test.ts", import.meta.url));
const testEnv = {
  ...process.env,
  NODE_ENV: "test",
  INTEGRATION_DEVELOPMENT_DATABASE_URL: environment.developmentDatabaseUrl,
  DATABASE_URL_UNPOOLED: "",
  DATABASE_URL: environment.testDatabaseUrl,
  FRONTEND_URL: process.env.FRONTEND_URL ?? "http://localhost:5173"
};

const run = (args: string[]) => {
  const result = spawnSync(process.execPath, args, { cwd: root, env: testEnv, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Integration test subprocess exited with status ${result.status ?? 1}`);
  }
};

const main = async () => {
  const publicBefore = await snapshotCatalog(
    environment.developmentDatabaseUrl,
    environment.developmentSchema
  );
  console.log(`Public catalog before integration tests: ${formatCounts(publicBefore)}`);

  let executionError: unknown;
  try {
    run([prismaCli, "migrate", "deploy"]);
    run([tsxCli, "--test", "--test-concurrency=1", integrationTest, authIntegrationTest]);
  } catch (error) {
    executionError = error;
  }

  const publicAfter = await snapshotCatalog(
    environment.developmentDatabaseUrl,
    environment.developmentSchema
  );
  assert.deepEqual(
    publicAfter,
    publicBefore,
    "Integration tests modified data in the public schema"
  );

  const testAfter = await snapshotCatalog(environment.testDatabaseUrl, environment.testSchema);
  assert.equal(
    catalogTables.every((table) => testAfter[table].count === 0),
    true,
    "Integration test cleanup left catalog data in the integration_test schema"
  );

  console.log(`Public catalog after integration tests: ${formatCounts(publicAfter)}`);
  console.log("Isolation verified: public data is unchanged and integration_test catalog data is clean.");

  if (executionError) throw executionError;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
