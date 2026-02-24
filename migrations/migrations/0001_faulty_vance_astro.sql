CREATE TABLE "admin_audit_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" varchar NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" varchar,
	"details" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"parameters" jsonb,
	"status" text DEFAULT 'pending',
	"file_url" text,
	"file_size" integer,
	"generated_by" varchar NOT NULL,
	"scheduled_id" varchar,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agent_context" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" varchar NOT NULL,
	"context_window" jsonb DEFAULT '[]'::jsonb,
	"token_count" integer DEFAULT 0,
	"max_tokens" integer DEFAULT 128000,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_gap_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_prompt" text NOT NULL,
	"detected_intent" text,
	"gap_reason" text,
	"suggested_capability" text,
	"status" text DEFAULT 'pending',
	"reviewed_by" varchar,
	"gap_signature" varchar,
	"frequency_count" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_memories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace" varchar DEFAULT 'default' NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_memory_store" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar,
	"user_id" varchar,
	"memory_key" text NOT NULL,
	"memory_value" jsonb NOT NULL,
	"memory_type" text DEFAULT 'context',
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_mode_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"step_index" integer,
	"correlation_id" varchar NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"metadata" jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"input_hash" varchar,
	"output_ref" text,
	"duration_ms" integer,
	"error_code" text,
	"retry_count" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "agent_mode_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar NOT NULL,
	"message_id" varchar,
	"user_id" varchar,
	"status" text DEFAULT 'queued' NOT NULL,
	"plan" jsonb,
	"artifacts" jsonb,
	"summary" text,
	"error" text,
	"total_steps" integer DEFAULT 0,
	"completed_steps" integer DEFAULT 0,
	"current_step_index" integer DEFAULT 0,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"idempotency_key" varchar
);
--> statement-breakpoint
CREATE TABLE "agent_mode_steps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"step_index" integer NOT NULL,
	"tool_name" text NOT NULL,
	"tool_input" jsonb,
	"tool_output" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"retry_count" integer DEFAULT 0,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_session_state" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar NOT NULL,
	"key" varchar NOT NULL,
	"value" jsonb,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_workspaces" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"file_path" text NOT NULL,
	"file_type" text NOT NULL,
	"content" text,
	"storage_path" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_model_usage" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0,
	"completion_tokens" integer DEFAULT 0,
	"total_tokens" integer DEFAULT 0,
	"latency_ms" integer,
	"cost_estimate" text,
	"request_type" text,
	"success" text DEFAULT 'true',
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"session_id" varchar,
	"event_name" text NOT NULL,
	"event_data" jsonb,
	"page_url" text,
	"referrer" text,
	"device_type" text,
	"browser" text,
	"country" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"endpoint" text NOT NULL,
	"method" text NOT NULL,
	"status_code" integer,
	"latency_ms" integer,
	"tokens_in" integer,
	"tokens_out" integer,
	"model" text,
	"provider" text,
	"request_preview" text,
	"response_preview" text,
	"error_message" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_message_analysis" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar,
	"upload_id" varchar,
	"session_id" varchar,
	"status" text DEFAULT 'pending' NOT NULL,
	"scope" text DEFAULT 'all' NOT NULL,
	"sheets_to_analyze" text[],
	"started_at" timestamp,
	"completed_at" timestamp,
	"summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar NOT NULL,
	"client_request_id" varchar NOT NULL,
	"user_message_id" varchar,
	"assistant_message_id" varchar,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_seq" integer DEFAULT 0,
	"error" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "connector_usage_hourly" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector" text NOT NULL,
	"hour_bucket" timestamp NOT NULL,
	"total_calls" integer DEFAULT 0,
	"success_count" integer DEFAULT 0,
	"failure_count" integer DEFAULT 0,
	"total_latency_ms" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_artifacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" varchar NOT NULL,
	"message_id" varchar,
	"artifact_type" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_name" text,
	"file_size" integer,
	"checksum" varchar(64),
	"storage_url" text NOT NULL,
	"extracted_text" text,
	"metadata" jsonb,
	"processing_status" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_contexts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" varchar NOT NULL,
	"summary" text,
	"entities" jsonb DEFAULT '[]'::jsonb,
	"user_preferences" jsonb DEFAULT '{}'::jsonb,
	"topics" text[] DEFAULT '{}',
	"sentiment" text,
	"last_updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar NOT NULL,
	"message_id" varchar,
	"file_name" text NOT NULL,
	"storage_path" text,
	"mime_type" text NOT NULL,
	"file_size" integer,
	"extracted_text" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_images" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" varchar NOT NULL,
	"message_id" varchar,
	"parent_image_id" varchar,
	"prompt" text NOT NULL,
	"image_url" text NOT NULL,
	"thumbnail_url" text,
	"base64_preview" text,
	"model" text,
	"mode" text DEFAULT 'generate',
	"width" integer,
	"height" integer,
	"edit_history" jsonb DEFAULT '[]'::jsonb,
	"is_latest" text DEFAULT 'true',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" varchar NOT NULL,
	"chat_message_id" varchar,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"token_count" integer DEFAULT 0,
	"sequence" integer NOT NULL,
	"parent_message_id" varchar,
	"attachment_ids" text[] DEFAULT '{}',
	"image_ids" text[] DEFAULT '{}',
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_state_versions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" varchar NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_description" text,
	"author_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_states" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar NOT NULL,
	"user_id" varchar,
	"version" integer DEFAULT 1 NOT NULL,
	"total_tokens" integer DEFAULT 0,
	"message_count" integer DEFAULT 0,
	"artifact_count" integer DEFAULT 0,
	"image_count" integer DEFAULT 0,
	"last_message_id" varchar,
	"last_image_id" varchar,
	"is_active" text DEFAULT 'true',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_budgets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"budget_limit" text DEFAULT '100.00' NOT NULL,
	"alert_threshold" integer DEFAULT 80,
	"current_spend" text DEFAULT '0.00',
	"projected_monthly" text DEFAULT '0.00',
	"period_start" timestamp DEFAULT now() NOT NULL,
	"period_end" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cost_budgets_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "custom_skills" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"instructions" text,
	"category" varchar(50) DEFAULT 'custom' NOT NULL,
	"icon" varchar(50),
	"color" varchar(20),
	"enabled" boolean DEFAULT true,
	"is_public" boolean DEFAULT false,
	"version" integer DEFAULT 1,
	"parameters" jsonb DEFAULT '[]'::jsonb,
	"actions" jsonb DEFAULT '[]'::jsonb,
	"triggers" jsonb DEFAULT '[]'::jsonb,
	"output_format" varchar(50),
	"features" text[],
	"tags" text[],
	"usage_count" integer DEFAULT 0,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "excel_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" text NOT NULL,
	"name" text NOT NULL,
	"data" jsonb,
	"sheets" jsonb,
	"metadata" jsonb,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"size" integer DEFAULT 0,
	"is_template" boolean DEFAULT false,
	"template_category" text,
	"version" integer DEFAULT 1,
	CONSTRAINT "excel_documents_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "generated_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" varchar,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending',
	"parameters" jsonb,
	"result_summary" jsonb,
	"file_path" text,
	"format" text DEFAULT 'json',
	"generated_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "gpt_actions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gpt_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"action_type" text DEFAULT 'api' NOT NULL,
	"http_method" text DEFAULT 'GET',
	"endpoint" text NOT NULL,
	"headers" jsonb,
	"body_template" text,
	"response_mapping" jsonb,
	"auth_type" text DEFAULT 'none',
	"auth_config" jsonb,
	"parameters" jsonb,
	"rate_limit" integer DEFAULT 100,
	"timeout" integer DEFAULT 30000,
	"is_active" text DEFAULT 'true',
	"last_used_at" timestamp,
	"usage_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gpt_knowledge" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gpt_id" varchar NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"storage_url" text NOT NULL,
	"content_hash" text,
	"extracted_text" text,
	"embedding_status" text DEFAULT 'pending',
	"chunk_count" integer DEFAULT 0,
	"metadata" jsonb,
	"is_active" text DEFAULT 'true',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_blocklist" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip_address" text NOT NULL,
	"reason" text,
	"blocked_by" varchar NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ip_blocklist_ip_address_unique" UNIQUE("ip_address")
);
--> statement-breakpoint
CREATE TABLE "kpi_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"active_users_now" integer DEFAULT 0,
	"queries_per_minute" integer DEFAULT 0,
	"tokens_consumed_today" bigint DEFAULT 0,
	"revenue_today" text DEFAULT '0.00',
	"avg_latency_ms" integer DEFAULT 0,
	"error_rate_percentage" text DEFAULT '0.00',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_id" integer,
	"folder_id" integer,
	"collection_id" integer,
	"action" text NOT NULL,
	"user_id" varchar NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"cover_file_id" integer,
	"type" text DEFAULT 'album',
	"smart_rules" jsonb,
	"user_id" varchar NOT NULL,
	"is_public" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "library_collections_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "library_file_collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_id" integer NOT NULL,
	"collection_id" integer NOT NULL,
	"order" integer DEFAULT 0,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" text NOT NULL,
	"name" text NOT NULL,
	"original_name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"mime_type" text NOT NULL,
	"extension" text NOT NULL,
	"storage_path" text NOT NULL,
	"storage_url" text,
	"thumbnail_path" text,
	"thumbnail_url" text,
	"size" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"duration" integer,
	"pages" integer,
	"metadata" jsonb,
	"folder_id" integer,
	"tags" text[],
	"is_favorite" boolean DEFAULT false,
	"is_archived" boolean DEFAULT false,
	"is_pinned" boolean DEFAULT false,
	"user_id" varchar NOT NULL,
	"is_public" boolean DEFAULT false,
	"shared_with" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp,
	"deleted_at" timestamp,
	"version" integer DEFAULT 1,
	"parent_version_id" integer,
	CONSTRAINT "library_files_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "library_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#6366f1',
	"icon" text DEFAULT 'folder',
	"parent_id" integer,
	"path" text NOT NULL,
	"user_id" varchar NOT NULL,
	"is_system" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "library_folders_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "library_storage" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"total_bytes" bigint DEFAULT 0,
	"image_bytes" bigint DEFAULT 0,
	"video_bytes" bigint DEFAULT 0,
	"document_bytes" bigint DEFAULT 0,
	"other_bytes" bigint DEFAULT 0,
	"file_count" integer DEFAULT 0,
	"quota_bytes" bigint DEFAULT 5368709120,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "library_storage_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "offline_message_queue" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"temp_id" varchar NOT NULL,
	"user_id" varchar,
	"chat_id" varchar,
	"content" text NOT NULL,
	"status" text DEFAULT 'pending',
	"retry_count" integer DEFAULT 0,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"synced_at" timestamp,
	CONSTRAINT "offline_message_queue_temp_id_unique" UNIQUE("temp_id")
);
--> statement-breakpoint
CREATE TABLE "pare_idempotency_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"response_json" jsonb,
	"status" text DEFAULT 'processing' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp DEFAULT NOW() + INTERVAL '24 hours' NOT NULL,
	CONSTRAINT "pare_idempotency_keys_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "provider_metrics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"avg_latency" integer DEFAULT 0,
	"p50_latency" integer DEFAULT 0,
	"p95_latency" integer DEFAULT 0,
	"p99_latency" integer DEFAULT 0,
	"success_rate" text DEFAULT '100',
	"total_requests" integer DEFAULT 0,
	"error_count" integer DEFAULT 0,
	"tokens_in" integer DEFAULT 0,
	"tokens_out" integer DEFAULT 0,
	"total_cost" text DEFAULT '0.00',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"columns" jsonb NOT NULL,
	"filters" jsonb,
	"group_by" jsonb,
	"is_system" text DEFAULT 'false',
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_spec_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar,
	"run_id" varchar,
	"message_id" varchar,
	"intent" text NOT NULL,
	"intent_confidence" real,
	"deliverable_type" text,
	"primary_agent" text,
	"target_agents" text[],
	"attachments_count" integer DEFAULT 0,
	"execution_duration_ms" integer,
	"status" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "response_quality_metrics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar,
	"request_id" varchar NOT NULL,
	"provider" text NOT NULL,
	"score" integer NOT NULL,
	"issues" text[],
	"tokens_used" integer,
	"latency_ms" integer,
	"user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"parameters" jsonb,
	"schedule" text NOT NULL,
	"recipients" text[],
	"is_active" text DEFAULT 'true',
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"event_type" text NOT NULL,
	"severity" text DEFAULT 'info',
	"ip_address" text,
	"user_agent" text,
	"details" jsonb,
	"resolved" text DEFAULT 'false',
	"resolved_by" varchar,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_name" text NOT NULL,
	"policy_type" text NOT NULL,
	"rules" jsonb NOT NULL,
	"priority" integer DEFAULT 0,
	"is_enabled" text DEFAULT 'true',
	"applied_to" text DEFAULT 'global' NOT NULL,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "security_policies_policy_name_unique" UNIQUE("policy_name")
);
--> statement-breakpoint
CREATE TABLE "settings_config" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"value_type" text DEFAULT 'string',
	"default_value" jsonb,
	"description" text,
	"is_sensitive" text DEFAULT 'false',
	"updated_by" varchar,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "settings_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sidebar_pinned_gpts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"gpt_id" varchar NOT NULL,
	"display_order" integer DEFAULT 0,
	"pinned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spreadsheet_analysis_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar NOT NULL,
	"sheet_name" text NOT NULL,
	"status" text DEFAULT 'queued',
	"generated_code" text,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spreadsheet_analysis_outputs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar NOT NULL,
	"output_type" text NOT NULL,
	"title" text,
	"payload" jsonb NOT NULL,
	"order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spreadsheet_analysis_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"sheet_name" text NOT NULL,
	"mode" text DEFAULT 'full',
	"user_prompt" text,
	"generated_code" text,
	"code_hash" text,
	"status" text DEFAULT 'pending',
	"error_message" text,
	"execution_time_ms" integer,
	"started_at" timestamp,
	"completed_at" timestamp,
	"scope" text,
	"target_sheets" jsonb,
	"analysis_mode" text,
	"cross_sheet_summary" text,
	"total_jobs" integer,
	"completed_jobs" integer DEFAULT 0,
	"failed_jobs" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spreadsheet_sheets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" varchar NOT NULL,
	"name" text NOT NULL,
	"sheet_index" integer NOT NULL,
	"row_count" integer DEFAULT 0,
	"column_count" integer DEFAULT 0,
	"inferred_headers" jsonb,
	"column_types" jsonb,
	"preview_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spreadsheet_uploads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"checksum" text,
	"status" text DEFAULT 'pending',
	"error_message" text,
	"expires_at" timestamp,
	"file_type" text,
	"encoding" text,
	"page_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_invocations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"tool_call_id" varchar NOT NULL,
	"tool_name" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "model_type" text DEFAULT 'TEXT';--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "context_window" integer;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "max_output_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "input_cost_per_1k" text DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "output_cost_per_1k" text DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "last_sync_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "is_deprecated" text DEFAULT 'false';--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "release_date" text;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "is_enabled" text DEFAULT 'false';--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "enabled_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "enabled_by_admin_id" varchar;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "display_order" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "run_id" varchar;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "sequence" integer;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "pinned" text DEFAULT 'false';--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "pinned_at" timestamp;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "last_message_at" timestamp;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "message_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "tokens_used" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "ai_model_used" text;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "conversation_status" text DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "flag_status" text;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "ended_at" timestamp;--> statement-breakpoint
