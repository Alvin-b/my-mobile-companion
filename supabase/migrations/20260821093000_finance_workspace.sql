-- DEX Finance Manager workspace. Financial records are separate from package
-- operations so approvals, invoice corrections and month closes remain auditable.
CREATE TABLE IF NOT EXISTS public.finance_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  legal_name text, kra_pin text, vat_registered boolean NOT NULL DEFAULT false,
  branch_name text, invoice_prefix text NOT NULL DEFAULT 'DEX',
  etims_mode text NOT NULL DEFAULT 'not_configured'
    CHECK (etims_mode IN ('not_configured','sandbox','production')),
  etims_status text NOT NULL DEFAULT 'not_connected'
    CHECK (etims_status IN ('not_connected','ready_for_sandbox','certification_pending','connected')),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES auth.users(id)
);
INSERT INTO public.finance_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.finance_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_number text UNIQUE NOT NULL,
  customer_name text NOT NULL, customer_pin text, customer_phone text,
  issue_date date NOT NULL DEFAULT current_date, due_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','submitted','accepted','rejected','cancelled','credited')),
  subtotal numeric(14,2) NOT NULL DEFAULT 0, tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0, total numeric(14,2) NOT NULL DEFAULT 0,
  package_ids jsonb NOT NULL DEFAULT '[]'::jsonb, notes text,
  etims_invoice_number text, etims_control_code text, etims_response jsonb,
  submitted_at timestamptz, accepted_at timestamptz, rejection_reason text,
  approved_by uuid REFERENCES auth.users(id), approved_at timestamptz,
  created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.finance_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL REFERENCES public.finance_invoices(id) ON DELETE CASCADE,
  description text NOT NULL, quantity numeric(12,2) NOT NULL DEFAULT 1,
  unit_price numeric(14,2) NOT NULL DEFAULT 0, line_total numeric(14,2) NOT NULL DEFAULT 0,
  package_id text REFERENCES public.cargo_packages(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.finance_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), expense_date date NOT NULL DEFAULT current_date,
  supplier_name text NOT NULL, supplier_pin text, category text NOT NULL,
  description text, amount numeric(14,2) NOT NULL CHECK (amount >= 0), tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  payment_method text, receipt_url text, etims_invoice_number text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','paid','rejected','void')),
  package_id text REFERENCES public.cargo_packages(id) ON DELETE SET NULL,
  submitted_by uuid REFERENCES auth.users(id), approved_by uuid REFERENCES auth.users(id), approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.finance_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text NOT NULL CHECK (entity_type IN ('invoice','expense','write_off','refund')),
  entity_id uuid NOT NULL, decision text NOT NULL CHECK (decision IN ('pending','approved','rejected')),
  requested_by uuid REFERENCES auth.users(id), decided_by uuid REFERENCES auth.users(id), note text,
  created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.finance_month_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period date UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','reopened')),
  revenue numeric(14,2) NOT NULL DEFAULT 0, expenses numeric(14,2) NOT NULL DEFAULT 0,
  commissions numeric(14,2) NOT NULL DEFAULT 0, net_profit numeric(14,2) NOT NULL DEFAULT 0,
  closed_by uuid REFERENCES auth.users(id), closed_at timestamptz, note text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.finance_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action text NOT NULL, entity_type text NOT NULL,
  entity_id uuid, details jsonb NOT NULL DEFAULT '{}'::jsonb, actor_id uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_finance_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.employees e WHERE e.user_id = _user_id AND e.is_active AND e.role = 'finance_manager')
      OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND r.role = 'finance_manager');
