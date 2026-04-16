ALTER TABLE public.gpts

  ADD COLUMN IF NOT EXISTS definition jsonb;


ALTER TABLE public.gpts

  ADD COLUMN IF NOT EXISTS runtime_policy jsonb;


ALTER TABLE public.gpts

  ADD COLUMN IF NOT EXISTS tool_permissions jsonb;


ALTER TABLE public.gpts

  ADD COLUMN IF NOT EXISTS recommended_model text;


ALTER TABLE public.gpt_versions

  ADD COLUMN IF NOT EXISTS definition_snapshot jsonb;


ALTER TABLE public.gpt_actions

  ADD COLUMN IF NOT EXISTS open_api_spec jsonb;


ALTER TABLE public.gpt_actions

  ADD COLUMN IF NOT EXISTS operation_id text;


ALTER TABLE public.gpt_actions

  ADD COLUMN IF NOT EXISTS request_schema jsonb;


ALTER TABLE public.gpt_actions

  ADD COLUMN IF NOT EXISTS response_schema jsonb;


ALTER TABLE public.gpt_actions

  ADD COLUMN IF NOT EXISTS domain_allowlist jsonb;


ALTER TABLE public.gpt_actions

  ADD COLUMN IF NOT EXISTS pii_redaction_rules jsonb;
