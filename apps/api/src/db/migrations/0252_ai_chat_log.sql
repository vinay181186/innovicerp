-- ADR-293 — AI Chat log. The super-admin AI chat reads live ERP data through
-- the ERP's own read services (read-only transactions) and never writes ERP
-- data; this table is the ONLY row the feature writes — one per question.
--
-- ai_chat_log — one row per question asked, whatever the outcome:
--   model_choice   what the person picked in the Model box (auto/claude/gemini)
--   provider_used  who actually answered (null when nobody was called)
--   tools_used     [{ name, args, rows }] per tool call
--   files          [{ name, type, bytes }] — NEVER the file content
--   outcome        pending (reserved while the AI answers) | ok | refused | no_credit | limit | error
-- Written only by modules/ai-chat/service.ts. The daily limit counts these rows.
--
-- Additive and idempotent. RLS: admin of the same company only (read + insert).
-- Not in the realtime publication.
--
-- ROLLBACK (only before any code reads it):
--   DROP TABLE public.ai_chat_log;

CREATE TABLE IF NOT EXISTS public.ai_chat_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  asked_at timestamptz NOT NULL DEFAULT now(),
  question text NOT NULL,
  model_choice text NOT NULL,
  provider_used text,
  model text,
  tools_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer text,
  outcome text NOT NULL,
  error text,
  input_tokens integer,
  output_tokens integer,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  CONSTRAINT ai_chat_log_model_choice_check
    CHECK (model_choice IN ('auto', 'claude', 'gemini')),
  CONSTRAINT ai_chat_log_provider_used_check
    CHECK (provider_used IS NULL OR provider_used IN ('claude', 'gemini')),
  CONSTRAINT ai_chat_log_outcome_check
    CHECK (outcome IN ('pending', 'ok', 'refused', 'no_credit', 'limit', 'error'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_chat_log_company_user_asked_idx
  ON public.ai_chat_log (company_id, user_id, asked_at DESC);
--> statement-breakpoint
ALTER TABLE public.ai_chat_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY ai_chat_log_admin_read ON public.ai_chat_log
    FOR SELECT TO authenticated
    USING (company_id = current_company_id() AND current_user_role() = 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY ai_chat_log_admin_insert ON public.ai_chat_log
    FOR INSERT TO authenticated
    WITH CHECK (company_id = current_company_id() AND current_user_role() = 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
