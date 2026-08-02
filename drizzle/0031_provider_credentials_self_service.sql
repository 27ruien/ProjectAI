ALTER TABLE "ai_provider_profiles"
  ADD COLUMN "credential_mode" varchar(24) DEFAULT 'environment' NOT NULL,
  ADD COLUMN "model_discovery_supported" boolean DEFAULT false NOT NULL,
  ADD COLUMN "last_test_latency_ms" integer,
  ADD COLUMN "last_test_request_id" varchar(240),
  ADD CONSTRAINT "ai_provider_profile_credential_mode_check" CHECK ("credential_mode" in ('environment', 'managed'));

CREATE TABLE "ai_provider_credentials" (
  "provider_profile_id" text PRIMARY KEY NOT NULL REFERENCES "ai_provider_profiles"("id") ON DELETE cascade,
  "ciphertext" text NOT NULL,
  "iv" varchar(64) NOT NULL,
  "auth_tag" varchar(64) NOT NULL,
  "key_version" integer DEFAULT 1 NOT NULL,
  "api_key_last4" varchar(4) NOT NULL,
  "created_by" text NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "updated_by" text NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_provider_credential_key_version_check" CHECK ("key_version" = 1),
  CONSTRAINT "ai_provider_credential_last4_check" CHECK (length("api_key_last4") = 4)
);

ALTER TABLE "ai_generation_models"
  ADD COLUMN "supports_thinking" boolean DEFAULT false NOT NULL,
  ADD COLUMN "disable_thinking_for_json" boolean DEFAULT true NOT NULL,
  ADD COLUMN "last_test_error_code" varchar(80),
  ADD COLUMN "last_test_latency_ms" integer,
  ADD COLUMN "last_test_request_id" varchar(240);

DROP INDEX "ai_generation_model_org_model_uidx";
CREATE UNIQUE INDEX "ai_generation_model_org_provider_model_uidx" ON "ai_generation_models" ("organization_id", "provider_profile_id", "model_id");

ALTER TABLE "ai_embedding_models"
  ADD COLUMN "last_test_error_code" varchar(80),
  ADD COLUMN "last_test_latency_ms" integer,
  ADD COLUMN "last_test_request_id" varchar(240);
