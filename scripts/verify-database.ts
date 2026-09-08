import "dotenv/config";
import assert from "node:assert/strict";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required to verify the database");
}

const configuredSchema = new URL(databaseUrl).searchParams.get("schema") ?? "public";
const client = new pg.Client({ connectionString: databaseUrl });

const expectedTables = [
  "age_ranges",
  "customer_profiles",
  "dependents",
  "package_faqs",
  "package_vaccines",
  "packages",
  "vaccine_age_ranges",
  "vaccine_faqs",
  "vaccines"
];

const expectedForeignKeys = [
  "customer_profiles_user_id_fkey",
  "dependents_customer_profile_id_fkey",
  "package_faqs_package_id_fkey",
  "package_vaccines_package_id_fkey",
  "package_vaccines_vaccine_id_fkey",
  "vaccine_age_ranges_age_range_id_fkey",
  "vaccine_age_ranges_vaccine_id_fkey",
  "vaccine_faqs_vaccine_id_fkey"
];

const expectedCheckConstraints = [
  "age_ranges_bounds_check",
  "age_ranges_max_age_check",
  "age_ranges_min_age_check",
  "age_ranges_sort_order_check",
  "customer_profiles_name_format_check",
  "customer_profiles_phone_e164_check",
  "dependents_name_format_check",
  "package_faqs_position_check",
  "package_vaccines_quantity_check",
  "packages_price_check",
  "vaccine_faqs_position_check",
  "vaccines_price_check"
];

const expectedIndexes = [
  "age_ranges_deleted_at_sort_order_idx",
  "age_ranges_slug_key",
  "customer_profiles_user_id_key",
  "dependents_customer_profile_id_deleted_at_idx",
  "package_faqs_package_id_position_key",
  "package_vaccines_pkey",
  "package_vaccines_vaccine_id_idx",
  "packages_deleted_at_idx",
  "packages_name_idx",
  "packages_name_key",
  "vaccine_age_ranges_age_range_id_idx",
  "vaccine_age_ranges_pkey",
  "vaccine_faqs_vaccine_id_position_key",
  "vaccines_deleted_at_idx",
  "vaccines_name_idx",
  "vaccines_name_manufacturer_key"
];

const main = async () => {
  await client.connect();

  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = $1 AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
    [configuredSchema]
  );
  for (const table of expectedTables) {
    assert(tables.rows.some(({ table_name }) => table_name === table), `Missing table: ${table}`);
  }

  const constraints = await client.query<{ conname: string; contype: string }>(
    `SELECT c.conname, c.contype
       FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = $1`,
    [configuredSchema]
  );
  for (const name of expectedForeignKeys) {
    assert(constraints.rows.some((constraint) => constraint.conname === name && constraint.contype === "f"), `Missing foreign key: ${name}`);
  }
  for (const name of expectedCheckConstraints) {
    assert(constraints.rows.some((constraint) => constraint.conname === name && constraint.contype === "c"), `Missing check constraint: ${name}`);
  }

  const indexes = await client.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE schemaname = $1",
    [configuredSchema]
  );
  for (const name of expectedIndexes) {
    assert(indexes.rows.some(({ indexname }) => indexname === name), `Missing index: ${name}`);
  }

  const decimalColumns = await client.query<{
    table_name: string;
    numeric_precision: number;
    numeric_scale: number;
  }>(
    `SELECT table_name, numeric_precision, numeric_scale
       FROM information_schema.columns
      WHERE table_schema = $1 AND column_name = 'price' AND table_name IN ('vaccines', 'packages')`,
    [configuredSchema]
  );
  assert.equal(decimalColumns.rowCount, 2, "Expected DECIMAL price columns on vaccines and packages");
  for (const column of decimalColumns.rows) {
    assert.equal(column.numeric_precision, 12, `${column.table_name}.price must have precision 12`);
    assert.equal(column.numeric_scale, 2, `${column.table_name}.price must have scale 2`);
  }

  const softDeleteColumns = await client.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.columns
      WHERE table_schema = $1
        AND column_name = 'deleted_at'
        AND table_name IN ('vaccines', 'packages', 'age_ranges', 'dependents')`,
    [configuredSchema]
  );
  assert.equal(softDeleteColumns.rowCount, 4, "Expected deleted_at on catalog resources and dependents");

  const customerColumns = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    character_maximum_length: number | null;
    is_nullable: "YES" | "NO";
  }>(
    `SELECT table_name, column_name, data_type, character_maximum_length, is_nullable
       FROM information_schema.columns
      WHERE table_schema = $1
        AND (table_name, column_name) IN (
          ('customer_profiles', 'name'),
          ('customer_profiles', 'phone'),
          ('customer_profiles', 'deleted_at'),
          ('dependents', 'name'),
          ('dependents', 'birth_date'),
          ('dependents', 'deleted_at')
        )`,
    [configuredSchema]
  );
  const column = (table: string, name: string) =>
    customerColumns.rows.find((value) => value.table_name === table && value.column_name === name);
  assert.deepEqual(
    { type: column("customer_profiles", "name")?.data_type, length: column("customer_profiles", "name")?.character_maximum_length },
    { type: "character varying", length: 160 },
    "customer_profiles.name must be VARCHAR(160)"
  );
  assert.deepEqual(
    { type: column("customer_profiles", "phone")?.data_type, length: column("customer_profiles", "phone")?.character_maximum_length },
    { type: "character varying", length: 16 },
    "customer_profiles.phone must be VARCHAR(16)"
  );
  assert.deepEqual(
    { type: column("dependents", "name")?.data_type, length: column("dependents", "name")?.character_maximum_length },
    { type: "character varying", length: 160 },
    "dependents.name must be VARCHAR(160)"
  );
  assert.equal(column("dependents", "birth_date")?.data_type, "date", "dependents.birth_date must be DATE");
  assert.equal(column("dependents", "birth_date")?.is_nullable, "NO", "dependents.birth_date must be required");
  assert.equal(column("dependents", "deleted_at")?.data_type, "timestamp with time zone", "dependents.deleted_at must be TIMESTAMPTZ");
  assert.equal(column("dependents", "deleted_at")?.is_nullable, "YES", "dependents.deleted_at must be nullable");
  assert.equal(column("customer_profiles", "deleted_at"), undefined, "customer_profiles must not use soft delete");

  console.log(
    `Database verified: ${expectedTables.length} tables, ${expectedForeignKeys.length} foreign keys, ` +
      `${expectedCheckConstraints.length} check constraints and required indexes are present.`
  );
};

main()
  .catch((error) => {
    console.error("Database verification failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => undefined);
  });
