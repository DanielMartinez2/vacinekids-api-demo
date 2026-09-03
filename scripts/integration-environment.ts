import { parseDatabaseUrl } from "../src/config/database-url";

export const INTEGRATION_ISOLATION_ERROR =
  "Integration tests aborted: TEST_DATABASE_URL must point to an isolated test schema.";

const fail = (reason: string): never => {
  throw new Error(`${INTEGRATION_ISOLATION_ERROR} ${reason}`);
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
    development = parseDatabaseUrl(confirmedDevelopmentUrl);
    test = parseDatabaseUrl(confirmedTestUrl);
  } catch {
    return fail("Both database URLs must be valid PostgreSQL URLs.");
  }

  if (development.url.href === test.url.href) fail("The development and test URLs are identical.");
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