$$;
REVOKE ALL ON FUNCTION public.is_finance_manager(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_finance_manager(uuid) TO authenticated;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['finance_settings','finance_invoices','finance_invoice_items','finance_expenses','finance_approvals','finance_month_closes','finance_audit_log'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;
CREATE POLICY finance_settings_read ON public.finance_settings FOR SELECT TO authenticated USING (public.is_admin(auth.uid()) OR public.is_finance_manager(auth.uid()));
CREATE POLICY finance_settings_write ON public.finance_settings FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY finance_invoices_access ON public.finance_invoices FOR ALL TO authenticated USING (public.is_admin(auth.uid()) OR public.is_finance_manager(auth.uid())) WITH CHECK (public.is_admin(auth.uid()) OR public.is_finance_manager(auth.uid()));
CREATE POLICY finance_invoice_items_access ON public.finance_invoice_items FOR ALL TO authenticated USING (public.is_admin(auth.uid()) OR public.is_finance_manager(auth.uid())) WITH CHECK (public.is_admin(auth.uid()) OR public.is_finance_manager(auth.uid()));
CREATE POLICY finance_expenses_access ON public.finance_expenses FOR ALL TO authenticated USING (public.is_admin(auth.uid()) OR public.is_finance_manager(auth.uid())) WITH CHECK (public.is_admin(auth.uid()) OR public.is_finance_manager(auth.uid()));
CREATE POLICY finance_approvals_access ON public.finance_approvals FOR ALL TO authenticated USING (public.is_admin(auth.uid()) OR public.is_finance_manager(auth.uid())) WITH CHECK (public.is_admin(auth.uid()) OR public.is_finance_manager(auth.uid()));
CREATE POLICY finance_month_close_access ON public.finance_month_closes FOR ALL TO authenticated USING (public.is_admin(auth.uid()) OR public.is_finance_manager(auth.uid())) WITH CHECK (public.is_admin(auth.uid()) OR public.is_finance_manager(auth.uid()));
CREATE POLICY finance_audit_access ON public.finance_audit_log FOR SELECT TO authenticated USING (public.is_admin(auth.uid()) OR public.is_finance_manager(auth.uid()));

CREATE INDEX IF NOT EXISTS finance_invoices_status_due_idx ON public.finance_invoices(status, due_date);
CREATE INDEX IF NOT EXISTS finance_expenses_date_category_idx ON public.finance_expenses(expense_date DESC, category);

-- Every finance change is recorded independently of the UI. This gives DEX a
-- durable audit trail for invoice, expense and close-period reviews.
CREATE OR REPLACE FUNCTION public.finance_audit_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row jsonb; BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  INSERT INTO public.finance_audit_log(action, entity_type, entity_id, details, actor_id)
  VALUES (lower(TG_OP), TG_TABLE_NAME, (v_row->>'id')::uuid,
    jsonb_build_object('status', v_row->>'status', 'amount', COALESCE(v_row->>'total', v_row->>'amount'), 'period', v_row->>'period'), auth.uid());
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.finance_audit_trigger() FROM PUBLIC;
DROP TRIGGER IF EXISTS finance_invoice_audit ON public.finance_invoices;
CREATE TRIGGER finance_invoice_audit AFTER INSERT OR UPDATE OR DELETE ON public.finance_invoices FOR EACH ROW EXECUTE FUNCTION public.finance_audit_trigger();
DROP TRIGGER IF EXISTS finance_expense_audit ON public.finance_expenses;
CREATE TRIGGER finance_expense_audit AFTER INSERT OR UPDATE OR DELETE ON public.finance_expenses FOR EACH ROW EXECUTE FUNCTION public.finance_audit_trigger();
DROP TRIGGER IF EXISTS finance_close_audit ON public.finance_month_closes;
CREATE TRIGGER finance_close_audit AFTER INSERT OR UPDATE OR DELETE ON public.finance_month_closes FOR EACH ROW EXECUTE FUNCTION public.finance_audit_trigger();

CREATE OR REPLACE FUNCTION public.finance_close_month(_period date, _note text DEFAULT NULL)
RETURNS public.finance_month_closes LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.finance_month_closes; v_start date := date_trunc('month', _period)::date; v_end date := (date_trunc('month', _period) + interval '1 month')::date; BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.is_finance_manager(auth.uid())) THEN RAISE EXCEPTION 'Finance Manager or administrator access is required'; END IF;
  IF EXISTS (SELECT 1 FROM public.finance_month_closes WHERE period = v_start AND status = 'closed') THEN RAISE EXCEPTION 'This month is already closed'; END IF;
  INSERT INTO public.finance_month_closes(period, status, revenue, expenses, commissions, net_profit, closed_by, closed_at, note)
  SELECT v_start, 'closed',
    COALESCE((SELECT sum(cost) FROM public.cargo_packages WHERE paid_at >= v_start AND paid_at < v_end), 0),
    COALESCE((SELECT sum(amount) FROM public.finance_expenses WHERE status IN ('approved','paid') AND expense_date >= v_start AND expense_date < v_end), 0),
    COALESCE((SELECT sum(amount) FROM public.commissions WHERE created_at >= v_start AND created_at < v_end), 0),
    0, auth.uid(), now(), _note
  ON CONFLICT (period) DO UPDATE SET status='closed', revenue=EXCLUDED.revenue, expenses=EXCLUDED.expenses, commissions=EXCLUDED.commissions, closed_by=auth.uid(), closed_at=now(), note=EXCLUDED.note
  RETURNING * INTO r;
  UPDATE public.finance_month_closes SET net_profit = revenue - expenses - commissions WHERE id = r.id RETURNING * INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.finance_close_month(date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_close_month(date, text) TO authenticated;
