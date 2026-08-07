-- 1. Reference column for cargo_packages-sourced commissions (text id)
ALTER TABLE public.commissions ADD COLUMN IF NOT EXISTS cargo_package_id text;

-- 2. De-duplicate existing rows before adding constraints
DELETE FROM public.commissions c
USING public.commissions k
WHERE c.payment_id IS NOT NULL
  AND c.payment_id = k.payment_id
  AND (c.created_at, c.id) > (k.created_at, k.id);

DELETE FROM public.commissions c
USING public.commissions k
WHERE c.package_id IS NOT NULL
  AND c.package_id = k.package_id
  AND c.employee_id = k.employee_id
  AND c.trigger = k.trigger
  AND (c.created_at, c.id) > (k.created_at, k.id);

-- 3. Hard uniqueness guarantees
CREATE UNIQUE INDEX IF NOT EXISTS commissions_payment_id_uniq
  ON public.commissions (payment_id) WHERE payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS commissions_package_employee_trigger_uniq
  ON public.commissions (package_id, employee_id, trigger) WHERE package_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS commissions_cargo_employee_trigger_uniq
  ON public.commissions (cargo_package_id, employee_id, trigger) WHERE cargo_package_id IS NOT NULL;

-- 4. Payment-sourced trigger: rely on the constraint, never double-insert
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

-- 5. cargo_packages trigger: store the source id so it can be deduped
CREATE OR REPLACE FUNCTION public.auto_create_commission_on_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code text;
  v_emp public.employees;
  v_rule public.commission_rules;
  v_amount numeric;
BEGIN
  IF NEW.status IS DISTINCT FROM 'paid' OR OLD.status = 'paid' THEN
    RETURN NEW;
  END IF;
  IF NEW.sales_rep IS NULL OR length(trim(NEW.sales_rep)) = 0 THEN
    RETURN NEW;
  END IF;

  v_code := split_part(trim(NEW.sales_rep), ' ', 1);

  SELECT * INTO v_emp FROM public.employees
    WHERE employee_code = v_code AND is_active = true LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT * INTO v_rule FROM public.commission_rules
    WHERE role = v_emp.role AND trigger = 'payment' AND active = true
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_amount := COALESCE(NEW.cost, 0) * COALESCE(v_rule.percentage, 0) / 100.0
              + COALESCE(v_rule.flat_amount, 0);

  INSERT INTO public.commissions (employee_id, package_id, cargo_package_id, trigger, amount, percentage, status)
  VALUES (v_emp.id, NULL, NEW.id, 'payment', v_amount, v_rule.percentage, 'pending')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;