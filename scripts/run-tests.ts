import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const tsxCli = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
const unitTests = [
  fileURLToPath(new URL("../src/config/prisma-database-url.test.ts", import.meta.url)),
  fileURLToPath(new URL("../src/modules/catalog/catalog.schemas.test.ts", import.meta.url)),
  fileURLToPath(new URL("./integration-environment.test.ts", import.meta.url)),
  fileURLToPath(new URL("../src/modules/auth/auth.unit.test.ts", import.meta.url)),
  fileURLToPath(new URL("../src/modules/customer/customer.schemas.test.ts", import.meta.url)),
  fileURLToPath(new URL("../src/modules/orders/orders.schemas.test.ts", import.meta.url)),
  fileURLToPath(new URL("../src/modules/orders/orders.canonical.test.ts", import.meta.url)),
  fileURLToPath(new URL("../src/modules/payments/payments.schemas.test.ts", import.meta.url)),
  fileURLToPath(new URL("../src/modules/payments/payments.canonical.test.ts", import.meta.url)),
  fileURLToPath(new URL("../src/modules/payments/payments.state.test.ts", import.meta.url)),
  fileURLToPath(new URL("../src/modules/payments/providers/demo-payment-provider.test.ts", import.meta.url))
];
const integrationRunner = fileURLToPath(new URL("./run-integration-tests.ts", import.meta.url));

const run = (args: string[]) => {
  const result = spawnSync(process.execPath, args, { cwd: root, env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run([tsxCli, "--test", ...unitTests]);
if (!process.argv.includes("--unit")) run([tsxCli, integrationRunner]);
