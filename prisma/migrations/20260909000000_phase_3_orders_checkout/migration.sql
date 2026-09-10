CREATE TYPE "order_status" AS ENUM ('PENDING_PAYMENT', 'CANCELLED');
CREATE TYPE "order_product_type" AS ENUM ('VACCINE', 'PACKAGE');
CREATE TYPE "order_recipient_type" AS ENUM ('CUSTOMER', 'DEPENDENT');

CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "number" VARCHAR(23) NOT NULL,
    "customer_profile_id" UUID NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "total_amount" DECIMAL(14,2) NOT NULL,
    "customer_name_snapshot" VARCHAR(160) NOT NULL,
    "customer_email_snapshot" VARCHAR(254) NOT NULL,
    "customer_phone_snapshot" VARCHAR(16) NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "checkout_fingerprint" CHAR(64) NOT NULL,
    "checkout_fingerprint_version" SMALLINT NOT NULL DEFAULT 1,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "orders_total_amount_check" CHECK ("total_amount" >= 0),
    CONSTRAINT "orders_currency_check" CHECK ("currency" = 'BRL'),
    CONSTRAINT "orders_number_format_check" CHECK ("number" ~ '^VK-[0-9A-F]{20}$'),
    CONSTRAINT "orders_request_hash_format_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "orders_checkout_fingerprint_format_check" CHECK ("checkout_fingerprint" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "orders_checkout_fingerprint_version_check" CHECK ("checkout_fingerprint_version" > 0),
    CONSTRAINT "orders_status_cancelled_at_check" CHECK (
        ("status" = 'PENDING_PAYMENT' AND "cancelled_at" IS NULL) OR
        ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL)
    ),
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "product_type" "order_product_type" NOT NULL,
    "vaccine_id" UUID,
    "package_id" UUID,
    "product_name_snapshot" VARCHAR(160) NOT NULL,
    "product_manufacturer_snapshot" VARCHAR(160),
    "unit_price" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_items_position_check" CHECK ("position" > 0),
    CONSTRAINT "order_items_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "order_items_unit_price_check" CHECK ("unit_price" >= 0),
    CONSTRAINT "order_items_line_total_check" CHECK ("line_total" >= 0),
    CONSTRAINT "order_items_line_total_consistency_check" CHECK ("line_total" = "unit_price" * "quantity"),
    CONSTRAINT "order_items_product_type_check" CHECK (
        ("product_type" = 'VACCINE' AND "vaccine_id" IS NOT NULL AND "package_id" IS NULL AND "product_manufacturer_snapshot" IS NOT NULL) OR
        ("product_type" = 'PACKAGE' AND "package_id" IS NOT NULL AND "vaccine_id" IS NULL AND "product_manufacturer_snapshot" IS NULL)
    ),
    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_item_recipients" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "recipient_type" "order_recipient_type" NOT NULL,
    "dependent_id" UUID,
    "recipient_name_snapshot" VARCHAR(160) NOT NULL,
    "recipient_birth_date_snapshot" DATE,
    "position" INTEGER NOT NULL,
    CONSTRAINT "order_item_recipients_position_check" CHECK ("position" > 0),
    CONSTRAINT "order_item_recipients_type_check" CHECK (
        ("recipient_type" = 'CUSTOMER' AND "dependent_id" IS NULL AND "recipient_birth_date_snapshot" IS NULL) OR
        ("recipient_type" = 'DEPENDENT' AND "dependent_id" IS NOT NULL AND "recipient_birth_date_snapshot" IS NOT NULL)
    ),
    CONSTRAINT "order_item_recipients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_item_components" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "vaccine_id" UUID NOT NULL,
    "vaccine_name_snapshot" VARCHAR(160) NOT NULL,
    "vaccine_manufacturer_snapshot" VARCHAR(160) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "order_item_components_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "order_item_components_position_check" CHECK ("position" > 0),
    CONSTRAINT "order_item_components_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");
CREATE UNIQUE INDEX "orders_customer_profile_id_idempotency_key_key" ON "orders"("customer_profile_id", "idempotency_key");
CREATE INDEX "orders_customer_profile_id_created_at_id_idx" ON "orders"("customer_profile_id", "created_at" DESC, "id" DESC);
CREATE UNIQUE INDEX "order_items_order_id_position_key" ON "order_items"("order_id", "position");
CREATE INDEX "order_items_vaccine_id_idx" ON "order_items"("vaccine_id");
CREATE INDEX "order_items_package_id_idx" ON "order_items"("package_id");
CREATE UNIQUE INDEX "order_item_recipients_order_item_id_position_key" ON "order_item_recipients"("order_item_id", "position");
CREATE INDEX "order_item_recipients_dependent_id_idx" ON "order_item_recipients"("dependent_id");
CREATE UNIQUE INDEX "order_item_components_order_item_id_position_key" ON "order_item_components"("order_item_id", "position");
CREATE UNIQUE INDEX "order_item_components_order_item_id_vaccine_id_key" ON "order_item_components"("order_item_id", "vaccine_id");
CREATE INDEX "order_item_components_vaccine_id_idx" ON "order_item_components"("vaccine_id");

ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_profile_id_fkey"
    FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_vaccine_id_fkey"
    FOREIGN KEY ("vaccine_id") REFERENCES "vaccines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_package_id_fkey"
    FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_item_recipients" ADD CONSTRAINT "order_item_recipients_order_item_id_fkey"
    FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_item_recipients" ADD CONSTRAINT "order_item_recipients_dependent_id_fkey"
    FOREIGN KEY ("dependent_id") REFERENCES "dependents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_item_components" ADD CONSTRAINT "order_item_components_order_item_id_fkey"
    FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_item_components" ADD CONSTRAINT "order_item_components_vaccine_id_fkey"
    FOREIGN KEY ("vaccine_id") REFERENCES "vaccines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
