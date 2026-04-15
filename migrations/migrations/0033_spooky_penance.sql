CREATE TABLE "ad_impressions" (
	"id" serial PRIMARY KEY NOT NULL,
	"ad_id" integer NOT NULL,
	"session_id" varchar(255),
	"query" text,
	"matched_keyword" varchar(100),
	"clicked" boolean DEFAULT false,
	"cost_charged" integer DEFAULT 1,
	"placement" varchar(30) DEFAULT 'in_chat',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_episodic_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_mode_artifacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"step_id" varchar NOT NULL,
	"step_index" integer,
	"artifact_key" varchar NOT NULL,
	"type" varchar NOT NULL,
	"name" varchar NOT NULL,
	"url" text,
	"payload" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_before" text NOT NULL,
	"action" jsonb NOT NULL,
	"state_after" text NOT NULL,
	"reward" double precision NOT NULL,
	"app_context" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" varchar(255) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"key_prefix" varchar(12) NOT NULL,
	"last_used_at" timestamp with time zone,
	"request_count" integer DEFAULT 0,
	"rate_limit" integer DEFAULT 60,
	"is_active" boolean DEFAULT true,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_releases" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"version" text NOT NULL,
	"size" text NOT NULL,
	"requirements" text NOT NULL,
	"available" text DEFAULT 'false',
	"file_name" text NOT NULL,
	"download_url" text NOT NULL,
	"note" text,
	"is_active" text DEFAULT 'true',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"provider" varchar(50) NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" bigint,
	"scope" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_credit_grants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"credits_granted" integer NOT NULL,
	"credits_remaining" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"amount_minor" integer NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "channel_conversations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"channel" text NOT NULL,
	"channel_key" text NOT NULL,
	"external_conversation_id" text NOT NULL,
	"chat_id" varchar NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_pairing_codes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"channel" text NOT NULL,
	"code" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"consumed_by_external_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_group_shares" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar NOT NULL,
	"group_id" varchar NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"invited_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_schedules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"chat_id" varchar NOT NULL,
	"name" text DEFAULT 'Programación' NOT NULL,
	"prompt" text NOT NULL,
	"schedule_type" text NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"run_at" timestamp,
	"time_of_day" text,
	"days_of_week" integer[],
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"locked_at" timestamp,
	"locked_by" text,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodic_summaries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"user_id" varchar NOT NULL,
	"conversation_id" varchar NOT NULL,
	"summary" text NOT NULL,
	"main_topics" text[] DEFAULT '{}',
	"key_entities" text[] DEFAULT '{}',
	"key_decisions" text[] DEFAULT '{}',
	"sentiment" varchar(20),
	"turn_count" integer DEFAULT 0,
	"token_count" integer DEFAULT 0,
	"embedding" vector(1536),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gpt_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar,
	"gpt_id" varchar NOT NULL,
	"config_version" integer NOT NULL,
	"frozen_system_prompt" text NOT NULL,
	"frozen_capabilities" jsonb,
	"frozen_tool_permissions" jsonb,
	"frozen_runtime_policy" jsonb,
	"enforced_model_id" text,
	"knowledge_context_ids" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ilia_ads" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"image_url" text,
	"target_url" text NOT NULL,
	"advertiser" varchar(100) NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"category" varchar(50) DEFAULT 'general',
	"objective" varchar(50) DEFAULT 'automatic',
	"cost_per_impression" integer DEFAULT 1,
	"daily_budget" integer DEFAULT 350,
	"total_budget" integer,
	"cost_spent" integer DEFAULT 0,
	"impressions" integer DEFAULT 0,
	"clicks" integer DEFAULT 0,
	"messages_received" integer DEFAULT 0,
	"active" boolean DEFAULT true,
	"status" varchar(30) DEFAULT 'draft',
	"target_country" varchar(50) DEFAULT 'PE',
	"min_age" integer DEFAULT 18,
	"max_age" integer DEFAULT 65,
	"gender" varchar(20) DEFAULT 'all',
	"advantage_plus" boolean DEFAULT true,
	"duration_days" integer DEFAULT 7,
	"start_date" timestamp DEFAULT now(),
	"end_date" timestamp,
	"placements" text[] DEFAULT '{in_chat}'::text[],
	"payment_method" varchar(50) DEFAULT 'per_impression',
	"currency" varchar(10) DEFAULT 'PEN',
	"created_at" timestamp DEFAULT now(),
	"expires_at" timestamp,
	"created_by" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "knowledge_edges" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"source_node_id" varchar NOT NULL,
	"target_node_id" varchar NOT NULL,
	"relation_type" text NOT NULL,
	"weight" real DEFAULT 1,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_nodes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"zettel_id" varchar(64),
	"title" text NOT NULL,
	"content" text NOT NULL,
	"node_type" text DEFAULT 'note' NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" varchar,
	"tags" text[] DEFAULT '{}',
	"embedding" vector(1536),
	"search_vector" "tsvector",
	"content_hash" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"importance" real DEFAULT 0.5,
	"access_count" integer DEFAULT 0,
	"last_accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "magic_links" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "magic_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "memory_facts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" varchar NOT NULL,
	"fact_type" varchar(50) NOT NULL,
	"content" text NOT NULL,
	"confidence" integer DEFAULT 80,
	"source" varchar(50),
	"extracted_at_turn" integer,
	"valid_until" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"node_id" varchar NOT NULL,
	"requested_by_user_id" varchar NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "node_pairings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"created_by_user_id" varchar NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text DEFAULT 'default' NOT NULL,
	"owner_user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"platform" text,
	"agent_version" text,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"last_seen_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" varchar(255) PRIMARY KEY NOT NULL,
	"return_url" text DEFAULT '/' NOT NULL,
	"provider" varchar(50) DEFAULT 'google' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens_global" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(50) NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" bigint,
	"scope" text,
	"label" text,
	"models" text,
	"added_by_user_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens_user" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"provider" varchar(50) NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" bigint,
	"scope" text,
	"models" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_engine_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"parent_artifact_id" uuid,
	"kind" text NOT NULL,
	"path" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"checksum_sha256" text NOT NULL,
	"version_label" text DEFAULT 'v1' NOT NULL,
	"zip_entry_count" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_engine_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"objective" text NOT NULL,
	"objective_hash" text NOT NULL,
	"doc_kind" text NOT NULL,
	"input_checksum" text NOT NULL,
	"input_name" text,
	"input_size" integer,
	"sandbox_path" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"fallback_level" integer DEFAULT 0 NOT NULL,
	"retry_of_run_id" uuid,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_engine_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"stage" text NOT NULL,
	"step_type" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer,
	"input_digest" text,
	"output_digest" text,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"diff" jsonb,
	"error" jsonb
);
--> statement-breakpoint
CREATE TABLE "openclaw_admin_config" (
	"id" varchar PRIMARY KEY DEFAULT 'default' NOT NULL,
	"default_tokens_limit" integer DEFAULT 50000 NOT NULL,
	"global_enabled" boolean DEFAULT true NOT NULL,
	"auto_provision_on_login" boolean DEFAULT true NOT NULL,
	"github_repo" varchar DEFAULT 'openclaw/openclaw',
	"current_version" varchar DEFAULT 'v2026.4.12',
	"last_sync_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "openclaw_instances" (
	"id" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"instance_id" varchar NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" varchar DEFAULT 'v2026.4.12',
	"config" jsonb DEFAULT '{}'::jsonb,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"tokens_limit" integer DEFAULT 50000 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"last_active_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "openclaw_instances_instance_id_unique" UNIQUE("instance_id")
);
--> statement-breakpoint
CREATE TABLE "openclaw_token_ledger" (
	"id" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"instance_id" varchar NOT NULL,
	"action" text NOT NULL,
	"tool_name" varchar,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"model" varchar,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orchestrator_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orchestrator_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"run_id" uuid NOT NULL,
	"type" text DEFAULT 'data' NOT NULL,
	"name" text NOT NULL,
	"content_json" jsonb,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orchestrator_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"objective" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"budget_limit_usd" double precision,
	"time_limit_ms" integer,
	"concurrency_limit" integer DEFAULT 10 NOT NULL,
	"created_by" text NOT NULL,
	"dag_json" jsonb,
	"result_json" jsonb,
	"error" text,
	"total_tasks" integer DEFAULT 0 NOT NULL,
	"completed_tasks" integer DEFAULT 0 NOT NULL,
	"failed_tasks" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" double precision DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orchestrator_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"parent_task_id" uuid,
	"agent_role" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input_json" jsonb,
	"output_json" jsonb,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"depends_on" text[],
	"risk_level" text DEFAULT 'safe' NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"network_access_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"confirmation_id" text,
	"package_name" text NOT NULL,
	"manager" text NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"os_family" text,
	"os_distro" text,
	"command" text,
	"policy_decision" text,
	"policy_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requested_by" text,
	"stdout" text,
	"stderr" text,
	"exit_code" integer,
	"duration_ms" integer,
	"rollback_command" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_cost_per_million" double precision NOT NULL,
	"output_cost_per_million" double precision NOT NULL,
	"context_window" integer NOT NULL,
	"max_output_tokens" integer,
	"rpm_limit" integer,
	"tpm_limit" integer,
	"status" text DEFAULT 'enabled' NOT NULL,
	"pricing_version" text DEFAULT 'v1' NOT NULL,
	"effective_date" timestamp DEFAULT now() NOT NULL,
	"deprecated_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" varchar(100) NOT NULL,
	"state_id" varchar NOT NULL,
	"message_id" varchar(100),
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_requests_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "prompt_analysis_results" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar,
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
--> statement-breakpoint
CREATE TABLE "prompt_integrity_checks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar,
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
--> statement-breakpoint
CREATE TABLE "prompt_transformation_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar,
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
--> statement-breakpoint
CREATE TABLE "rag_audit_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"user_id" varchar NOT NULL,
	"action" varchar(50) NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" varchar,
	"details" jsonb DEFAULT '{}'::jsonb,
	"pii_detected" boolean DEFAULT false,
	"pii_types" text[] DEFAULT '{}',
	"ip_address" varchar(45),
	"user_agent" text,
	"duration_ms" integer,
	"success" boolean DEFAULT true,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_chunks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"user_id" varchar NOT NULL,
	"conversation_id" varchar,
	"thread_id" varchar,
	"source" varchar(200) NOT NULL,
	"source_id" varchar(200),
	"content" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"embedding" vector(1536),
	"search_vector" "tsvector",
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"total_chunks" integer,
	"title" text,
	"mime_type" varchar(100),
	"language" varchar(10),
	"page_number" integer,
	"section_title" text,
	"chunk_type" varchar(50) DEFAULT 'paragraph',
	"importance" real DEFAULT 0.5,
	"acl_tags" text[] DEFAULT '{}',
	"tags" text[] DEFAULT '{}',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true,
	"expires_at" timestamp with time zone,
	"access_count" integer DEFAULT 0,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_eval_results" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar(100) NOT NULL,
	"test_case_id" varchar(200) NOT NULL,
	"query" text NOT NULL,
	"expected_chunk_ids" text[] DEFAULT '{}',
	"retrieved_chunk_ids" text[] DEFAULT '{}',
	"recall_at_k" real,
	"precision_at_k" real,
	"mrr" real,
	"ndcg" real,
	"hit_rate" real,
	"latency_ms" integer,
	"answer_relevance" real,
	"faithfulness" real,
	"context_precision" real,
	"k" integer DEFAULT 5,
	"retrieval_config" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_kv_store" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"user_id" varchar NOT NULL,
	"namespace" varchar(100) NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remote_shell_targets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 22,
	"username" text NOT NULL,
	"auth_type" text NOT NULL,
	"encrypted_secret" text NOT NULL,
	"secret_hint" text,
	"owner_id" varchar NOT NULL,
	"allowed_admin_ids" text[] DEFAULT ARRAY[]::text[],
	"notes" text,
	"last_connected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_telemetry" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" varchar NOT NULL,
	"request_id" varchar(100) NOT NULL,
	"query" text NOT NULL,
	"chunks_retrieved" integer DEFAULT 0,
	"total_time_ms" integer DEFAULT 0,
	"top_scores" jsonb DEFAULT '[]'::jsonb,
	"retrieval_type" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "running_summaries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" varchar NOT NULL,
	"content" text DEFAULT '',
	"token_count" integer DEFAULT 0,
	"last_updated_at_turn" integer DEFAULT 0,
	"main_topics" text[] DEFAULT '{}',
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "running_summaries_state_id_unique" UNIQUE("state_id")
);
--> statement-breakpoint
CREATE TABLE "semantic_memory_chunks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"content" text NOT NULL,
	"type" varchar(50) NOT NULL,
	"source" varchar(100) DEFAULT 'explicit',
	"confidence" integer DEFAULT 80,
	"access_count" integer DEFAULT 0,
	"tags" text[] DEFAULT '{}',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"last_accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_catalog" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(140) NOT NULL,
	"owner_id" varchar,
	"name" varchar(160) NOT NULL,
	"description" text,
	"category" varchar(80) DEFAULT 'general' NOT NULL,
	"is_managed" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"latest_version" integer DEFAULT 1 NOT NULL,
	"active_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skill_catalog_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "skill_catalog_versions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_id" varchar NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"spec" jsonb NOT NULL,
	"input_schema" jsonb NOT NULL,
	"output_schema" jsonb NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"expected_latency_ms" integer DEFAULT 1500 NOT NULL,
	"expected_cost_cents" real DEFAULT 0 NOT NULL,
	"dependencies" jsonb DEFAULT '[]'::jsonb,
	"error_contract" jsonb DEFAULT '[]'::jsonb,
	"execution_policy" jsonb NOT NULL,
	"implementation_mode" text DEFAULT 'workflow' NOT NULL,
	"workflow" jsonb,
	"code" jsonb,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_from" text,
	"approved_by" varchar,
	"approved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "skill_execution_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" varchar,
	"run_id" varchar,
	"user_id" varchar,
	"catalog_id" varchar NOT NULL,
	"version_id" varchar NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"request_text" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"partial_output" jsonb,
	"policy" jsonb,
	"error" jsonb,
	"fallback_used" boolean DEFAULT false,
	"latency_ms" integer,
	"traces" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "telemetry_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" varchar(64) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"category" varchar(64) NOT NULL,
	"correlation_ids" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_ledger_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"workspace_id" text,
	"model_id" uuid,
	"model_name" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"calculated_input_cost" double precision DEFAULT 0 NOT NULL,
	"calculated_output_cost" double precision DEFAULT 0 NOT NULL,
	"total_calculated_cost" double precision DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"was_fallback" boolean DEFAULT false,
	"fallback_from_model" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"provider_email" text,
	"email_verified" boolean DEFAULT false,
	"metadata" jsonb,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "user_memories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"user_id" varchar NOT NULL,
	"conversation_id" varchar,
	"fact" text NOT NULL,
	"category" varchar(50) NOT NULL,
	"confidence" real DEFAULT 0.8 NOT NULL,
	"evidence" text NOT NULL,
	"scope" varchar(30) DEFAULT 'global' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" varchar,
	"content_hash" varchar(64) NOT NULL,
	"embedding" vector(1536),
	"salience_score" real DEFAULT 0.5,
	"recency_score" real DEFAULT 1,
	"access_count" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"expires_at" timestamp with time zone,
	"tags" text[] DEFAULT '{}',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_group_members" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_invitations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"invited_by_user_id" varchar,
	"role" text DEFAULT 'team_member' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_sent_at" timestamp,
	"accepted_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "workspace_roles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"logo_file_uuid" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "last_ip" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "user_agent" SET DATA TYPE varchar(512);--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "parent_message_id" varchar;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "branch_label" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "rag_sources" jsonb;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "share_id" varchar;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "folder_id" varchar;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "tags" text[];--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "rag_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "rag_collection_ids" text[];--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "keywords" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "gpts" ADD COLUMN "recommended_model" text;--> statement-breakpoint
