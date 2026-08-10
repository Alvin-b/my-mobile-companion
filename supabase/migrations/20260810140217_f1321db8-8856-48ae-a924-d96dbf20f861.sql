-- 1. Remove the junk blank-id package that swallowed a mis-addressed link
DELETE FROM public.payment_allocations WHERE coalesce(trim(order_id), '') = '' OR order_id NOT IN (SELECT id FROM public.cargo_packages);
DELETE FROM public.cargo_packages WHERE coalesce(trim(id), '') = '';
ALTER TABLE public.cargo_packages ADD CONSTRAINT cargo_packages_id_not_blank CHECK (length(trim(id)) > 0);
ALTER TABLE public.payment_allocations ADD CONSTRAINT payment_allocations_order_id_not_blank CHECK (length(trim(order_id)) > 0);

-- 2. Commission rule for admin-linked cargo + generic fallback
INSERT INTO public.commission_rules (role, trigger, percentage, flat_amount, active)
SELECT 'admin', 'payment', 5.00, 0, true
WHERE NOT EXISTS (SELECT 1 FROM public.commission_rules WHERE role = 'admin' AND trigger = 'payment');

-- 3. Robust allocation handling: resolve the package or fail loudly
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
    WHERE id = coalesce(v_key, v_track) OR id = coalesce(v_track, v_key)
    LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot link payment: no package found for "%" / "%"', coalesce(v_key,''), coalesce(v_track,'');
  END IF;

  NEW.order_id := v_pkg.id;
  NEW.tracking_number := v_pkg.id;

  UPDATE public.payment_notifications
    SET status = 'LINKED', updated_at = now()
    WHERE id = NEW.payment_notification_id;

  UPDATE public.cargo_packages
    SET status = CASE WHEN status IN ('registered', 'awaiting_payment', 'unpaid') THEN 'paid' ELSE status END,
        cost = CASE WHEN coalesce(cost, 0) = 0 THEN NEW.allocated_amount ELSE cost END,
        paid_at = COALESCE(paid_at, now()),
        payment_ref = COALESCE(payment_ref, NEW.notification_number, NEW.payment_notification_id),
        payment_method = COALESCE(payment_method, 'mpesa'),
        updated_at = now()
    WHERE id = v_pkg.id;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_payment_allocation_insert ON public.payment_allocations;
CREATE TRIGGER trg_payment_allocation_insert
  BEFORE INSERT ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.on_payment_allocation_insert();

-- 4. Commission calculation: fall back to a 5% default so no paid package is skipped
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

-- 5. Backfill commissions for packages already marked paid
INSERT INTO public.commissions (employee_id, package_id, cargo_package_id, trigger, amount, percentage, status)
SELECT e.id, NULL, p.id, 'payment',
       coalesce(p.cost,0) * coalesce(nullif(r.percentage,0), nullif(e.commission_percentage,0), 5) / 100.0,
       coalesce(nullif(r.percentage,0), nullif(e.commission_percentage,0), 5),
       'pending'
FROM public.cargo_packages p
CROSS JOIN LATERAL public.resolve_employee_for_cargo(p.sales_rep) e
LEFT JOIN LATERAL (
  SELECT * FROM public.commission_rules cr
   WHERE cr.active AND cr.trigger = 'payment'
     AND (cr.employee_id = e.id OR (cr.employee_id IS NULL AND cr.role = e.role))
   ORDER BY (cr.employee_id IS NOT NULL) DESC, cr.created_at DESC LIMIT 1
) r ON true
WHERE p.status = 'paid' AND e.id IS NOT NULL AND coalesce(p.cost,0) > 0
ON CONFLICT DO NOTHING;