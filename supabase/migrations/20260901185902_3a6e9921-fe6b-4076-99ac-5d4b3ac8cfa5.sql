-- Deitax is the external, KRA-approved eTIMS provider for DEX. Credentials are
-- deliberately not stored here; they live only in server environment secrets.
ALTER TABLE public.finance_settings
  ADD COLUMN IF NOT EXISTS etims_provider text NOT NULL DEFAULT 'deitax'
    CHECK (etims_provider IN ('deitax','none')),
  ADD COLUMN IF NOT EXISTS etims_business_id text,
  ADD COLUMN IF NOT EXISTS etims_last_checked_at timestamptz;

ALTER TABLE public.finance_invoices
  ADD COLUMN IF NOT EXISTS etims_provider text,
  ADD COLUMN IF NOT EXISTS etims_submission_id text,
  ADD COLUMN IF NOT EXISTS etims_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS etims_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS etims_receipt_type text NOT NULL DEFAULT 'NORMAL'
    CHECK (etims_receipt_type IN ('NORMAL','COPY','TRAINING','PROFORMA')),
  ADD COLUMN IF NOT EXISTS etims_transaction_type text NOT NULL DEFAULT 'SALE'
    CHECK (etims_transaction_type IN ('SALE','CREDIT_NOTE','DEBIT_NOTE')),
  ADD COLUMN IF NOT EXISTS payment_method text;

CREATE INDEX IF NOT EXISTS finance_invoices_etims_submission_idx
  ON public.finance_invoices(status, etims_last_attempt_at DESC);