-- Prompt Integrity Audit Trail
-- Persists every integrity check, analysis result, and transformation event.

CREATE TABLE IF NOT EXISTS "prompt_integrity_checks" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "chat_id" varchar REFERENCES "chats"("id") ON DELETE CASCADE,
    "run_id" varchar,
    "message_role" text,
    "client_prompt_len" integer,
    "client_prompt_hash" varchar(64),
    "server_prompt_len" integer NOT NULL,
    "server_prompt_hash" varchar(64) NOT NULL,
    "valid" boolean NOT NULL,
    "mismatch_type" text,
    "len_delta" integer,
    "request_id" varchar,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "prompt_integrity_chat_idx" ON "prompt_integrity_checks" ("chat_id");
CREATE INDEX IF NOT EXISTS "prompt_integrity_created_idx" ON "prompt_integrity_checks" ("created_at");
CREATE INDEX IF NOT EXISTS "prompt_integrity_valid_idx" ON "prompt_integrity_checks" ("valid");
CREATE INDEX IF NOT EXISTS "prompt_integrity_request_idx" ON "prompt_integrity_checks" ("request_id");

CREATE TABLE IF NOT EXISTS "prompt_analysis_results" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "chat_id" varchar REFERENCES "chats"("id") ON DELETE CASCADE,
    "run_id" varchar,
    "request_id" varchar,
    "confidence" integer,
    "needs_clarification" boolean DEFAULT false,
    "clarification_questions" jsonb,
    "extracted_spec" jsonb,
    "policy_violations" jsonb,
    "contradictions" jsonb,
    "used_llm" boolean DEFAULT false,
    "processing_time_ms" integer,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "prompt_analysis_chat_idx" ON "prompt_analysis_results" ("chat_id");
CREATE INDEX IF NOT EXISTS "prompt_analysis_created_idx" ON "prompt_analysis_results" ("created_at");
CREATE INDEX IF NOT EXISTS "prompt_analysis_request_idx" ON "prompt_analysis_results" ("request_id");
CREATE INDEX IF NOT EXISTS "prompt_analysis_spec_idx" ON "prompt_analysis_results" USING gin ("extracted_spec");

CREATE TABLE IF NOT EXISTS "prompt_transformation_log" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "chat_id" varchar REFERENCES "chats"("id") ON DELETE CASCADE,
    "run_id" varchar,
    "request_id" varchar,
    "stage" text NOT NULL,
    "input_tokens" integer,
    "output_tokens" integer,
    "dropped_messages" integer DEFAULT 0,
    "dropped_chars" integer DEFAULT 0,
    "transformation_details" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "prompt_transform_chat_idx" ON "prompt_transformation_log" ("chat_id");
CREATE INDEX IF NOT EXISTS "prompt_transform_created_idx" ON "prompt_transformation_log" ("created_at");
CREATE INDEX IF NOT EXISTS "prompt_transform_stage_idx" ON "prompt_transformation_log" ("stage");
CREATE INDEX IF NOT EXISTS "prompt_transform_request_idx" ON "prompt_transformation_log" ("request_id");