ALTER TABLE "tool_call_logs" ADD COLUMN "run_id" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "full_name" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tokens_consumed" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tokens_limit" integer DEFAULT 100000;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "credits_balance" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_ip" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "country_code" varchar(2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_provider" text DEFAULT 'email';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_2fa_enabled" text DEFAULT 'false';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" text DEFAULT 'false';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_code" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "internal_notes" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tags" text[];--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_reports" ADD CONSTRAINT "admin_reports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_store" ADD CONSTRAINT "agent_memory_store_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_store" ADD CONSTRAINT "agent_memory_store_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mode_events" ADD CONSTRAINT "agent_mode_events_run_id_agent_mode_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_mode_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mode_runs" ADD CONSTRAINT "agent_mode_runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mode_runs" ADD CONSTRAINT "agent_mode_runs_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mode_runs" ADD CONSTRAINT "agent_mode_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mode_steps" ADD CONSTRAINT "agent_mode_steps_run_id_agent_mode_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_mode_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_workspaces" ADD CONSTRAINT "agent_workspaces_run_id_agent_mode_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_mode_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_usage" ADD CONSTRAINT "ai_model_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_logs" ADD CONSTRAINT "api_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_analysis" ADD CONSTRAINT "chat_message_analysis_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_analysis" ADD CONSTRAINT "chat_message_analysis_upload_id_spreadsheet_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."spreadsheet_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_analysis" ADD CONSTRAINT "chat_message_analysis_session_id_spreadsheet_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."spreadsheet_analysis_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_runs" ADD CONSTRAINT "chat_runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_artifacts" ADD CONSTRAINT "conversation_artifacts_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_artifacts" ADD CONSTRAINT "conversation_artifacts_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_contexts" ADD CONSTRAINT "conversation_contexts_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_documents" ADD CONSTRAINT "conversation_documents_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_documents" ADD CONSTRAINT "conversation_documents_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_images" ADD CONSTRAINT "conversation_images_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_images" ADD CONSTRAINT "conversation_images_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_chat_message_id_chat_messages_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_state_versions" ADD CONSTRAINT "conversation_state_versions_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_states" ADD CONSTRAINT "conversation_states_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_states" ADD CONSTRAINT "conversation_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_skills" ADD CONSTRAINT "custom_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpt_actions" ADD CONSTRAINT "gpt_actions_gpt_id_gpts_id_fk" FOREIGN KEY ("gpt_id") REFERENCES "public"."gpts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpt_knowledge" ADD CONSTRAINT "gpt_knowledge_gpt_id_gpts_id_fk" FOREIGN KEY ("gpt_id") REFERENCES "public"."gpts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ip_blocklist" ADD CONSTRAINT "ip_blocklist_blocked_by_users_id_fk" FOREIGN KEY ("blocked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_message_queue" ADD CONSTRAINT "offline_message_queue_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_spec_history" ADD CONSTRAINT "request_spec_history_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_spec_history" ADD CONSTRAINT "request_spec_history_run_id_agent_mode_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_mode_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_spec_history" ADD CONSTRAINT "request_spec_history_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sidebar_pinned_gpts" ADD CONSTRAINT "sidebar_pinned_gpts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sidebar_pinned_gpts" ADD CONSTRAINT "sidebar_pinned_gpts_gpt_id_gpts_id_fk" FOREIGN KEY ("gpt_id") REFERENCES "public"."gpts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spreadsheet_analysis_jobs" ADD CONSTRAINT "spreadsheet_analysis_jobs_session_id_spreadsheet_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."spreadsheet_analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spreadsheet_analysis_outputs" ADD CONSTRAINT "spreadsheet_analysis_outputs_session_id_spreadsheet_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."spreadsheet_analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spreadsheet_analysis_sessions" ADD CONSTRAINT "spreadsheet_analysis_sessions_upload_id_spreadsheet_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."spreadsheet_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spreadsheet_sheets" ADD CONSTRAINT "spreadsheet_sheets_upload_id_spreadsheet_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."spreadsheet_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_run_id_chat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."chat_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_logs_admin_idx" ON "admin_audit_logs" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_action_idx" ON "admin_audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_created_idx" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_reports_type_idx" ON "admin_reports" USING btree ("type");--> statement-breakpoint
CREATE INDEX "admin_reports_status_idx" ON "admin_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "admin_reports_generated_by_idx" ON "admin_reports" USING btree ("generated_by");--> statement-breakpoint
CREATE INDEX "agent_context_thread_id_idx" ON "agent_context" USING btree ("thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_context_thread_unique" ON "agent_context" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "agent_gap_logs_status_idx" ON "agent_gap_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_gap_logs_created_idx" ON "agent_gap_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_gap_logs_signature_idx" ON "agent_gap_logs" USING btree ("gap_signature");--> statement-breakpoint
CREATE INDEX "agent_memories_namespace_idx" ON "agent_memories" USING btree ("namespace");--> statement-breakpoint
CREATE INDEX "agent_memories_created_at_idx" ON "agent_memories" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_memory_store_chat_key_idx" ON "agent_memory_store" USING btree ("chat_id","memory_key");--> statement-breakpoint
CREATE INDEX "agent_memory_store_user_idx" ON "agent_memory_store" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_memory_store_type_idx" ON "agent_memory_store" USING btree ("memory_type");--> statement-breakpoint
CREATE INDEX "agent_mode_events_run_idx" ON "agent_mode_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_mode_events_correlation_idx" ON "agent_mode_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "agent_mode_events_type_idx" ON "agent_mode_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "agent_mode_events_timestamp_idx" ON "agent_mode_events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "agent_mode_runs_chat_idx" ON "agent_mode_runs" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "agent_mode_runs_message_idx" ON "agent_mode_runs" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "agent_mode_runs_status_idx" ON "agent_mode_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_mode_runs_created_idx" ON "agent_mode_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_mode_runs_idempotency_idx" ON "agent_mode_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_mode_steps_run_idx" ON "agent_mode_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_mode_steps_status_idx" ON "agent_mode_steps" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_session_state_session_idx" ON "agent_session_state" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_state_unique" ON "agent_session_state" USING btree ("session_id","key");--> statement-breakpoint
CREATE INDEX "agent_workspaces_run_idx" ON "agent_workspaces" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_workspaces_path_idx" ON "agent_workspaces" USING btree ("run_id","file_path");--> statement-breakpoint
CREATE INDEX "ai_model_usage_user_idx" ON "ai_model_usage" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_model_usage_provider_idx" ON "ai_model_usage" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "ai_model_usage_created_idx" ON "ai_model_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_user_idx" ON "analytics_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "analytics_events_event_idx" ON "analytics_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "analytics_events_created_idx" ON "analytics_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_user_created_idx" ON "analytics_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "api_logs_user_idx" ON "api_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_logs_endpoint_idx" ON "api_logs" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "api_logs_created_idx" ON "api_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "api_logs_status_idx" ON "api_logs" USING btree ("status_code");--> statement-breakpoint
CREATE INDEX "api_logs_provider_idx" ON "api_logs" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "api_logs_user_created_idx" ON "api_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_message_analysis_message_idx" ON "chat_message_analysis" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "chat_message_analysis_upload_idx" ON "chat_message_analysis" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "chat_message_analysis_session_idx" ON "chat_message_analysis" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "chat_runs_chat_idx" ON "chat_runs" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_runs_status_idx" ON "chat_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_runs_client_request_unique" ON "chat_runs" USING btree ("chat_id","client_request_id");--> statement-breakpoint
CREATE INDEX "chat_runs_chat_created_idx" ON "chat_runs" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_usage_hourly_connector_bucket_idx" ON "connector_usage_hourly" USING btree ("connector","hour_bucket");--> statement-breakpoint
CREATE INDEX "connector_usage_hourly_connector_created_idx" ON "connector_usage_hourly" USING btree ("connector","created_at");--> statement-breakpoint
CREATE INDEX "conversation_artifacts_state_idx" ON "conversation_artifacts" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "conversation_artifacts_message_idx" ON "conversation_artifacts" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "conversation_artifacts_type_idx" ON "conversation_artifacts" USING btree ("artifact_type");--> statement-breakpoint
CREATE INDEX "conversation_artifacts_checksum_idx" ON "conversation_artifacts" USING btree ("checksum");--> statement-breakpoint
CREATE INDEX "conversation_contexts_state_idx" ON "conversation_contexts" USING btree ("state_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_contexts_state_unique" ON "conversation_contexts" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "conversation_documents_chat_idx" ON "conversation_documents" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "conversation_documents_created_idx" ON "conversation_documents" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_images_state_idx" ON "conversation_images" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "conversation_images_message_idx" ON "conversation_images" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "conversation_images_parent_idx" ON "conversation_images" USING btree ("parent_image_id");--> statement-breakpoint
CREATE INDEX "conversation_images_latest_idx" ON "conversation_images" USING btree ("state_id","is_latest");--> statement-breakpoint
CREATE INDEX "conversation_messages_state_idx" ON "conversation_messages" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "conversation_messages_sequence_idx" ON "conversation_messages" USING btree ("state_id","sequence");--> statement-breakpoint
CREATE INDEX "conversation_messages_created_idx" ON "conversation_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "conversation_versions_state_idx" ON "conversation_state_versions" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "conversation_versions_version_idx" ON "conversation_state_versions" USING btree ("state_id","version");--> statement-breakpoint
CREATE INDEX "conversation_states_chat_idx" ON "conversation_states" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "conversation_states_user_idx" ON "conversation_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversation_states_version_idx" ON "conversation_states" USING btree ("chat_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_states_chat_unique" ON "conversation_states" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "cost_budgets_provider_idx" ON "cost_budgets" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "custom_skills_user_id_idx" ON "custom_skills" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "custom_skills_category_idx" ON "custom_skills" USING btree ("category");--> statement-breakpoint
CREATE INDEX "custom_skills_enabled_idx" ON "custom_skills" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "excel_documents_uuid_idx" ON "excel_documents" USING btree ("uuid");--> statement-breakpoint
CREATE INDEX "excel_documents_created_idx" ON "excel_documents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "generated_reports_status_idx" ON "generated_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "generated_reports_created_idx" ON "generated_reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "gpt_actions_gpt_idx" ON "gpt_actions" USING btree ("gpt_id");--> statement-breakpoint
CREATE INDEX "gpt_actions_type_idx" ON "gpt_actions" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "gpt_knowledge_gpt_idx" ON "gpt_knowledge" USING btree ("gpt_id");--> statement-breakpoint
CREATE INDEX "gpt_knowledge_status_idx" ON "gpt_knowledge" USING btree ("embedding_status");--> statement-breakpoint
CREATE INDEX "ip_blocklist_ip_idx" ON "ip_blocklist" USING btree ("ip_address");--> statement-breakpoint
CREATE INDEX "ip_blocklist_expires_idx" ON "ip_blocklist" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "kpi_snapshots_created_idx" ON "kpi_snapshots" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "library_activity_user_idx" ON "library_activity" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "library_activity_file_idx" ON "library_activity" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "library_activity_created_idx" ON "library_activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "library_collections_user_idx" ON "library_collections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "library_file_collections_file_idx" ON "library_file_collections" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "library_file_collections_collection_idx" ON "library_file_collections" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "library_files_user_idx" ON "library_files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "library_files_type_idx" ON "library_files" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "library_files_folder_idx" ON "library_files" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "library_files_created_idx" ON "library_files" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "library_folders_user_idx" ON "library_folders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "library_folders_parent_idx" ON "library_folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "library_storage_user_idx" ON "library_storage" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "offline_message_queue_status_created_idx" ON "offline_message_queue" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "offline_message_queue_user_status_idx" ON "offline_message_queue" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "pare_idempotency_key_idx" ON "pare_idempotency_keys" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "pare_idempotency_expires_idx" ON "pare_idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "provider_metrics_provider_idx" ON "provider_metrics" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "provider_metrics_window_idx" ON "provider_metrics" USING btree ("window_start","window_end");--> statement-breakpoint
CREATE INDEX "report_templates_type_idx" ON "report_templates" USING btree ("type");--> statement-breakpoint
CREATE INDEX "request_spec_history_chat_created_idx" ON "request_spec_history" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "request_spec_history_run_idx" ON "request_spec_history" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "request_spec_history_intent_idx" ON "request_spec_history" USING btree ("intent");--> statement-breakpoint
CREATE INDEX "response_quality_metrics_created_idx" ON "response_quality_metrics" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "response_quality_metrics_provider_created_idx" ON "response_quality_metrics" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "response_quality_metrics_user_created_idx" ON "response_quality_metrics" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "scheduled_reports_active_next_idx" ON "scheduled_reports" USING btree ("is_active","next_run_at");--> statement-breakpoint
CREATE INDEX "security_events_user_idx" ON "security_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "security_events_type_idx" ON "security_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "security_events_severity_idx" ON "security_events" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "security_events_created_idx" ON "security_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "security_policies_type_idx" ON "security_policies" USING btree ("policy_type");--> statement-breakpoint
CREATE INDEX "security_policies_enabled_idx" ON "security_policies" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "security_policies_applied_idx" ON "security_policies" USING btree ("applied_to");--> statement-breakpoint
CREATE INDEX "settings_category_idx" ON "settings_config" USING btree ("category");--> statement-breakpoint
CREATE INDEX "sidebar_pinned_gpts_user_idx" ON "sidebar_pinned_gpts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sidebar_pinned_gpts_gpt_idx" ON "sidebar_pinned_gpts" USING btree ("gpt_id");--> statement-breakpoint
CREATE INDEX "spreadsheet_analysis_jobs_session_idx" ON "spreadsheet_analysis_jobs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "spreadsheet_analysis_jobs_status_idx" ON "spreadsheet_analysis_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "spreadsheet_outputs_session_idx" ON "spreadsheet_analysis_outputs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "spreadsheet_analysis_user_idx" ON "spreadsheet_analysis_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "spreadsheet_analysis_upload_idx" ON "spreadsheet_analysis_sessions" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "spreadsheet_analysis_status_idx" ON "spreadsheet_analysis_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "spreadsheet_sheets_upload_idx" ON "spreadsheet_sheets" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "spreadsheet_uploads_user_idx" ON "spreadsheet_uploads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "spreadsheet_uploads_status_idx" ON "spreadsheet_uploads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tool_invocations_run_idx" ON "tool_invocations" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_invocations_unique" ON "tool_invocations" USING btree ("run_id","tool_call_id");--> statement-breakpoint
CREATE INDEX "tool_invocations_run_created_idx" ON "tool_invocations" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_conversation_started_idx" ON "agent_runs" USING btree ("conversation_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_steps_run_step_idx" ON "agent_steps" USING btree ("run_id","step_index");--> statement-breakpoint
CREATE INDEX "ai_models_provider_idx" ON "ai_models" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "ai_models_model_type_idx" ON "ai_models" USING btree ("model_type");--> statement-breakpoint
CREATE INDEX "ai_models_status_idx" ON "ai_models" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_models_is_enabled_idx" ON "ai_models" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "chat_messages_chat_created_idx" ON "chat_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_created_at_idx" ON "chat_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "chats_status_idx" ON "chats" USING btree ("conversation_status");--> statement-breakpoint
CREATE INDEX "chats_flag_idx" ON "chats" USING btree ("flag_status");--> statement-breakpoint
CREATE INDEX "chats_user_updated_idx" ON "chats" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "chats_user_archived_deleted_idx" ON "chats" USING btree ("user_id","archived","deleted_at");--> statement-breakpoint
CREATE INDEX "chats_updated_at_idx" ON "chats" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "files_user_created_idx" ON "files" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "files_user_id_idx" ON "files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "files_status_idx" ON "files" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tool_call_logs_run_created_idx" ON "tool_call_logs" USING btree ("run_id","created_at");