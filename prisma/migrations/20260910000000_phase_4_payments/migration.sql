ALTER TYPE "order_status" ADD VALUE 'PAID' BEFORE 'CANCELLED';

CREATE TYPE "payment_status" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'CANCELLED');
CREATE TYPE "payment_attempt_status" AS ENUM ('CREATED', 'PROCESSING', 'APPROVED', 'REJECTED', 'ERROR', 'CANCELLED', 'EXPIRED');
CREATE TYPE "payment_provider" AS ENUM ('DEMO', 'MERCADO_PAGO');
CREATE TYPE "payment_method" AS ENUM ('DEMO', 'PIX', 'CARD');

ALTER TABLE "orders" DROP CONSTRAINT "orders_status_cancelled_at_check";
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_cancelled_at_check" CHECK (
    ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL) OR
    ("status" <> 'CANCELLED' AND "cancelled_at" IS NULL)
);

CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "paid_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "payments_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "payments_currency_check" CHECK ("currency" = 'BRL'),
    CONSTRAINT "payments_status_timestamps_check" CHECK (
        ("status" IN ('PENDING', 'PROCESSING') AND "paid_at" IS NULL AND "cancelled_at" IS NULL) OR
        ("status" = 'PAID' AND "paid_at" IS NOT NULL AND "cancelled_at" IS NULL) OR
        ("status" = 'CANCELLED' AND "paid_at" IS NULL AND "cancelled_at" IS NOT NULL)
    ),
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "payment_attempt_status" NOT NULL DEFAULT 'CREATED',
    "provider" "payment_provider" NOT NULL,
    "method" "payment_method" NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "provider_idempotency_key" VARCHAR(128) NOT NULL,
    "provider_payment_id" VARCHAR(128),
    "provider_status" VARCHAR(64),
    "provider_status_detail" VARCHAR(128),
    "provider_requested_at" TIMESTAMPTZ(3),
    "dispatch_lease_until" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "payment_attempts_sequence_check" CHECK ("sequence" > 0),
    CONSTRAINT "payment_attempts_request_hash_format_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "payment_attempts_provider_idempotency_key_check" CHECK (btrim("provider_idempotency_key") <> ''),
    CONSTRAINT "payment_attempts_provider_payment_id_check" CHECK ("provider_payment_id" IS NULL OR btrim("provider_payment_id") <> ''),
    CONSTRAINT "payment_attempts_provider_status_check" CHECK ("provider_status" IS NULL OR btrim("provider_status") <> ''),
    CONSTRAINT "payment_attempts_provider_status_detail_check" CHECK ("provider_status_detail" IS NULL OR btrim("provider_status_detail") <> ''),
    CONSTRAINT "payment_attempts_completed_at_check" CHECK (
        ("status" IN ('CREATED', 'PROCESSING') AND "completed_at" IS NULL) OR
        ("status" IN ('APPROVED', 'REJECTED', 'ERROR', 'CANCELLED', 'EXPIRED') AND "completed_at" IS NOT NULL)
    ),
    CONSTRAINT "payment_attempts_terminal_lease_check" CHECK (
        "status" IN ('CREATED', 'PROCESSING') OR "dispatch_lease_until" IS NULL
    ),
    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"("order_id");
CREATE UNIQUE INDEX "payment_attempts_payment_id_sequence_key" ON "payment_attempts"("payment_id", "sequence");
CREATE UNIQUE INDEX "payment_attempts_payment_id_idempotency_key_key" ON "payment_attempts"("payment_id", "idempotency_key");
CREATE UNIQUE INDEX "payment_attempts_provider_provider_idempotency_key_key" ON "payment_attempts"("provider", "provider_idempotency_key");
CREATE UNIQUE INDEX "payment_attempts_one_active_per_payment_idx" ON "payment_attempts"("payment_id")
    WHERE "status" IN ('CREATED', 'PROCESSING');
CREATE UNIQUE INDEX "payment_attempts_provider_provider_payment_id_key" ON "payment_attempts"("provider", "provider_payment_id")
    WHERE "provider_payment_id" IS NOT NULL;

ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
