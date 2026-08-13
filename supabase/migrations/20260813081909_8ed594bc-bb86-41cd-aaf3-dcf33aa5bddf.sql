DELETE FROM public.commission_rules WHERE role = 'admin';

CREATE OR REPLACE FUNCTION public.auto_create_commission_on_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp public.employees;
  v_rule public.commission_rules;
  v_pct numeric;
  v_flat numeric := 0;
  v_amount numeric;
BEGIN
  IF NEW.status NOT IN ('paid', 'cleared') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('paid', 'cleared') THEN RETURN NEW; END IF;

  v_emp := public.resolve_employee_for_cargo(NEW.sales_rep);
  IF v_emp.id IS NULL THEN RETURN NEW; END IF;
  -- Admins never earn commission.
  IF v_emp.role = 'admin' THEN RETURN NEW; END IF;

  SELECT * INTO v_rule FROM public.commission_rules
    WHERE active = true AND trigger = 'payment'
      AND (employee_id = v_emp.id OR (employee_id IS NULL AND role = v_emp.role))
    ORDER BY (employee_id IS NOT NULL) DESC, created_at DESC
    LIMIT 1;

  IF FOUND THEN
    v_pct := COALESCE(v_rule.percentage, 0);
    v_flat := COALESCE(v_rule.flat_amount, 0);
  ELSE
    v_pct := COALESCE(NULLIF(v_emp.commission_percentage, 0), 5);
  END IF;
  IF v_pct = 0 AND v_flat = 0 THEN v_pct := COALESCE(NULLIF(v_emp.commission_percentage, 0), 5); END IF;

  v_amount := COALESCE(NEW.cost, 0) * v_pct / 100.0 + v_flat;
  IF v_amount <= 0 THEN RETURN NEW; END IF;

  INSERT INTO public.commissions (employee_id, package_id, cargo_package_id, trigger, amount, percentage, status)
  VALUES (v_emp.id, NULL, NEW.id, 'payment', v_amount, v_pct, 'pending')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.auto_create_commission_for_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_employee public.employees;
  v_rule public.commission_rules;
  v_amount numeric;
BEGIN
  IF NEW.status <> 'paid' THEN RETURN NEW; END IF;

  SELECT * INTO v_employee FROM public.employees
    WHERE id = (SELECT received_by_employee_id FROM public.packages WHERE id = NEW.package_id)
      AND is_active = true;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_employee.role = 'admin' THEN RETURN NEW; END IF;

  SELECT * INTO v_rule FROM public.commission_rules
    WHERE role = v_employee.role AND trigger = 'payment' AND active = true
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_amount := NEW.amount * COALESCE(v_rule.percentage, 0) / 100 + COALESCE(v_rule.flat_amount, 0);

  INSERT INTO public.commissions (employee_id, package_id, payment_id, trigger, amount, percentage)
    VALUES (v_employee.id, NEW.package_id, NEW.id, 'payment', v_amount, v_rule.percentage)
    ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_payment_allocation_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg public.cargo_packages;
  v_key text := nullif(trim(coalesce(NEW.order_id, '')), '');
  v_track text := nullif(trim(coalesce(NEW.tracking_number, '')), '');
BEGIN
  SELECT * INTO v_pkg FROM public.cargo_packages
    WHERE id = coalesce(v_key, v_track)
       OR id = coalesce(v_track, v_key)
       OR lower(tracking_number) = lower(coalesce(v_key, v_track))
       OR lower(tracking_number) = lower(coalesce(v_track, v_key))
    ORDER BY registered_at
    LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot link payment: no package found for "%" / "%"', coalesce(v_key,''), coalesce(v_track,'');
  END IF;

  NEW.order_id := v_pkg.id;
  NEW.tracking_number := v_pkg.id;

  UPDATE public.payment_notifications
    SET status = 'LINKED', updated_at = now()
    WHERE id = NEW.payment_notification_id;

  -- Evidence linked = admin already received the money, so the package is cleared.
  UPDATE public.cargo_packages
    SET status = CASE WHEN status IN ('collected', 'released') THEN status ELSE 'cleared' END,
        cost = CASE WHEN coalesce(cost, 0) = 0 THEN NEW.allocated_amount ELSE cost END,
        paid_at = COALESCE(paid_at, now()),
        payment_ref = COALESCE(payment_ref, NEW.notification_number, NEW.payment_notification_id),
        payment_method = COALESCE(payment_method, 'mpesa'),
        updated_at = now()
    WHERE id = v_pkg.id;

  RETURN NEW;
END $function$;