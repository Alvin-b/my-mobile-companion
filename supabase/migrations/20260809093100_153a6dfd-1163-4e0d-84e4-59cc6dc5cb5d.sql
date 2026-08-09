CREATE OR REPLACE FUNCTION public.resolve_employee_for_cargo(_sales_rep text)
RETURNS public.employees
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_emp public.employees;
  v_txt text := trim(coalesce(_sales_rep, ''));
  v_first text;
BEGIN
  IF v_txt = '' THEN RETURN NULL; END IF;
  v_first := split_part(v_txt, ' ', 1);

  IF v_first ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_emp FROM public.employees
      WHERE is_active AND (id = v_first::uuid OR user_id = v_first::uuid) LIMIT 1;
    IF FOUND THEN RETURN v_emp; END IF;
  END IF;

  SELECT * INTO v_emp FROM public.employees
    WHERE is_active AND employee_code = v_first LIMIT 1;
  IF FOUND THEN RETURN v_emp; END IF;

  SELECT * INTO v_emp FROM public.employees
    WHERE is_active AND lower(full_name) = lower(v_txt) LIMIT 1;
  IF FOUND THEN RETURN v_emp; END IF;

  SELECT * INTO v_emp FROM public.employees
    WHERE is_active AND v_txt ILIKE '%' || full_name || '%' LIMIT 1;
  IF FOUND THEN RETURN v_emp; END IF;

  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.resolve_employee_for_cargo(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.auto_create_commission_on_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_emp public.employees;
  v_rule public.commission_rules;
  v_pct numeric;
  v_flat numeric := 0;
  v_amount numeric;
BEGIN
  IF NEW.status IS DISTINCT FROM 'paid' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' THEN RETURN NEW; END IF;

  v_emp := public.resolve_employee_for_cargo(NEW.sales_rep);
  IF v_emp.id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_rule FROM public.commission_rules
    WHERE active = true AND trigger = 'payment'
      AND (employee_id = v_emp.id OR (employee_id IS NULL AND role = v_emp.role))
    ORDER BY (employee_id IS NOT NULL) DESC, created_at DESC
    LIMIT 1;

  IF FOUND THEN
    v_pct := COALESCE(v_rule.percentage, 0);
    v_flat := COALESCE(v_rule.flat_amount, 0);
  ELSE
    v_pct := COALESCE(v_emp.commission_percentage, 0);
  END IF;

  v_amount := COALESCE(NEW.cost, 0) * v_pct / 100.0 + v_flat;
  IF v_amount <= 0 THEN RETURN NEW; END IF;

  INSERT INTO public.commissions (employee_id, package_id, cargo_package_id, trigger, amount, percentage, status)
  VALUES (v_emp.id, NULL, NEW.id, 'payment', v_amount, v_pct, 'pending')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cargo_auto_commission ON public.cargo_packages;
CREATE TRIGGER trg_cargo_auto_commission
AFTER INSERT OR UPDATE OF status ON public.cargo_packages
FOR EACH ROW EXECUTE FUNCTION public.auto_create_commission_on_paid();

CREATE OR REPLACE FUNCTION public.on_payment_allocation_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.payment_notifications
    SET status = 'LINKED', updated_at = now()
    WHERE id = NEW.payment_notification_id;

  UPDATE public.cargo_packages
    SET status = CASE WHEN status IN ('registered', 'awaiting_payment') THEN 'paid' ELSE status END,
        paid_at = COALESCE(paid_at, now()),
        payment_ref = COALESCE(payment_ref, NEW.notification_number, NEW.payment_notification_id),
        payment_method = COALESCE(payment_method, 'mpesa'),
        updated_at = now()
    WHERE id = NEW.order_id;

  RETURN NEW;
END $$;