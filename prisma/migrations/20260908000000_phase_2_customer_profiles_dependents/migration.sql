CREATE TABLE "customer_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "customer_profiles_name_format_check"
      CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 2 AND 160),
    CONSTRAINT "customer_profiles_phone_e164_check"
      CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dependents" (
    "id" UUID NOT NULL,
    "customer_profile_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "birth_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "dependents_name_format_check"
      CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 2 AND 160),
    CONSTRAINT "dependents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_profiles_user_id_key" ON "customer_profiles"("user_id");
CREATE INDEX "dependents_customer_profile_id_deleted_at_idx" ON "dependents"("customer_profile_id", "deleted_at");

ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dependents" ADD CONSTRAINT "dependents_customer_profile_id_fkey"
  FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
