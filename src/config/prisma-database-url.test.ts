import assert from "node:assert/strict";
import test from "node:test";
import { resolvePrismaDatabaseUrl } from "./prisma-database-url";

const pooledUrl = "postgresql://pooled.example.test/vacinekids";
const unpooledUrl = "postgresql://unpooled.example.test/vacinekids";

test("prefers a non-empty unpooled Prisma database URL", () => {
  assert.equal(
    resolvePrismaDatabaseUrl({
      DATABASE_URL: pooledUrl,
      DATABASE_URL_UNPOOLED: `  ${unpooledUrl}  `
    }),
    unpooledUrl
  );
});

test("falls back to DATABASE_URL when the unpooled URL is empty or whitespace", () => {
  for (const DATABASE_URL_UNPOOLED of ["", "   "]) {
    assert.equal(
      resolvePrismaDatabaseUrl({ DATABASE_URL: pooledUrl, DATABASE_URL_UNPOOLED }),
      pooledUrl
    );
  }
});

test("rejects missing or empty Prisma database URLs without exposing their values", () => {
  for (const environment of [
    {},
    { DATABASE_URL: "", DATABASE_URL_UNPOOLED: "   " }
  ]) {
    assert.throws(
      () => resolvePrismaDatabaseUrl(environment),
      /Prisma requires a non-empty DATABASE_URL_UNPOOLED or DATABASE_URL/
    );
  }
});
