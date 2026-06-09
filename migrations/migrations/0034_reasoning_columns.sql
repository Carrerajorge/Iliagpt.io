-- Extended thinking (Claude-style reasoning streaming)
-- `reasoning`          → the thinking text streamed before the visible answer
-- `reasoning_details`  → raw OpenRouter reasoning_details array (signed thinking
--                        blocks that must be re-sent verbatim in later turns for
--                        Anthropic models with tool calls)
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "reasoning" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "reasoning_details" jsonb;
