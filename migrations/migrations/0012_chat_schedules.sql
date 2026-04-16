CREATE TABLE IF NOT EXISTS "chat_schedules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" varchar NOT NULL,
	"chat_id" varchar NOT NULL,
	"name" text NOT NULL DEFAULT 'Programación',
	"prompt" text NOT NULL,
	"schedule_type" text NOT NULL,
	"time_zone" text NOT NULL DEFAULT 'UTC',
	"run_at" timestamp,
	"time_of_day" text,
	"days_of_week" integer[],
	"is_active" boolean NOT NULL DEFAULT true,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"locked_at" timestamp,
	"locked_by" text,
	"failure_count" integer NOT NULL DEFAULT 0,
	"last_error" text,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now()
);

DO $$ BEGIN
 ALTER TABLE "chat_schedules" ADD CONSTRAINT "chat_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "chat_schedules" ADD CONSTRAINT "chat_schedules_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "chat_schedules_user_idx" ON "chat_schedules" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "chat_schedules_chat_idx" ON "chat_schedules" USING btree ("chat_id");
CREATE INDEX IF NOT EXISTS "chat_schedules_active_next_idx" ON "chat_schedules" USING btree ("is_active","next_run_at");

