-- Audited admin correction history for incorrectly entered payment evidence.
CREATE TABLE IF NOT EXISTS public.payment_control_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_notification_id text NOT NULL,
  actor_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (length(trim(reason)) >= 5),
  before_record jsonb NOT NULL,
  after_record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_control_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_control_audit FROM anon, authenticated;
GRANT ALL ON public.payment_control_audit TO service_role;
CREATE INDEX IF NOT EXISTS payment_control_audit_payment_created_idx
  ON public.payment_control_audit(payment_notification_id, created_at DESC);