ALTER TABLE "gpts" ADD COLUMN "runtime_policy" jsonb;--> statement-breakpoint
ALTER TABLE "gpts" ADD COLUMN "tool_permissions" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "amount_value" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "amount_value" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "stripe_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "stripe_charge_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_canonical" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_plan" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_status" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_period_end" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "openclaw_tokens_consumed" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "daily_requests_used" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "daily_requests_limit" integer DEFAULT 3;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "daily_requests_reset_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "daily_input_tokens_used" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "daily_output_tokens_used" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "daily_input_tokens_limit" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "daily_output_tokens_limit" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "daily_token_usage_reset_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "org_id" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "network_access_enabled" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "login_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_credit_grants" ADD CONSTRAINT "billing_credit_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD CONSTRAINT "channel_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD CONSTRAINT "channel_conversations_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_pairing_codes" ADD CONSTRAINT "channel_pairing_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_shares" ADD CONSTRAINT "chat_group_shares_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_shares" ADD CONSTRAINT "chat_group_shares_group_id_workspace_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."workspace_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_schedules" ADD CONSTRAINT "chat_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_schedules" ADD CONSTRAINT "chat_schedules_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodic_summaries" ADD CONSTRAINT "episodic_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpt_sessions" ADD CONSTRAINT "gpt_sessions_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpt_sessions" ADD CONSTRAINT "gpt_sessions_gpt_id_gpts_id_fk" FOREIGN KEY ("gpt_id") REFERENCES "public"."gpts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_source_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_target_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_facts" ADD CONSTRAINT "memory_facts_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_jobs" ADD CONSTRAINT "node_jobs_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_jobs" ADD CONSTRAINT "node_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_pairings" ADD CONSTRAINT "node_pairings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens_global" ADD CONSTRAINT "oauth_tokens_global_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens_user" ADD CONSTRAINT "oauth_tokens_user_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_engine_artifacts" ADD CONSTRAINT "office_engine_artifacts_run_id_office_engine_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."office_engine_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_engine_steps" ADD CONSTRAINT "office_engine_steps_run_id_office_engine_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."office_engine_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openclaw_instances" ADD CONSTRAINT "openclaw_instances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openclaw_token_ledger" ADD CONSTRAINT "openclaw_token_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_requests" ADD CONSTRAINT "processed_requests_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_analysis_results" ADD CONSTRAINT "prompt_analysis_results_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_integrity_checks" ADD CONSTRAINT "prompt_integrity_checks_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_transformation_log" ADD CONSTRAINT "prompt_transformation_log_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_chunks" ADD CONSTRAINT "rag_chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_kv_store" ADD CONSTRAINT "rag_kv_store_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_shell_targets" ADD CONSTRAINT "remote_shell_targets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_telemetry" ADD CONSTRAINT "retrieval_telemetry_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "running_summaries" ADD CONSTRAINT "running_summaries_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic_memory_chunks" ADD CONSTRAINT "semantic_memory_chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_catalog" ADD CONSTRAINT "skill_catalog_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_catalog_versions" ADD CONSTRAINT "skill_catalog_versions_catalog_id_skill_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."skill_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_catalog_versions" ADD CONSTRAINT "skill_catalog_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_catalog_versions" ADD CONSTRAINT "skill_catalog_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_execution_runs" ADD CONSTRAINT "skill_execution_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_execution_runs" ADD CONSTRAINT "skill_execution_runs_catalog_id_skill_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."skill_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_execution_runs" ADD CONSTRAINT "skill_execution_runs_version_id_skill_catalog_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."skill_catalog_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_ledger_usage" ADD CONSTRAINT "token_ledger_usage_model_id_pricing_catalog_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."pricing_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_group_members" ADD CONSTRAINT "workspace_group_members_group_id_workspace_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."workspace_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_group_members" ADD CONSTRAINT "workspace_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_groups" ADD CONSTRAINT "workspace_groups_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ad_impressions_ad" ON "ad_impressions" USING btree ("ad_id");--> statement-breakpoint
CREATE INDEX "idx_ad_impressions_session" ON "ad_impressions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "agent_mode_artifacts_run_idx" ON "agent_mode_artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_mode_artifacts_step_idx" ON "agent_mode_artifacts" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_provider_idx" ON "auth_tokens" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_unique_user_provider" ON "auth_tokens" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "billing_credit_grants_user_idx" ON "billing_credit_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "billing_credit_grants_expires_idx" ON "billing_credit_grants" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "billing_credit_grants_user_expires_idx" ON "billing_credit_grants" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_credit_grants_checkout_session_unique" ON "billing_credit_grants" USING btree ("stripe_checkout_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_conversations_unique" ON "channel_conversations" USING btree ("channel","channel_key","external_conversation_id");--> statement-breakpoint
CREATE INDEX "channel_conversations_user_idx" ON "channel_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "channel_conversations_chat_idx" ON "channel_conversations" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "channel_conversations_channel_idx" ON "channel_conversations" USING btree ("channel");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_pairing_codes_code_unique" ON "channel_pairing_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "channel_pairing_codes_user_idx" ON "channel_pairing_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "channel_pairing_codes_channel_idx" ON "channel_pairing_codes" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "channel_pairing_codes_expires_idx" ON "channel_pairing_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "chat_group_shares_chat_idx" ON "chat_group_shares" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_group_shares_group_idx" ON "chat_group_shares" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_group_shares_chat_group_unique" ON "chat_group_shares" USING btree ("chat_id","group_id");--> statement-breakpoint
CREATE INDEX "chat_schedules_user_idx" ON "chat_schedules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_schedules_chat_idx" ON "chat_schedules" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_schedules_active_next_idx" ON "chat_schedules" USING btree ("is_active","next_run_at");--> statement-breakpoint
CREATE INDEX "episodic_summaries_user_idx" ON "episodic_summaries" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "episodic_summaries_conv_idx" ON "episodic_summaries" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "episodic_summaries_embedding_idx" ON "episodic_summaries" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "episodic_summaries_created_idx" ON "episodic_summaries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "gpt_sessions_chat_idx" ON "gpt_sessions" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "gpt_sessions_gpt_idx" ON "gpt_sessions" USING btree ("gpt_id");--> statement-breakpoint
CREATE INDEX "idx_ilia_ads_active" ON "ilia_ads" USING btree ("active");--> statement-breakpoint
CREATE INDEX "idx_ilia_ads_category" ON "ilia_ads" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_ilia_ads_status" ON "ilia_ads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "knowledge_edges_user_idx" ON "knowledge_edges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "knowledge_edges_source_idx" ON "knowledge_edges" USING btree ("source_node_id");--> statement-breakpoint
CREATE INDEX "knowledge_edges_target_idx" ON "knowledge_edges" USING btree ("target_node_id");--> statement-breakpoint
CREATE INDEX "knowledge_edges_relation_idx" ON "knowledge_edges" USING btree ("relation_type");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_edges_unique" ON "knowledge_edges" USING btree ("user_id","source_node_id","target_node_id","relation_type");--> statement-breakpoint
CREATE INDEX "knowledge_nodes_user_idx" ON "knowledge_nodes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_nodes_user_zettel_idx" ON "knowledge_nodes" USING btree ("user_id","zettel_id");--> statement-breakpoint
CREATE INDEX "knowledge_nodes_type_idx" ON "knowledge_nodes" USING btree ("node_type");--> statement-breakpoint
CREATE INDEX "knowledge_nodes_source_idx" ON "knowledge_nodes" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "knowledge_nodes_created_idx" ON "knowledge_nodes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "knowledge_nodes_search_idx" ON "knowledge_nodes" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "knowledge_nodes_tags_idx" ON "knowledge_nodes" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "knowledge_nodes_embedding_idx" ON "knowledge_nodes" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_nodes_user_hash_idx" ON "knowledge_nodes" USING btree ("user_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_nodes_user_source_idx" ON "knowledge_nodes" USING btree ("user_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "magic_links_token_idx" ON "magic_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "magic_links_user_idx" ON "magic_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memory_facts_state_idx" ON "memory_facts" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "memory_facts_type_idx" ON "memory_facts" USING btree ("fact_type");--> statement-breakpoint
CREATE INDEX "node_jobs_org_idx" ON "node_jobs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "node_jobs_node_idx" ON "node_jobs" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "node_jobs_status_idx" ON "node_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "node_jobs_created_idx" ON "node_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "node_pairings_org_idx" ON "node_pairings" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "node_pairings_expires_idx" ON "node_pairings" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "node_pairings_code_unique" ON "node_pairings" USING btree ("code");--> statement-breakpoint
CREATE INDEX "nodes_org_idx" ON "nodes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "nodes_owner_idx" ON "nodes" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "nodes_last_seen_idx" ON "nodes" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "nodes_org_name_unique" ON "nodes" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "oauth_states_expires_idx" ON "oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_tokens_global_provider_unique" ON "oauth_tokens_global" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_tokens_user_unique_user_provider" ON "oauth_tokens_user" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "oauth_tokens_user_user_idx" ON "oauth_tokens_user" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "office_engine_artifacts_run_kind_idx" ON "office_engine_artifacts" USING btree ("run_id","kind");--> statement-breakpoint
CREATE INDEX "office_engine_artifacts_checksum_idx" ON "office_engine_artifacts" USING btree ("checksum_sha256");--> statement-breakpoint
CREATE INDEX "office_engine_runs_conv_idx" ON "office_engine_runs" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "office_engine_runs_status_idx" ON "office_engine_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "office_engine_runs_idempotency_idx" ON "office_engine_runs" USING btree ("input_checksum","objective_hash") WHERE status = 'succeeded';--> statement-breakpoint
CREATE INDEX "office_engine_steps_run_idx" ON "office_engine_steps" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "office_engine_steps_stage_idx" ON "office_engine_steps" USING btree ("run_id","stage");--> statement-breakpoint
CREATE INDEX "idx_openclaw_instances_user" ON "openclaw_instances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_openclaw_instances_status" ON "openclaw_instances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_openclaw_ledger_user" ON "openclaw_token_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_openclaw_ledger_instance" ON "openclaw_token_ledger" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "idx_openclaw_ledger_created" ON "openclaw_token_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "org_settings_network_idx" ON "org_settings" USING btree ("network_access_enabled");--> statement-breakpoint
CREATE INDEX "processed_requests_request_idx" ON "processed_requests" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "processed_requests_state_idx" ON "processed_requests" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "prompt_analysis_chat_idx" ON "prompt_analysis_results" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "prompt_analysis_created_idx" ON "prompt_analysis_results" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "prompt_analysis_request_idx" ON "prompt_analysis_results" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "prompt_analysis_spec_idx" ON "prompt_analysis_results" USING gin ("extracted_spec");--> statement-breakpoint
CREATE INDEX "prompt_integrity_chat_idx" ON "prompt_integrity_checks" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "prompt_integrity_created_idx" ON "prompt_integrity_checks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "prompt_integrity_valid_idx" ON "prompt_integrity_checks" USING btree ("valid");--> statement-breakpoint
CREATE INDEX "prompt_integrity_request_idx" ON "prompt_integrity_checks" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "prompt_transform_chat_idx" ON "prompt_transformation_log" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "prompt_transform_created_idx" ON "prompt_transformation_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "prompt_transform_stage_idx" ON "prompt_transformation_log" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "prompt_transform_request_idx" ON "prompt_transformation_log" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "rag_audit_tenant_user_idx" ON "rag_audit_log" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "rag_audit_action_idx" ON "rag_audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "rag_audit_resource_idx" ON "rag_audit_log" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "rag_audit_pii_idx" ON "rag_audit_log" USING btree ("pii_detected");--> statement-breakpoint
CREATE INDEX "rag_audit_created_idx" ON "rag_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "rag_chunks_tenant_user_idx" ON "rag_chunks" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "rag_chunks_conversation_idx" ON "rag_chunks" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "rag_chunks_source_idx" ON "rag_chunks" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "rag_chunks_search_idx" ON "rag_chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "rag_chunks_tags_idx" ON "rag_chunks" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "rag_chunks_acl_idx" ON "rag_chunks" USING gin ("acl_tags");--> statement-breakpoint
CREATE INDEX "rag_chunks_embedding_idx" ON "rag_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "rag_chunks_content_hash_idx" ON "rag_chunks" USING btree ("user_id","content_hash");--> statement-breakpoint
CREATE INDEX "rag_chunks_created_idx" ON "rag_chunks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "rag_chunks_active_idx" ON "rag_chunks" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "rag_eval_run_idx" ON "rag_eval_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "rag_eval_test_case_idx" ON "rag_eval_results" USING btree ("test_case_id");--> statement-breakpoint
CREATE INDEX "rag_eval_created_idx" ON "rag_eval_results" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rag_kv_tenant_user_ns_key_idx" ON "rag_kv_store" USING btree ("tenant_id","user_id","namespace","key");--> statement-breakpoint
CREATE INDEX "rag_kv_namespace_idx" ON "rag_kv_store" USING btree ("namespace");--> statement-breakpoint
CREATE INDEX "rag_kv_expires_idx" ON "rag_kv_store" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "remote_shell_targets_owner_idx" ON "remote_shell_targets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "remote_shell_targets_host_idx" ON "remote_shell_targets" USING btree ("host");--> statement-breakpoint
CREATE INDEX "remote_shell_targets_created_idx" ON "remote_shell_targets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "retrieval_telemetry_state_idx" ON "retrieval_telemetry" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "retrieval_telemetry_request_idx" ON "retrieval_telemetry" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "retrieval_telemetry_created_idx" ON "retrieval_telemetry" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "running_summaries_state_idx" ON "running_summaries" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "semantic_memory_user_idx" ON "semantic_memory_chunks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "semantic_memory_type_idx" ON "semantic_memory_chunks" USING btree ("type");--> statement-breakpoint
CREATE INDEX "semantic_memory_created_idx" ON "semantic_memory_chunks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "skill_catalog_owner_idx" ON "skill_catalog" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "skill_catalog_category_idx" ON "skill_catalog" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_catalog_slug_idx" ON "skill_catalog" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_catalog_versions_unique" ON "skill_catalog_versions" USING btree ("catalog_id","version");--> statement-breakpoint
CREATE INDEX "skill_catalog_versions_catalog_idx" ON "skill_catalog_versions" USING btree ("catalog_id");--> statement-breakpoint
CREATE INDEX "skill_catalog_versions_status_idx" ON "skill_catalog_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "skill_execution_runs_conversation_idx" ON "skill_execution_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "skill_execution_runs_run_idx" ON "skill_execution_runs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "skill_execution_runs_user_idx" ON "skill_execution_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "skill_execution_runs_status_idx" ON "skill_execution_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "telemetry_events_idempotency_idx" ON "telemetry_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "telemetry_events_category_idx" ON "telemetry_events" USING btree ("category");--> statement-breakpoint
CREATE INDEX "telemetry_events_created_idx" ON "telemetry_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "telemetry_events_correlation_trace_idx" ON "telemetry_events" USING btree (((correlation_ids->>'traceId')));--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_provider_subject_idx" ON "user_identities" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE INDEX "user_identities_user_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_identities_provider_idx" ON "user_identities" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "user_memories_tenant_user_idx" ON "user_memories" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "user_memories_category_idx" ON "user_memories" USING btree ("category");--> statement-breakpoint
CREATE INDEX "user_memories_scope_idx" ON "user_memories" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "user_memories_active_idx" ON "user_memories" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "user_memories_embedding_idx" ON "user_memories" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "user_memories_hash_idx" ON "user_memories" USING btree ("user_id","content_hash");--> statement-breakpoint
CREATE INDEX "user_memories_salience_idx" ON "user_memories" USING btree ("salience_score");--> statement-breakpoint
CREATE INDEX "user_memories_conversation_idx" ON "user_memories" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "workspace_group_members_group_idx" ON "workspace_group_members" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "workspace_group_members_user_idx" ON "workspace_group_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_group_members_group_user_unique" ON "workspace_group_members" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_groups_org_idx" ON "workspace_groups" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "workspace_groups_updated_idx" ON "workspace_groups" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_groups_org_name_unique" ON "workspace_groups" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "workspace_invitations_org_idx" ON "workspace_invitations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "workspace_invitations_email_idx" ON "workspace_invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "workspace_invitations_status_idx" ON "workspace_invitations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invitations_org_email_unique" ON "workspace_invitations" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "workspace_roles_org_idx" ON "workspace_roles" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "workspace_roles_updated_idx" ON "workspace_roles" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_roles_org_name_unique" ON "workspace_roles" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "workspaces_org_idx" ON "workspaces" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "workspaces_updated_idx" ON "workspaces" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "chat_messages_parent_idx" ON "chat_messages" USING btree ("parent_message_id");--> statement-breakpoint
CREATE INDEX "chats_share_id_idx" ON "chats" USING btree ("share_id");--> statement-breakpoint
CREATE INDEX "chats_folder_id_idx" ON "chats" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "users_org_id_idx" ON "users" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_plan_idx" ON "users" USING btree ("plan");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_stripe_customer_idx" ON "users" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "users_stripe_subscription_idx" ON "users" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "users_auth_provider_idx" ON "users" USING btree ("auth_provider");--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_share_id_unique" UNIQUE("share_id");