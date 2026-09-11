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
  "order_item_components",
  "order_item_recipients",
  "order_items",
  "orders",
  "payment_attempts",
  "payments",
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
  "orders_customer_profile_id_fkey",
  "order_items_order_id_fkey",
  "order_items_vaccine_id_fkey",
  "order_items_package_id_fkey",
  "order_item_recipients_order_item_id_fkey",
  "order_item_recipients_dependent_id_fkey",
  "order_item_components_order_item_id_fkey",
  "order_item_components_vaccine_id_fkey",
  "payments_order_id_fkey",
  "payment_attempts_payment_id_fkey",
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
  "orders_total_amount_check",
  "orders_currency_check",
  "orders_number_format_check",
  "orders_request_hash_format_check",
  "orders_checkout_fingerprint_format_check",
  "orders_checkout_fingerprint_version_check",
  "orders_status_cancelled_at_check",
  "order_items_position_check",
  "order_items_quantity_check",
  "order_items_unit_price_check",
  "order_items_line_total_check",
  "order_items_line_total_consistency_check",
  "order_items_product_type_check",
  "order_item_recipients_position_check",
  "order_item_recipients_type_check",
  "order_item_components_quantity_check",
  "order_item_components_position_check",
  "payments_amount_check",
  "payments_currency_check",
  "payments_status_timestamps_check",
  "payment_attempts_sequence_check",
  "payment_attempts_request_hash_format_check",
  "payment_attempts_provider_idempotency_key_check",
  "payment_attempts_provider_payment_id_check",
  "payment_attempts_provider_status_check",
  "payment_attempts_provider_status_detail_check",
  "payment_attempts_completed_at_check",
  "payment_attempts_terminal_lease_check",
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
  "orders_number_key",
  "orders_customer_profile_id_idempotency_key_key",
  "orders_customer_profile_id_created_at_id_idx",
  "order_items_order_id_position_key",
  "order_items_vaccine_id_idx",
  "order_items_package_id_idx",
  "order_item_recipients_order_item_id_position_key",
  "order_item_recipients_dependent_id_idx",
  "order_item_components_order_item_id_position_key",
  "order_item_components_order_item_id_vaccine_id_key",
  "order_item_components_vaccine_id_idx",
  "payments_order_id_key",
  "payment_attempts_payment_id_sequence_key",
  "payment_attempts_payment_id_idempotency_key_key",
  "payment_attempts_provider_provider_idempotency_key_key",
  "payment_attempts_one_active_per_payment_idx",
  "payment_attempts_provider_provider_payment_id_key",
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

  const enums = await client.query<{ enum_name: string; labels: string[] }>(
    `SELECT t.typname AS enum_name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1
        AND t.typname IN (
          'order_status', 'order_product_type', 'order_recipient_type',
          'payment_status', 'payment_attempt_status', 'payment_provider', 'payment_method'
        )
      GROUP BY t.typname`,
    [configuredSchema]
  );
  const enumLabels = (name: string) => enums.rows.find(({ enum_name }) => enum_name === name)?.labels;
  assert.deepEqual(enumLabels("order_status"), ["PENDING_PAYMENT", "PAID", "CANCELLED"]);
  assert.deepEqual(enumLabels("order_product_type"), ["VACCINE", "PACKAGE"]);
  assert.deepEqual(enumLabels("order_recipient_type"), ["CUSTOMER", "DEPENDENT"]);
  assert.deepEqual(enumLabels("payment_status"), ["PENDING", "PROCESSING", "PAID", "CANCELLED"]);
  assert.deepEqual(enumLabels("payment_attempt_status"), ["CREATED", "PROCESSING", "APPROVED", "REJECTED", "ERROR", "CANCELLED", "EXPIRED"]);
  assert.deepEqual(enumLabels("payment_provider"), ["DEMO", "MERCADO_PAGO"]);
  assert.deepEqual(enumLabels("payment_method"), ["DEMO", "PIX", "CARD"]);

  const decimalColumns = await client.query<{
    table_name: string;
    column_name: string;
    numeric_precision: number;
    numeric_scale: number;
  }>(
    `SELECT table_name, column_name, numeric_precision, numeric_scale
       FROM information_schema.columns
      WHERE table_schema = $1
        AND (table_name, column_name) IN (
          ('vaccines', 'price'), ('packages', 'price'),
          ('orders', 'total_amount'), ('order_items', 'unit_price'), ('order_items', 'line_total'),
          ('payments', 'amount')
        )`,
    [configuredSchema]
  );
  assert.equal(decimalColumns.rowCount, 6, "Expected all catalog, order and payment DECIMAL columns");
  for (const column of decimalColumns.rows) {
    const amount = column.column_name === "total_amount" || column.column_name === "line_total" || column.table_name === "payments";
    assert.equal(column.numeric_precision, amount ? 14 : 12, `${column.table_name} has unexpected numeric precision`);
    assert.equal(column.numeric_scale, 2, `${column.table_name}.price must have scale 2`);
  }

  const orderColumns = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
    character_maximum_length: number | null;
    is_nullable: "YES" | "NO";
    column_default: string | null;
  }>(
    `SELECT table_name, column_name, data_type, udt_name, character_maximum_length, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name IN ('orders', 'order_items', 'order_item_recipients', 'order_item_components')`,
    [configuredSchema]
  );
  assert.equal(orderColumns.rowCount, 42, "Expected the exact column count across the four order tables");
  const orderColumn = (table: string, name: string) =>
    orderColumns.rows.find((value) => value.table_name === table && value.column_name === name);
  for (const [table, name] of [
    ["orders", "id"], ["orders", "customer_profile_id"], ["orders", "idempotency_key"],
    ["order_items", "vaccine_id"], ["order_items", "package_id"],
    ["order_item_recipients", "dependent_id"], ["order_item_components", "vaccine_id"]
  ]) assert.equal(orderColumn(table, name)?.data_type, "uuid", `${table}.${name} must be UUID`);
  assert.deepEqual(
    { type: orderColumn("orders", "number")?.data_type, length: orderColumn("orders", "number")?.character_maximum_length },
    { type: "character varying", length: 23 }
  );
  assert.equal(orderColumn("orders", "currency")?.data_type, "character");
  assert.equal(orderColumn("orders", "currency")?.character_maximum_length, 3);
  assert.equal(orderColumn("orders", "request_hash")?.character_maximum_length, 64);
  assert.equal(orderColumn("orders", "checkout_fingerprint")?.character_maximum_length, 64);
  assert.equal(orderColumn("orders", "checkout_fingerprint_version")?.data_type, "smallint");
  assert.equal(orderColumn("orders", "status")?.udt_name, "order_status");
  assert.equal(orderColumn("order_items", "product_type")?.udt_name, "order_product_type");
  assert.equal(orderColumn("order_item_recipients", "recipient_type")?.udt_name, "order_recipient_type");
  assert.match(orderColumn("orders", "status")?.column_default ?? "", /PENDING_PAYMENT/);
  assert.match(orderColumn("orders", "currency")?.column_default ?? "", /BRL/);
  assert.match(orderColumn("orders", "checkout_fingerprint_version")?.column_default ?? "", /1/);
  assert.equal(orderColumn("orders", "cancelled_at")?.data_type, "timestamp with time zone");
  assert.equal(orderColumn("orders", "cancelled_at")?.is_nullable, "YES");
  assert.equal(orderColumn("order_item_recipients", "recipient_birth_date_snapshot")?.data_type, "date");
  for (const [table, name] of [
    ["order_items", "vaccine_id"], ["order_items", "package_id"],
    ["order_items", "product_manufacturer_snapshot"], ["order_item_recipients", "dependent_id"],
    ["order_item_recipients", "recipient_birth_date_snapshot"]
  ]) assert.equal(orderColumn(table, name)?.is_nullable, "YES", `${table}.${name} must be nullable`);
  const nullableOrderColumns = new Set([
    "orders.cancelled_at",
    "order_items.vaccine_id",
    "order_items.package_id",
    "order_items.product_manufacturer_snapshot",
    "order_item_recipients.dependent_id",
    "order_item_recipients.recipient_birth_date_snapshot"
  ]);
  for (const value of orderColumns.rows) {
    const expected = nullableOrderColumns.has(`${value.table_name}.${value.column_name}`) ? "YES" : "NO";
    assert.equal(value.is_nullable, expected, `${value.table_name}.${value.column_name} has unexpected nullability`);
  }
  for (const [table, name, length] of [
    ["orders", "customer_name_snapshot", 160], ["orders", "customer_email_snapshot", 254],
    ["orders", "customer_phone_snapshot", 16], ["orders", "request_hash", 64],
    ["orders", "checkout_fingerprint", 64], ["order_items", "product_name_snapshot", 160],
    ["order_items", "product_manufacturer_snapshot", 160], ["order_item_recipients", "recipient_name_snapshot", 160],
    ["order_item_components", "vaccine_name_snapshot", 160], ["order_item_components", "vaccine_manufacturer_snapshot", 160]
  ] as const) assert.equal(orderColumn(table, name)?.character_maximum_length, length, `${table}.${name} has unexpected length`);
  for (const [table, name] of [
    ["orders", "created_at"], ["orders", "updated_at"], ["order_items", "created_at"]
  ]) assert.equal(orderColumn(table, name)?.data_type, "timestamp with time zone", `${table}.${name} must be TIMESTAMPTZ`);

  const fkActions = await client.query<{ conname: string; delete_action: string; update_action: string }>(
    `SELECT c.conname, c.confdeltype AS delete_action, c.confupdtype AS update_action
       FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = $1 AND c.contype = 'f' AND c.conname = ANY($2::text[])`,
    [configuredSchema, expectedForeignKeys.filter((name) => name.startsWith("order"))]
  );
  for (const foreignKey of fkActions.rows) {
    const childRelation = foreignKey.conname.includes("order_id_fkey") || foreignKey.conname.includes("order_item_id_fkey");
    assert.equal(foreignKey.delete_action, childRelation ? "c" : "r", `${foreignKey.conname} has incorrect ON DELETE`);
    assert.equal(foreignKey.update_action, "c", `${foreignKey.conname} must use ON UPDATE CASCADE`);
  }
  assert.equal(fkActions.rowCount, 8, "Expected all eight order foreign keys with validated actions");

  const paymentFkActions = await client.query<{ conname: string; delete_action: string; update_action: string }>(
    `SELECT c.conname, c.confdeltype AS delete_action, c.confupdtype AS update_action
       FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = $1
        AND c.contype = 'f'
        AND c.conname = ANY($2::text[])`,
    [configuredSchema, ["payments_order_id_fkey", "payment_attempts_payment_id_fkey"]]
  );
  assert.equal(paymentFkActions.rowCount, 2, "Expected both payment foreign keys");
  for (const foreignKey of paymentFkActions.rows) {
    assert.equal(foreignKey.delete_action, "r", `${foreignKey.conname} must use ON DELETE RESTRICT`);
    assert.equal(foreignKey.update_action, "c", `${foreignKey.conname} must use ON UPDATE CASCADE`);
  }

  const paymentColumns = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
    character_maximum_length: number | null;
    is_nullable: "YES" | "NO";
  }>(
    `SELECT table_name, column_name, data_type, udt_name, character_maximum_length, is_nullable
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name IN ('payments', 'payment_attempts')`,
    [configuredSchema]
  );
  assert.equal(paymentColumns.rowCount, 27, "Expected the exact column count across payment tables");
  const paymentColumn = (table: string, name: string) =>
    paymentColumns.rows.find((value) => value.table_name === table && value.column_name === name);
  for (const [table, name] of [
    ["payments", "id"], ["payments", "order_id"],
    ["payment_attempts", "id"], ["payment_attempts", "payment_id"], ["payment_attempts", "idempotency_key"]
  ]) assert.equal(paymentColumn(table, name)?.data_type, "uuid", `${table}.${name} must be UUID`);
  assert.equal(paymentColumn("payments", "status")?.udt_name, "payment_status");
  assert.equal(paymentColumn("payment_attempts", "status")?.udt_name, "payment_attempt_status");
  assert.equal(paymentColumn("payment_attempts", "provider")?.udt_name, "payment_provider");
  assert.equal(paymentColumn("payment_attempts", "method")?.udt_name, "payment_method");
  assert.equal(paymentColumn("payments", "currency")?.character_maximum_length, 3);
  assert.equal(paymentColumn("payment_attempts", "request_hash")?.character_maximum_length, 64);
  for (const [name, length] of [
    ["provider_idempotency_key", 128], ["provider_payment_id", 128],
    ["provider_status", 64], ["provider_status_detail", 128]
  ] as const) assert.equal(paymentColumn("payment_attempts", name)?.character_maximum_length, length);
  for (const name of ["provider_payment_id", "provider_status", "provider_status_detail", "provider_requested_at", "dispatch_lease_until", "expires_at", "completed_at"])
    assert.equal(paymentColumn("payment_attempts", name)?.is_nullable, "YES", `payment_attempts.${name} must be nullable`);
  for (const name of ["paid_at", "cancelled_at"])
    assert.equal(paymentColumn("payments", name)?.is_nullable, "YES", `payments.${name} must be nullable`);

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
