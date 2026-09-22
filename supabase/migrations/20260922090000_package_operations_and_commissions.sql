-- A package keeps its cargo category (General/Special/Sea) while optionally
-- being forwarded from Kenya to another country.  Commission ownership is an
-- operational assignment, separate from the importer/sales-rep text field.
ALTER TABLE public.cargo_packages
  ADD COLUMN IF NOT EXISTS commission_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_international_forwarding boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS forward_destination_country text;

ALTER TABLE public.cargo_packages
  DROP CONSTRAINT IF EXISTS cargo_packages_forwarding_country_check;
ALTER TABLE public.cargo_packages
  ADD CONSTRAINT cargo_packages_forwarding_country_check CHECK (
    NOT is_international_forwarding
    OR nullif(btrim(coalesce(forward_destination_country, '')), '') IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS cargo_packages_forwarding_idx
  ON public.cargo_packages (is_international_forwarding)
  WHERE is_international_forwarding;
CREATE INDEX IF NOT EXISTS cargo_packages_commission_employee_idx
  ON public.cargo_packages (commission_employee_id)
  WHERE commission_employee_id IS NOT NULL;

-- Single idempotent helper used for both a payment state transition and a
-- late assignment on an already-paid package.  Admins and Finance Managers
-- are expressly excluded from commission calculations.
CREATE OR REPLACE FUNCTION public.create_cargo_commission_if_eligible(_package_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_pkg public.cargo_packages;
  v_emp public.employees;
  v_rule public.commission_rules;
  v_pct numeric := 0;
  v_flat numeric := 0;
  v_amount numeric := 0;
BEGIN
  SELECT * INTO v_pkg FROM public.cargo_packages WHERE id = _package_id;
  IF NOT FOUND OR v_pkg.status <> 'paid' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.commissions c WHERE c.cargo_package_id = v_pkg.id AND c.trigger = 'payment') THEN RETURN; END IF;

  IF v_pkg.commission_employee_id IS NOT NULL THEN
    SELECT * INTO v_emp FROM public.employees WHERE id = v_pkg.commission_employee_id AND is_active = true;
  ELSE
    v_emp := public.resolve_employee_for_cargo(v_pkg.sales_rep);
  END IF;
  IF v_emp.id IS NULL OR v_emp.role IN ('admin', 'finance_manager') THEN RETURN; END IF;

  SELECT * INTO v_rule FROM public.commission_rules
    WHERE active = true AND trigger = 'payment'
      AND (employee_id = v_emp.id OR (employee_id IS NULL AND role = v_emp.role))
    ORDER BY (employee_id IS NOT NULL) DESC, created_at DESC LIMIT 1;
  IF FOUND THEN
    v_pct := coalesce(v_rule.percentage, 0);
    v_flat := coalesce(v_rule.flat_amount, 0);
  ELSE
    v_pct := coalesce(nullif(v_emp.commission_percentage, 0),
      CASE v_emp.role WHEN 'sales_rep' THEN 5 WHEN 'sales_manager' THEN 2 WHEN 'logistics_manager' THEN 1.5 ELSE 0 END);
  END IF;
  IF v_pct = 0 AND v_flat = 0 THEN RETURN; END IF;
  v_amount := coalesce(v_pkg.cost, 0) * v_pct / 100.0 + v_flat;
  IF v_amount <= 0 THEN RETURN; END IF;
  INSERT INTO public.commissions (employee_id, package_id, cargo_package_id, trigger, amount, percentage, status)
  VALUES (v_emp.id, NULL, v_pkg.id, 'payment', v_amount, v_pct, 'pending');
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_create_commission_on_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid' OR OLD.commission_employee_id IS DISTINCT FROM NEW.commission_employee_id) THEN
    PERFORM public.create_cargo_commission_if_eligible(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_commission_paid ON public.cargo_packages;
CREATE TRIGGER trg_auto_commission_paid
  AFTER INSERT OR UPDATE OF status, commission_employee_id ON public.cargo_packages
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_commission_on_paid();

REVOKE ALL ON FUNCTION public.create_cargo_commission_if_eligible(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_create_commission_on_paid() FROM public, anon, authenticated;
