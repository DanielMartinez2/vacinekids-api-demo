-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "vaccines" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL,
    "manufacturer" VARCHAR(160) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "vaccines_price_check" CHECK ("price" >= 0),
    CONSTRAINT "vaccines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccine_faqs" (
    "id" UUID NOT NULL,
    "vaccine_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "vaccine_faqs_position_check" CHECK ("position" >= 0),
    CONSTRAINT "vaccine_faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "age_ranges" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "min_age_months" INTEGER,
    "max_age_months" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "age_ranges_min_age_check" CHECK ("min_age_months" IS NULL OR "min_age_months" >= 0),
    CONSTRAINT "age_ranges_max_age_check" CHECK ("max_age_months" IS NULL OR "max_age_months" >= 0),
    CONSTRAINT "age_ranges_bounds_check" CHECK (
        "min_age_months" IS NULL OR "max_age_months" IS NULL OR "min_age_months" <= "max_age_months"
    ),
    CONSTRAINT "age_ranges_sort_order_check" CHECK ("sort_order" >= 0),
    CONSTRAINT "age_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccine_age_ranges" (
    "vaccine_id" UUID NOT NULL,
    "age_range_id" UUID NOT NULL,
    CONSTRAINT "vaccine_age_ranges_pkey" PRIMARY KEY ("vaccine_id", "age_range_id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "packages_price_check" CHECK ("price" >= 0),
    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_faqs" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "package_faqs_position_check" CHECK ("position" >= 0),
    CONSTRAINT "package_faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_vaccines" (
    "package_id" UUID NOT NULL,
    "vaccine_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "package_vaccines_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "package_vaccines_pkey" PRIMARY KEY ("package_id", "vaccine_id")
);

-- CreateIndex
CREATE INDEX "vaccines_deleted_at_idx" ON "vaccines"("deleted_at");
CREATE INDEX "vaccines_name_idx" ON "vaccines"("name");
CREATE UNIQUE INDEX "vaccines_name_manufacturer_key" ON "vaccines"("name", "manufacturer");
CREATE UNIQUE INDEX "vaccine_faqs_vaccine_id_position_key" ON "vaccine_faqs"("vaccine_id", "position");
CREATE UNIQUE INDEX "age_ranges_slug_key" ON "age_ranges"("slug");
CREATE INDEX "age_ranges_deleted_at_sort_order_idx" ON "age_ranges"("deleted_at", "sort_order");
CREATE INDEX "vaccine_age_ranges_age_range_id_idx" ON "vaccine_age_ranges"("age_range_id");
CREATE UNIQUE INDEX "packages_name_key" ON "packages"("name");
CREATE INDEX "packages_deleted_at_idx" ON "packages"("deleted_at");
CREATE INDEX "packages_name_idx" ON "packages"("name");
CREATE UNIQUE INDEX "package_faqs_package_id_position_key" ON "package_faqs"("package_id", "position");
CREATE INDEX "package_vaccines_vaccine_id_idx" ON "package_vaccines"("vaccine_id");

-- AddForeignKey
ALTER TABLE "vaccine_faqs" ADD CONSTRAINT "vaccine_faqs_vaccine_id_fkey"
    FOREIGN KEY ("vaccine_id") REFERENCES "vaccines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vaccine_age_ranges" ADD CONSTRAINT "vaccine_age_ranges_vaccine_id_fkey"
    FOREIGN KEY ("vaccine_id") REFERENCES "vaccines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vaccine_age_ranges" ADD CONSTRAINT "vaccine_age_ranges_age_range_id_fkey"
    FOREIGN KEY ("age_range_id") REFERENCES "age_ranges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "package_faqs" ADD CONSTRAINT "package_faqs_package_id_fkey"
    FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "package_vaccines" ADD CONSTRAINT "package_vaccines_package_id_fkey"
    FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "package_vaccines" ADD CONSTRAINT "package_vaccines_vaccine_id_fkey"
    FOREIGN KEY ("vaccine_id") REFERENCES "vaccines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
