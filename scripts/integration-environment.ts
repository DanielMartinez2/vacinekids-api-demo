import { parseDatabaseUrl } from "../src/config/database-url";

export const INTEGRATION_ISOLATION_ERROR =
  "Integration tests aborted: TEST_DATABASE_URL must point to an isolated test schema.";

const fail = (reason: string): never => {
  throw new Error(`${INTEGRATION_ISOLATION_ERROR} ${reason}`);
};

// Deliberately fixed to this repository's local Docker/development database.
export const validateLocalDatabase = (value: string, schema: "public" | "integration_test") => {
  try {
    const parsed = parseDatabaseUrl(value);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.url.hostname)) fail("Only loopback hosts are allowed.");
    if (parsed.url.pathname !== "/vacinekids_demo") fail("Expected local database vacinekids_demo.");
    if (parsed.schema !== schema) fail(`Expected explicit schema=${schema}.`);
    // Block duplicate or driver-specific routing options (host, service, options, etc.).
    const keys = [...parsed.url.searchParams.keys()];
    if (keys.length !== 1 || keys[0] !== "schema") fail("Only the schema query parameter is allowed locally.");
    return parsed;
  } catch {
    return fail("Invalid local database target; expected loopback/vacinekids_demo and an explicit schema.");
  }
};

export const validateIntegrationEnvironment = (
  developmentDatabaseUrl: string | undefined,
  testDatabaseUrl: string | undefined
) => {
  const confirmedDevelopmentUrl = developmentDatabaseUrl
    ? developmentDatabaseUrl
    : fail("DATABASE_URL is missing, so isolation cannot be confirmed.");
  const confirmedTestUrl = testDatabaseUrl
    ? testDatabaseUrl
    : fail("TEST_DATABASE_URL is missing.");

  let development;
  let test;
  try {
    development = validateLocalDatabase(confirmedDevelopmentUrl, "public");
    test = validateLocalDatabase(confirmedTestUrl, "integration_test");
  } catch {
    return fail("Both database URLs must be valid PostgreSQL URLs.");
  }

  if (development.url.href === test.url.href) fail("The development and test URLs are identical.");
  if (development.url.hostname !== test.url.hostname ||
      (development.url.port || "5432") !== (test.url.port || "5432")) {
    fail("Both schemas must use the same local server and port.");
  }
  if (development.schema !== "public") {
    fail("DATABASE_URL must explicitly select schema=public.");
  }
  if (test.schema === "public") fail("TEST_DATABASE_URL cannot select schema=public.");
  if (test.schema !== "integration_test") {
    fail("TEST_DATABASE_URL must explicitly select schema=integration_test.");
  }

  return {
    developmentDatabaseUrl: confirmedDevelopmentUrl,
    testDatabaseUrl: confirmedTestUrl,
    developmentSchema: "public" as const,
    testSchema: "integration_test" as const
  };
};

export const validateIntegrationProcess = (environment: NodeJS.ProcessEnv) => {
  if (environment.NODE_ENV !== "test") fail("Direct integration execution requires NODE_ENV=test.");
  const result = validateIntegrationEnvironment(environment.INTEGRATION_DEVELOPMENT_DATABASE_URL, environment.TEST_DATABASE_URL);
  if (environment.DATABASE_URL !== result.testDatabaseUrl) fail("Runtime URL must equal TEST_DATABASE_URL.");
  if (environment.DATABASE_URL_UNPOOLED) fail("Administrative URL must not be inherited by integration tests.");
  return result;
};
