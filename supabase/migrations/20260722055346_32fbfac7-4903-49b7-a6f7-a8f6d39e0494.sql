
-- Align backend schema with DexApp mobile Postman spec

-- 1) Cargo packages: add "descr" column (mobile sends both descr and description)
ALTER TABLE public.cargo_packages ADD COLUMN IF NOT EXISTS descr text;

-- 2) Rebuild audit_logs to match mobile shape (id text, action, actor, timestamp, details)
DROP TABLE IF EXISTS public.audit_logs CASCADE;
CREATE TABLE public.audit_logs (
  id text PRIMARY KEY,
  action text NOT NULL,
  actor text,
  timestamp timestamptz NOT NULL DEFAULT now(),
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_logs_staff_read" ON public.audit_logs FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "audit_logs_staff_insert" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE INDEX idx_audit_logs_timestamp ON public.audit_logs (timestamp DESC);

-- 3) Broadcast messages
CREATE TABLE IF NOT EXISTS public.broadcast_messages (
  id text PRIMARY KEY,
  message text NOT NULL,
  target text NOT NULL DEFAULT 'all',
  sender text,
  timestamp timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcast_messages TO authenticated;
GRANT ALL ON public.broadcast_messages TO service_role;
ALTER TABLE public.broadcast_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "broadcast_read_staff" ON public.broadcast_messages FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "broadcast_write_admin" ON public.broadcast_messages FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE INDEX idx_broadcast_messages_timestamp ON public.broadcast_messages (timestamp DESC);

-- 4) commission_rates view over commission_rules (mobile spec uses commission_rates)
DROP VIEW IF EXISTS public.commission_rates;
CREATE VIEW public.commission_rates AS
  SELECT id, role, employee_id, trigger, percentage, flat_amount, active, created_at
  FROM public.commission_rules;
GRANT SELECT ON public.commission_rates TO authenticated;
GRANT ALL ON public.commission_rates TO service_role;
