
CREATE OR REPLACE FUNCTION public.auto_create_commission_on_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT * INTO v_emp
  FROM public.employees
  WHERE employee_code = v_code AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_rule
  FROM public.commission_rules
  WHERE role = v_emp.role
    AND trigger = 'payment'
    AND active = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_amount := COALESCE(NEW.cost, 0) * COALESCE(v_rule.percentage, 0) / 100.0
              + COALESCE(v_rule.flat_amount, 0);

  -- Avoid duplicates if trigger re-fires
  IF EXISTS (
    SELECT 1 FROM public.commissions
    WHERE package_id::text = NEW.id AND employee_id = v_emp.id AND trigger = 'payment'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.commissions (employee_id, package_id, trigger, amount, percentage, status)
  VALUES (v_emp.id, NULL, 'payment', v_amount, v_rule.percentage, 'pending');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_commission_paid ON public.cargo_packages;
CREATE TRIGGER trg_auto_commission_paid
AFTER UPDATE OF status ON public.cargo_packages
FOR EACH ROW
EXECUTE FUNCTION public.auto_create_commission_on_paid();
