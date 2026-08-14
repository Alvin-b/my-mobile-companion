
-- 0. The status check constraint never allowed 'cleared' / 'released', which is
--    why linking payment evidence failed to move the package.
ALTER TABLE public.cargo_packages DROP CONSTRAINT IF EXISTS cargo_packages_status_check;
ALTER TABLE public.cargo_packages ADD CONSTRAINT cargo_packages_status_check
  CHECK (status = ANY (ARRAY['registered','pending','unpaid','paid','cleared','collected','released','cancelled']));

-- 1. Robust package clearing when payment evidence is linked (AFTER INSERT, so
--    it also survives any BEFORE-trigger edits).
CREATE OR REPLACE FUNCTION public.after_payment_allocation_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total numeric;
BEGIN
  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_total
    FROM public.payment_allocations WHERE order_id = NEW.order_id;

  UPDATE public.cargo_packages
    SET status = CASE WHEN status IN ('collected', 'released') THEN status ELSE 'cleared' END,
        cost = CASE WHEN COALESCE(cost, 0) = 0 THEN v_total ELSE cost END,
        paid_at = COALESCE(paid_at, now()),
        payment_ref = COALESCE(payment_ref, NEW.notification_number, NEW.payment_notification_id),
        payment_method = COALESCE(payment_method, 'mpesa'),
        updated_at = now()
    WHERE id = NEW.order_id;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_payment_allocation_after_insert ON public.payment_allocations;
CREATE TRIGGER trg_payment_allocation_after_insert
  AFTER INSERT ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.after_payment_allocation_insert();

REVOKE EXECUTE ON FUNCTION public.after_payment_allocation_insert() FROM PUBLIC, anon, authenticated;

-- 2. Repair packages that already have evidence linked but were left behind.
WITH totals AS (
  SELECT order_id, SUM(allocated_amount) AS total,
         MIN(COALESCE(notification_number, payment_notification_id)) AS ref
  FROM public.payment_allocations GROUP BY order_id
)
UPDATE public.cargo_packages p
  SET status = CASE WHEN p.status IN ('collected', 'released') THEN p.status ELSE 'cleared' END,
      cost = CASE WHEN COALESCE(p.cost, 0) = 0 THEN t.total ELSE p.cost END,
      paid_at = COALESCE(p.paid_at, now()),
      payment_ref = COALESCE(p.payment_ref, t.ref),
      payment_method = COALESCE(p.payment_method, 'mpesa'),
      updated_at = now()
  FROM totals t
  WHERE p.id = t.order_id;

-- 3. Backfill commissions for every paid/cleared package that has none.
DO $$
DECLARE
  r public.cargo_packages;
  v_emp public.employees;
  v_rule public.commission_rules;
  v_pct numeric;
  v_flat numeric;
  v_amount numeric;
BEGIN
  FOR r IN SELECT * FROM public.cargo_packages WHERE status IN ('paid', 'cleared', 'collected', 'released') LOOP
    v_emp := public.resolve_employee_for_cargo(r.sales_rep);
    IF v_emp.id IS NULL OR v_emp.role = 'admin' THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.commissions c WHERE c.cargo_package_id = r.id) THEN CONTINUE; END IF;

    v_flat := 0;
    SELECT * INTO v_rule FROM public.commission_rules
      WHERE active AND trigger = 'payment'
        AND (employee_id = v_emp.id OR (employee_id IS NULL AND role = v_emp.role))
      ORDER BY (employee_id IS NOT NULL) DESC, created_at DESC LIMIT 1;
    IF FOUND THEN
      v_pct := COALESCE(v_rule.percentage, 0);
      v_flat := COALESCE(v_rule.flat_amount, 0);
    ELSE
      v_pct := COALESCE(NULLIF(v_emp.commission_percentage, 0), 5);
    END IF;
    IF v_pct = 0 AND v_flat = 0 THEN v_pct := COALESCE(NULLIF(v_emp.commission_percentage, 0), 5); END IF;

    v_amount := COALESCE(r.cost, 0) * v_pct / 100.0 + v_flat;
    IF v_amount <= 0 THEN CONTINUE; END IF;

    INSERT INTO public.commissions (employee_id, cargo_package_id, trigger, amount, percentage, status)
      VALUES (v_emp.id, r.id, 'payment', v_amount, v_pct, 'pending')
      ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- 4. No duplicate emails.
CREATE UNIQUE INDEX IF NOT EXISTS employees_email_unique_ci
  ON public.employees (lower(email)) WHERE email IS NOT NULL AND email <> '';
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_ci
  ON public.profiles (lower(email)) WHERE email IS NOT NULL AND email <> '';
