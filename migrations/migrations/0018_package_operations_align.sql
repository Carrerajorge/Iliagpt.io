ALTER TABLE public.package_operations

  ADD COLUMN IF NOT EXISTS confirmation_id text;


ALTER TABLE public.package_operations

  ADD COLUMN IF NOT EXISTS stdout text;


ALTER TABLE public.package_operations

  ADD COLUMN IF NOT EXISTS stderr text;


ALTER TABLE public.package_operations

  ADD COLUMN IF NOT EXISTS exit_code integer;


ALTER TABLE public.package_operations

  ADD COLUMN IF NOT EXISTS duration_ms integer;


ALTER TABLE public.package_operations

  ADD COLUMN IF NOT EXISTS rollback_command text;


-- policy_warnings should exist; ensure default

ALTER TABLE public.package_operations

  ALTER COLUMN policy_warnings SET DEFAULT '[]'::jsonb;


-- indexes/constraints

DO $$

BEGIN

  IF NOT EXISTS (

    SELECT 1 FROM pg_indexes

    WHERE schemaname='public' AND indexname='package_operations_confirmation_id_key'

  ) THEN

    CREATE UNIQUE INDEX package_operations_confirmation_id_key

      ON public.package_operations(confirmation_id);

  END IF;

END$$;


CREATE INDEX IF NOT EXISTS package_operations_status_idx ON public.package_operations(status);

CREATE INDEX IF NOT EXISTS package_operations_created_at_idx ON public.package_operations(created_at);

CREATE INDEX IF NOT EXISTS package_operations_requested_by_idx ON public.package_operations(requested_by);
