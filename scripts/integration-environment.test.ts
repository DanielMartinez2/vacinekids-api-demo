import assert from "node:assert/strict";
import test from "node:test";
import {
  INTEGRATION_ISOLATION_ERROR,
  validateIntegrationEnvironment,
  validateIntegrationProcess
} from "./integration-environment";

const developmentUrl = "postgresql://demo:demo@localhost:5432/vacinekids_demo?schema=public";
const isolatedUrl =
  "postgresql://demo:demo@localhost:5432/vacinekids_demo?schema=integration_test";

const rejectsUnsafeEnvironment = (
  testUrl: string | undefined,
  development = developmentUrl
) => {
  assert.throws(
    () => validateIntegrationEnvironment(development, testUrl),
    (error: unknown) =>
      error instanceof Error && error.message.startsWith(INTEGRATION_ISOLATION_ERROR)
  );
};

test("accepts the explicit public and integration_test schema pair", () => {
  const result = validateIntegrationEnvironment(developmentUrl, isolatedUrl);
  assert.equal(result.developmentSchema, "public");
  assert.equal(result.testSchema, "integration_test");
});

test("rejects a missing TEST_DATABASE_URL", () => {
  rejectsUnsafeEnvironment(undefined);
});

test("rejects identical development and test URLs", () => {
  rejectsUnsafeEnvironment(developmentUrl);
});

test("rejects TEST_DATABASE_URL pointing to public", () => {
  rejectsUnsafeEnvironment("postgresql://other:other@localhost:5432/other?schema=public");
});

test("rejects a schema that cannot be confirmed as the integration test schema", () => {
  rejectsUnsafeEnvironment("postgresql://demo:demo@localhost:5432/vacinekids?schema=staging");
});

test("rejects a missing or non-public development schema", () => {
  rejectsUnsafeEnvironment(isolatedUrl, "postgresql://demo:demo@localhost:5432/vacinekids");
});

for (const host of ["ep-example.neon.tech", "neon.tech", "service.onrender.com", "example.com", "192.168.1.20", "127.0.0.1.evil.test"]) {
  test(`rejects remote host ${host} in either URL`, () => {
    rejectsUnsafeEnvironment(isolatedUrl.replace("localhost", host));
    rejectsUnsafeEnvironment(isolatedUrl, developmentUrl.replace("localhost", host));
  });
}

test("rejects wrong database, server, ambiguous schema and routing parameters", () => {
  rejectsUnsafeEnvironment(isolatedUrl.replace("vacinekids_demo", "production"));
  rejectsUnsafeEnvironment(isolatedUrl.replace(":5432", ":5433"));
  rejectsUnsafeEnvironment(isolatedUrl + "&schema=public");
  rejectsUnsafeEnvironment(isolatedUrl + "&host=example.com");
  rejectsUnsafeEnvironment(isolatedUrl + "&options=-csearch_path=public");
  assert.throws(() => validateIntegrationEnvironment(undefined, isolatedUrl));
});

test("direct execution requires a complete safe bootstrap before importing the database", () => {
  const safe = { NODE_ENV: "test", DATABASE_URL: isolatedUrl, TEST_DATABASE_URL: isolatedUrl,
    INTEGRATION_DEVELOPMENT_DATABASE_URL: developmentUrl, DATABASE_URL_UNPOOLED: "" };
  assert.doesNotThrow(() => validateIntegrationProcess(safe));
  for (const patch of [{NODE_ENV:"development"}, {DATABASE_URL:developmentUrl},
    {DATABASE_URL_UNPOOLED:"postgresql://example.com/remote"}, {INTEGRATION_DEVELOPMENT_DATABASE_URL:undefined}]) {
    assert.throws(() => validateIntegrationProcess({...safe, ...patch}));
  }
});
