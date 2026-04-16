CREATE TABLE "agent_assets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"step_id" varchar,
	"asset_type" text NOT NULL,
	"storage_path" text,
	"content" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" varchar,
	"status" text DEFAULT 'pending' NOT NULL,
	"router_decision" text,
	"objective" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "agent_steps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"step_type" text NOT NULL,
	"url" text,
	"detail" jsonb,
	"screenshot" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"success" text DEFAULT 'pending',
	"error" text,
	"step_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_models" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"status" text DEFAULT 'active',
	"cost_per_1k" text DEFAULT '0.00',
	"usage_percent" integer DEFAULT 0,
	"description" text,
	"capabilities" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" timestamp NOT NULL,
	"total_users" integer DEFAULT 0,
	"active_users" integer DEFAULT 0,
	"total_queries" integer DEFAULT 0,
	"revenue" text DEFAULT '0',
	"new_signups" integer DEFAULT 0,
	"churned_users" integer DEFAULT 0,
	"avg_response_time" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"action" text NOT NULL,
	"resource" text,
	"resource_id" varchar,
	"details" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cached_pages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url_hash" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"content" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	CONSTRAINT "cached_pages_url_hash_unique" UNIQUE("url_hash")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'done',
	"request_id" varchar,
	"user_message_id" varchar,
	"attachments" jsonb,
	"sources" jsonb,
	"figma_diagram" jsonb,
	"google_form_preview" jsonb,
	"gmail_preview" jsonb,
	"generated_image" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_participants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"invited_by" varchar,
	"invited_at" timestamp DEFAULT now() NOT NULL,
	"accepted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "chat_shares" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar NOT NULL,
	"recipient_user_id" varchar,
	"email" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"invited_by" varchar,
	"notification_sent" text DEFAULT 'false',
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"title" text DEFAULT 'New Chat' NOT NULL,
	"gpt_id" varchar,
	"archived" text DEFAULT 'false',
	"hidden" text DEFAULT 'false',
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_interpreter_artifacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"data" text,
	"mime_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_interpreter_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" varchar,
	"user_id" varchar,
	"code" text NOT NULL,
	"language" text DEFAULT 'python' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stdout" text,
	"stderr" text,
	"execution_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_knowledge" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"category" text DEFAULT 'general',
	"is_active" text DEFAULT 'true',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"consent_type" text NOT NULL,
	"value" text NOT NULL,
	"consent_version" text DEFAULT '1.0',
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"allow_navigation" text DEFAULT 'true' NOT NULL,
	"cookie_policy" text DEFAULT 'accept',
	"rate_limit" integer DEFAULT 10,
	"custom_headers" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "domain_policies_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "file_chunks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" varchar NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"page_number" integer,
	"chunk_index" integer NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "file_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" varchar NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retries" integer DEFAULT 0,
	"last_error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_path" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"processing_progress" integer DEFAULT 0,
	"processing_error" text,
	"completed_at" timestamp,
	"total_chunks" integer,
	"uploaded_chunks" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmail_oauth_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"account_email" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gpt_categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"icon" text,
	"sort_order" integer DEFAULT 0,
	CONSTRAINT "gpt_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "gpt_versions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gpt_id" varchar NOT NULL,
	"version_number" integer NOT NULL,
	"system_prompt" text NOT NULL,
	"temperature" text DEFAULT '0.7',
	"top_p" text DEFAULT '1',
	"max_tokens" integer DEFAULT 4096,
	"change_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar
);
--> statement-breakpoint
CREATE TABLE "gpts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"avatar" text,
	"category_id" varchar,
	"creator_id" varchar,
	"visibility" text DEFAULT 'private',
	"system_prompt" text NOT NULL,
	"temperature" text DEFAULT '0.7',
	"top_p" text DEFAULT '1',
	"max_tokens" integer DEFAULT 4096,
	"welcome_message" text,
	"capabilities" jsonb,
	"conversation_starters" jsonb,
	"usage_count" integer DEFAULT 0,
	"version" integer DEFAULT 1,
	"is_published" text DEFAULT 'false',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gpts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "integration_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"provider_id" varchar NOT NULL,
	"external_user_id" text,
	"display_name" text,
	"email" text,
	"avatar_url" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"scopes" text,
	"is_default" text DEFAULT 'false',
	"status" text DEFAULT 'active',
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"enabled_apps" jsonb DEFAULT '[]'::jsonb,
	"enabled_tools" jsonb DEFAULT '[]'::jsonb,
	"disabled_tools" jsonb DEFAULT '[]'::jsonb,
	"resource_scopes" jsonb,
	"auto_confirm_policy" text DEFAULT 'ask',
	"sandbox_mode" text DEFAULT 'false',
	"max_parallel_calls" integer DEFAULT 3,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "integration_policies_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "integration_providers" (
	"id" varchar PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon_url" text,
	"auth_type" text DEFAULT 'oauth2' NOT NULL,
	"auth_config" jsonb,
	"category" text DEFAULT 'general',
	"is_active" text DEFAULT 'true',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_tools" (
	"id" varchar PRIMARY KEY NOT NULL,
	"provider_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"action_schema" jsonb,
	"result_schema" jsonb,
	"required_scopes" text[],
	"data_access_level" text DEFAULT 'read',
	"rate_limit" jsonb,
	"confirmation_required" text DEFAULT 'false',
	"is_active" text DEFAULT 'true',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"payment_id" varchar,
	"invoice_number" text NOT NULL,
	"amount" text NOT NULL,
	"currency" text DEFAULT 'EUR',
	"status" text DEFAULT 'pending',
	"due_date" timestamp,
	"paid_at" timestamp,
	"pdf_path" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"media_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"storage_path" text NOT NULL,
	"thumbnail_path" text,
	"mime_type" text,
	"size" integer,
	"metadata" jsonb,
	"source_chat_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_event_types" (
	"id" varchar PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"severity" text DEFAULT 'normal',
	"default_opt_in" text DEFAULT 'true',
	"default_channels" text DEFAULT 'push',
	"frequency_cap" integer,
	"icon" text,
	"sort_order" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"event_type_id" varchar NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_response" jsonb,
	"error_message" text,
	"retry_count" integer DEFAULT 0,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"event_type_id" varchar NOT NULL,
	"channels" text DEFAULT 'push' NOT NULL,
	"enabled" text DEFAULT 'true',
	"quiet_hours_start" text,
	"quiet_hours_end" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"amount" text NOT NULL,
	"currency" text DEFAULT 'EUR',
	"status" text DEFAULT 'pending',
	"method" text,
	"description" text,
	"stripe_payment_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"description" text,
	"category" text DEFAULT 'general',
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending',
	"parameters" jsonb,
	"file_path" text,
	"generated_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_links" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" varchar NOT NULL,
	"token" varchar NOT NULL,
	"scope" text DEFAULT 'link_only',
	"permissions" text DEFAULT 'read',
	"expires_at" timestamp,
	"last_accessed_at" timestamp,
	"access_count" integer DEFAULT 0,
	"is_revoked" text DEFAULT 'false',
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shared_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "tool_call_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"chat_id" varchar,
	"tool_id" varchar NOT NULL,
	"provider_id" varchar NOT NULL,
	"account_id" varchar,
	"input_redacted" jsonb,
	"output_redacted" jsonb,
	"status" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"latency_ms" integer,
	"idempotency_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"response_preferences" jsonb,
	"user_profile" jsonb,
	"feature_flags" jsonb,
	"privacy_settings" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text,
	"password" text,
	"email" text,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"phone" varchar,
	"company" varchar,
	"role" text DEFAULT 'user',
	"plan" text DEFAULT 'free',
	"status" text DEFAULT 'active',
	"query_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_assets" ADD CONSTRAINT "agent_assets_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_assets" ADD CONSTRAINT "agent_assets_step_id_agent_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."agent_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_shares" ADD CONSTRAINT "chat_shares_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_interpreter_artifacts" ADD CONSTRAINT "code_interpreter_artifacts_run_id_code_interpreter_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."code_interpreter_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_knowledge" ADD CONSTRAINT "company_knowledge_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_logs" ADD CONSTRAINT "consent_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_jobs" ADD CONSTRAINT "file_jobs_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_oauth_tokens" ADD CONSTRAINT "gmail_oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpt_versions" ADD CONSTRAINT "gpt_versions_gpt_id_gpts_id_fk" FOREIGN KEY ("gpt_id") REFERENCES "public"."gpts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpts" ADD CONSTRAINT "gpts_category_id_gpt_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."gpt_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_provider_id_integration_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."integration_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_policies" ADD CONSTRAINT "integration_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_tools" ADD CONSTRAINT "integration_tools_provider_id_integration_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."integration_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_event_type_id_notification_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."notification_event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_logs" ADD CONSTRAINT "tool_call_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_logs" ADD CONSTRAINT "tool_call_logs_account_id_integration_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."integration_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_assets_run_idx" ON "agent_assets" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_runs_conversation_idx" ON "agent_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "agent_runs_status_idx" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_steps_run_idx" ON "agent_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "cached_pages_url_hash_idx" ON "cached_pages" USING btree ("url_hash");--> statement-breakpoint
CREATE INDEX "chat_messages_chat_idx" ON "chat_messages" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_messages_request_idx" ON "chat_messages" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "chat_messages_status_idx" ON "chat_messages" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_request_unique" ON "chat_messages" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "chat_participants_chat_idx" ON "chat_participants" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_participants_email_idx" ON "chat_participants" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_participants_unique_idx" ON "chat_participants" USING btree ("chat_id","email");--> statement-breakpoint
CREATE INDEX "chat_shares_chat_idx" ON "chat_shares" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_shares_email_idx" ON "chat_shares" USING btree ("email");--> statement-breakpoint
CREATE INDEX "chat_shares_recipient_idx" ON "chat_shares" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "chats_user_idx" ON "chats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "code_artifacts_run_idx" ON "code_interpreter_artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "code_runs_conversation_idx" ON "code_interpreter_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "code_runs_user_idx" ON "code_interpreter_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "company_knowledge_user_idx" ON "company_knowledge" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "company_knowledge_category_idx" ON "company_knowledge" USING btree ("category");--> statement-breakpoint
CREATE INDEX "consent_logs_user_idx" ON "consent_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "file_chunks_file_id_idx" ON "file_chunks" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "file_jobs_file_id_idx" ON "file_jobs" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "file_jobs_status_idx" ON "file_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "gmail_oauth_user_idx" ON "gmail_oauth_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_oauth_user_email_idx" ON "gmail_oauth_tokens" USING btree ("user_id","account_email");--> statement-breakpoint
CREATE INDEX "gpt_versions_gpt_idx" ON "gpt_versions" USING btree ("gpt_id");--> statement-breakpoint
CREATE INDEX "gpts_category_idx" ON "gpts" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "gpts_creator_idx" ON "gpts" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "gpts_visibility_idx" ON "gpts" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "integration_accounts_user_id_idx" ON "integration_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "integration_accounts_provider_idx" ON "integration_accounts" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "integration_policies_user_id_idx" ON "integration_policies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invoices_user_idx" ON "invoices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "library_items_user_idx" ON "library_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "library_items_type_idx" ON "library_items" USING btree ("user_id","media_type");--> statement-breakpoint
CREATE INDEX "notification_logs_user_idx" ON "notification_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_logs_event_idx" ON "notification_logs" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_logs_idempotency_idx" ON "notification_logs" USING btree ("event_id","channel");--> statement-breakpoint
CREATE INDEX "notification_prefs_user_idx" ON "notification_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_unique_idx" ON "notification_preferences" USING btree ("user_id","event_type_id");--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "shared_links_user_idx" ON "shared_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shared_links_token_idx" ON "shared_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "shared_links_resource_idx" ON "shared_links" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "tool_call_logs_user_id_idx" ON "tool_call_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tool_call_logs_tool_id_idx" ON "tool_call_logs" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "tool_call_logs_created_at_idx" ON "tool_call_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "user_settings_user_id_idx" ON "user_settings" USING btree ("user_id");