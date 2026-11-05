-- Canonical cargo payment state and transactional payment-evidence controls.
-- This migration is intentionally safe to apply to installations that already
-- contain any of the legacy payment/allocation triggers.

ALTER TABLE public.cargo_packages
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid';
ALTER TABLE public.cargo_packages
  ALTER COLUMN payment_status SET DEFAULT 'unpaid';

ALTER TABLE public.cargo_packages
  DROP CONSTRAINT IF EXISTS cargo_packages_payment_status_check;

ALTER TABLE public.cargo_packages
  DROP CONSTRAINT IF EXISTS cargo_packages_status_check;

-- Resolve payment state from allocations first.  A legacy paid/paid_at value is
-- used only when no allocation exists.  A NULL/zero cost is deliberately treated
-- as unknown rather than silently converting an arbitrary allocation into a
-- fully-paid package or overwriting the imported cost.
WITH allocation_totals AS (
  SELECT order_id, COALESCE(SUM(allocated_amount), 0) AS allocated_total
  FROM public.payment_allocations
  GROUP BY order_id
)
UPDATE public.cargo_packages AS p
SET payment_status = CASE
  WHEN p.payment_status = 'invoice' AND a.order_id IS NULL THEN 'invoice'
  WHEN a.allocated_total > 0
       AND p.cost IS NOT NULL
       AND p.cost > 0
       AND a.allocated_total >= p.cost THEN 'paid'
  WHEN a.allocated_total > 0 THEN 'part_paid'
  WHEN lower(COALESCE(p.status, '')) = 'paid' OR p.paid_at IS NOT NULL THEN 'paid'
  ELSE 'unpaid'
END
FROM allocation_totals AS a
WHERE p.id = a.order_id;

UPDATE public.cargo_packages AS p
SET payment_status = CASE
  WHEN p.payment_status IN ('unpaid', 'part_paid', 'paid', 'invoice') THEN p.payment_status
  WHEN lower(COALESCE(p.status, '')) = 'paid' OR p.paid_at IS NOT NULL THEN 'paid'
  ELSE 'unpaid'
END
WHERE p.payment_status IS NULL
   OR p.payment_status NOT IN ('unpaid', 'part_paid', 'paid', 'invoice');

-- Legacy rows without allocations still need their old paid marker migrated.
UPDATE public.cargo_packages
SET payment_status = 'paid'
WHERE payment_status = 'unpaid'
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_allocations a WHERE a.order_id = cargo_packages.id
  )
  AND (lower(COALESCE(status, '')) = 'paid' OR paid_at IS NOT NULL);

ALTER TABLE public.cargo_packages
  ALTER COLUMN payment_status SET NOT NULL;
ALTER TABLE public.cargo_packages
  ADD CONSTRAINT cargo_packages_payment_status_check
  CHECK (payment_status IN ('unpaid', 'part_paid', 'paid', 'invoice'));

-- The customer-facing cargo status remains a two-value compatibility field.
UPDATE public.cargo_packages
SET status = CASE WHEN payment_status = 'paid' THEN 'paid' ELSE 'unpaid' END;

ALTER TABLE public.cargo_packages
  ADD CONSTRAINT cargo_packages_status_check CHECK (status IN ('unpaid', 'paid'));

CREATE INDEX IF NOT EXISTS cargo_packages_payment_status_idx
  ON public.cargo_packages(payment_status);

-- Recalculate one legacy cargo package while holding its row lock.  Cost <= 0
-- means the imported cost is unknown; allocations are retained and surfaced as
-- part_paid, but the package is not settled and does not earn commission.
CREATE OR REPLACE FUNCTION public.recalculate_cargo_payment_state(_package_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_package public.cargo_packages;
  v_total numeric := 0;
  v_reference text;
  v_state text := 'unpaid';
  v_has_active_invoice boolean := false;
BEGIN
  SELECT * INTO v_package
  FROM public.cargo_packages
  WHERE id = btrim(COALESCE(_package_id, ''))
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(SUM(a.allocated_amount), 0),
         MIN(COALESCE(NULLIF(a.notification_number, ''), a.payment_notification_id))
    INTO v_total, v_reference
  FROM public.payment_allocations a
  WHERE a.order_id = v_package.id;

  IF v_total > 0 AND v_package.cost IS NOT NULL AND v_package.cost > 0 THEN
    IF v_total >= v_package.cost THEN
      v_state := 'paid';
    ELSE
      v_state := 'part_paid';
    END IF;
  ELSIF v_total > 0 THEN
    v_state := 'part_paid';
  END IF;

  IF v_total = 0 THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.finance_invoices i
      WHERE i.status NOT IN ('cancelled', 'credited')
        AND (
          (jsonb_typeof(i.package_ids) = 'array' AND i.package_ids @> jsonb_build_array(v_package.id))
          OR EXISTS (
            SELECT 1
            FROM public.finance_invoice_items ii
            WHERE ii.invoice_id = i.id AND ii.package_id = v_package.id
          )
        )
    ) INTO v_has_active_invoice;
    IF v_has_active_invoice THEN v_state := 'invoice'; END IF;
  END IF;

  UPDATE public.cargo_packages
  SET payment_status = v_state,
      status = CASE WHEN v_state = 'paid' THEN 'paid' ELSE 'unpaid' END,
      paid_at = CASE
        WHEN v_state = 'paid' THEN COALESCE(paid_at, now())
        ELSE NULL
      END,
      payment_ref = CASE
        WHEN v_total > 0 THEN COALESCE(payment_ref, v_reference)
        ELSE payment_ref
      END,
      payment_method = CASE
        WHEN v_total > 0 THEN COALESCE(payment_method, 'payment_evidence')
        ELSE payment_method
      END,
      updated_at = now()
  WHERE id = v_package.id;
END;
$$;
REVOKE ALL ON FUNCTION public.recalculate_cargo_payment_state(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_cargo_payment_state(text) TO service_role;

-- The BEFORE trigger only canonicalizes the legacy text identifiers.  It must
-- never settle a package: settlement belongs to the locked/recalculating path.
CREATE OR REPLACE FUNCTION public.on_payment_allocation_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_package public.cargo_packages;
  v_order_key text := NULLIF(btrim(COALESCE(NEW.order_id, '')), '');
  v_tracking_key text := NULLIF(btrim(COALESCE(NEW.tracking_number, '')), '');
BEGIN
  IF v_order_key IS NULL AND v_tracking_key IS NULL THEN
    RAISE EXCEPTION 'Cannot link payment: a package identifier is required';
  END IF;

  SELECT p.* INTO v_package
  FROM public.cargo_packages p
  WHERE (v_order_key IS NOT NULL AND p.id = v_order_key)
     OR (v_tracking_key IS NOT NULL AND p.id = v_tracking_key)
     OR (v_order_key IS NOT NULL AND lower(btrim(COALESCE(p.tracking_number, ''))) = lower(v_order_key))
     OR (v_tracking_key IS NOT NULL AND lower(btrim(COALESCE(p.tracking_number, ''))) = lower(v_tracking_key))
  ORDER BY
    CASE WHEN p.id = COALESCE(v_order_key, v_tracking_key) THEN 0 ELSE 1 END,
    p.registered_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot link payment: no package found for "%" / "%"', COALESCE(v_order_key, ''), COALESCE(v_tracking_key, '');
  END IF;

  NEW.order_id := v_package.id;
  NEW.tracking_number := v_package.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.on_payment_allocation_insert() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.after_payment_allocation_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  UPDATE public.payment_notifications
  SET status = 'LINKED', updated_at = now()
  WHERE id = NEW.payment_notification_id;

  PERFORM public.recalculate_cargo_payment_state(NEW.order_id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.after_payment_allocation_insert() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.after_payment_allocation_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_remaining integer;
BEGIN
  PERFORM public.recalculate_cargo_payment_state(OLD.order_id);
  SELECT count(*) INTO v_remaining
  FROM public.payment_allocations
  WHERE payment_notification_id = OLD.payment_notification_id;
  IF v_remaining = 0 THEN
    UPDATE public.payment_notifications
    SET status = 'PENDING', updated_at = now()
    WHERE id = OLD.payment_notification_id;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.after_payment_allocation_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payment_allocation_insert ON public.payment_allocations;
DROP TRIGGER IF EXISTS trg_payment_allocation_after_insert ON public.payment_allocations;
DROP TRIGGER IF EXISTS trg_payment_allocation_after_delete ON public.payment_allocations;
CREATE TRIGGER trg_payment_allocation_insert
  BEFORE INSERT ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.on_payment_allocation_insert();
CREATE TRIGGER trg_payment_allocation_after_insert
  AFTER INSERT ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.after_payment_allocation_insert();
CREATE TRIGGER trg_payment_allocation_after_delete
  AFTER DELETE ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.after_payment_allocation_delete();

-- A payment-triggered commission exists only for fully settled cargo.  The
-- existing pending rows for partial/unknown-cost packages are stale legacy rows
-- and are removed; approved/paid history is left intact.
CREATE OR REPLACE FUNCTION public.create_cargo_commission_if_eligible(_package_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_package public.cargo_packages;
  v_employee public.employees;
  v_rule public.commission_rules;
  v_percentage numeric := 0;
  v_flat numeric := 0;
  v_amount numeric := 0;
BEGIN
  SELECT * INTO v_package
  FROM public.cargo_packages
  WHERE id = _package_id;
  IF NOT FOUND OR v_package.status <> 'paid' OR v_package.payment_status <> 'paid' THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.commissions c
    WHERE c.cargo_package_id = v_package.id AND c.trigger = 'payment'
  ) THEN RETURN; END IF;

  IF v_package.commission_employee_id IS NOT NULL THEN
    SELECT * INTO v_employee
    FROM public.employees
    WHERE id = v_package.commission_employee_id AND is_active = true;
  ELSE
    v_employee := public.resolve_employee_for_cargo(v_package.sales_rep);
  END IF;
  IF v_employee.id IS NULL OR lower(v_employee.role::text) IN ('admin', 'finance_manager') THEN RETURN; END IF;

  SELECT * INTO v_rule
  FROM public.commission_rules
  WHERE active = true AND trigger = 'payment'
    AND (employee_id = v_employee.id OR (employee_id IS NULL AND role = v_employee.role))
  ORDER BY (employee_id IS NOT NULL) DESC, created_at DESC
  LIMIT 1;
  IF FOUND THEN
    v_percentage := COALESCE(v_rule.percentage, 0);
    v_flat := COALESCE(v_rule.flat_amount, 0);
  ELSE
    v_percentage := COALESCE(NULLIF(v_employee.commission_percentage, 0),
      CASE lower(v_employee.role::text)
        WHEN 'sales_rep' THEN 5
        WHEN 'sales_manager' THEN 2
        WHEN 'logistics_manager' THEN 1.5
        WHEN 'sr' THEN 5
        WHEN 'sm' THEN 2
        WHEN 'lm' THEN 1.5
        ELSE 0
      END);
  END IF;
  IF v_percentage = 0 AND v_flat = 0 THEN RETURN; END IF;
  v_amount := COALESCE(v_package.cost, 0) * v_percentage / 100.0 + v_flat;
  IF v_amount <= 0 THEN RETURN; END IF;

  INSERT INTO public.commissions (
    employee_id, package_id, cargo_package_id, trigger, amount, percentage, status
  ) VALUES (
    v_employee.id, NULL, v_package.id, 'payment', v_amount, v_percentage, 'pending'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.create_cargo_commission_if_eligible(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.auto_create_commission_on_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF NEW.status = 'paid' AND NEW.payment_status = 'paid' THEN
    IF TG_OP = 'UPDATE' AND OLD.commission_employee_id IS DISTINCT FROM NEW.commission_employee_id THEN
      DELETE FROM public.commissions
      WHERE cargo_package_id = NEW.id
        AND trigger = 'payment'
        AND status = 'pending';
    END IF;
    IF TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM 'paid'
       OR OLD.payment_status IS DISTINCT FROM 'paid'
       OR OLD.commission_employee_id IS DISTINCT FROM NEW.commission_employee_id THEN
      PERFORM public.create_cargo_commission_if_eligible(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.auto_create_commission_on_paid() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_auto_commission_paid ON public.cargo_packages;
CREATE TRIGGER trg_auto_commission_paid
  AFTER INSERT OR UPDATE OF status, payment_status, commission_employee_id ON public.cargo_packages
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_commission_on_paid();

DELETE FROM public.commissions c
USING public.cargo_packages p
WHERE c.cargo_package_id = p.id
  AND c.trigger = 'payment'
  AND c.status = 'pending'
  AND p.payment_status <> 'paid';

-- Recalculate all existing allocation-backed packages after the new helpers and
-- commission trigger are installed.  This is safe to rerun.
DO $$
DECLARE
  v_package_id text;
BEGIN
  FOR v_package_id IN
    SELECT DISTINCT order_id FROM public.payment_allocations WHERE btrim(order_id) <> ''
  LOOP
    PERFORM public.recalculate_cargo_payment_state(v_package_id);
  END LOOP;
END;
$$;

-- Finance invoices mark only otherwise-unpaid packages as invoice.  Paid and
-- part-paid allocations always win.  JSONB package_ids and normalized invoice
-- items are both authoritative because older clients populated different forms.
CREATE OR REPLACE FUNCTION public.sync_finance_invoice_package_states(_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_active boolean;
BEGIN
  SELECT (status NOT IN ('cancelled', 'credited')) INTO v_active
  FROM public.finance_invoices
  WHERE id = _invoice_id;
  IF NOT FOUND OR NOT v_active THEN RETURN; END IF;

  WITH package_ids AS (
    SELECT btrim(value) AS package_id
    FROM public.finance_invoices i,
         jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(i.package_ids) = 'array' THEN i.package_ids ELSE '[]'::jsonb END
         ) AS values(value)
    WHERE i.id = _invoice_id
    UNION
    SELECT btrim(ii.package_id)
    FROM public.finance_invoice_items ii
    WHERE ii.invoice_id = _invoice_id AND ii.package_id IS NOT NULL
  )
  UPDATE public.cargo_packages p
  SET payment_status = 'invoice',
      status = 'unpaid',
      paid_at = NULL,
      updated_at = now()
  FROM package_ids ids
  WHERE p.id = ids.package_id
    AND btrim(ids.package_id) <> ''
    AND p.payment_status NOT IN ('paid', 'part_paid')
    AND p.status <> 'paid'
    AND p.paid_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_finance_invoice_package_states(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_finance_invoice_package_states(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_finance_invoice_package(_package_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_id text := btrim(COALESCE(_package_id, ''));
  v_active_invoice boolean;
  v_has_allocations boolean;
BEGIN
  IF v_id = '' THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.finance_invoices i
    WHERE i.status NOT IN ('cancelled', 'credited')
      AND (
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(i.package_ids) = 'array' THEN i.package_ids ELSE '[]'::jsonb END
          ) AS values(value)
          WHERE btrim(values.value) = v_id
        )
        OR EXISTS (
          SELECT 1 FROM public.finance_invoice_items ii
          WHERE ii.invoice_id = i.id AND ii.package_id = v_id
        )
      )
  ) INTO v_active_invoice;

  IF v_active_invoice THEN
    UPDATE public.cargo_packages
    SET payment_status = 'invoice', status = 'unpaid', paid_at = NULL, updated_at = now()
    WHERE id = v_id
      AND payment_status NOT IN ('paid', 'part_paid')
      AND status <> 'paid'
      AND paid_at IS NULL;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.payment_allocations a WHERE a.order_id = v_id
  ) INTO v_has_allocations;
  IF v_has_allocations THEN
    PERFORM public.recalculate_cargo_payment_state(v_id);
  ELSE
    UPDATE public.cargo_packages
    SET payment_status = 'unpaid', status = 'unpaid', paid_at = NULL, updated_at = now()
    WHERE id = v_id AND payment_status = 'invoice';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_finance_invoice_package(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_finance_invoice_package(text) TO service_role;

CREATE OR REPLACE FUNCTION public.finance_invoice_state_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_package_id text;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM public.sync_finance_invoice_package_states(NEW.id);
  END IF;

  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    FOR v_package_id IN
      SELECT DISTINCT btrim(value)
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(OLD.package_ids) = 'array' THEN OLD.package_ids
          ELSE '[]'::jsonb
        END
      ) AS values(value)
      WHERE btrim(value) <> ''
    LOOP
      PERFORM public.reconcile_finance_invoice_package(v_package_id);
    END LOOP;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.finance_invoice_state_sync() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finance_invoice_item_state_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM public.sync_finance_invoice_package_states(NEW.invoice_id);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.package_id IS DISTINCT FROM NEW.package_id THEN
    PERFORM public.reconcile_finance_invoice_package(OLD.package_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.reconcile_finance_invoice_package(OLD.package_id);
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.finance_invoice_item_state_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS finance_invoice_payment_state_sync ON public.finance_invoices;
DROP TRIGGER IF EXISTS finance_invoice_item_payment_state_sync ON public.finance_invoice_items;
CREATE TRIGGER finance_invoice_payment_state_sync
  AFTER INSERT OR UPDATE OF status, package_ids OR DELETE ON public.finance_invoices
  FOR EACH ROW EXECUTE FUNCTION public.finance_invoice_state_sync();
CREATE TRIGGER finance_invoice_item_payment_state_sync
  AFTER INSERT OR UPDATE OF invoice_id, package_id OR DELETE ON public.finance_invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.finance_invoice_item_state_sync();

DO $$
DECLARE
  v_invoice_id uuid;
BEGIN
  FOR v_invoice_id IN
    SELECT id FROM public.finance_invoices WHERE status NOT IN ('cancelled', 'credited')
  LOOP
    PERFORM public.sync_finance_invoice_package_states(v_invoice_id);
  END LOOP;
END;
$$;

-- Payment evidence and allocations remain readable/writable by active staff for
-- compatibility, but only public.is_admin(auth.uid()) can delete them.  The
-- audited admin/payment-control API remains the supported unlink/delete path.
DROP POLICY IF EXISTS payment_notifications_all_staff ON public.payment_notifications;
DROP POLICY IF EXISTS payment_notifications_staff_read ON public.payment_notifications;
DROP POLICY IF EXISTS payment_notifications_staff_insert ON public.payment_notifications;
DROP POLICY IF EXISTS payment_notifications_staff_update ON public.payment_notifications;
DROP POLICY IF EXISTS payment_notifications_admin_delete ON public.payment_notifications;
CREATE POLICY payment_notifications_staff_read ON public.payment_notifications
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY payment_notifications_staff_insert ON public.payment_notifications
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY payment_notifications_staff_update ON public.payment_notifications
  FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY payment_notifications_admin_delete ON public.payment_notifications
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS payment_allocations_all_staff ON public.payment_allocations;
DROP POLICY IF EXISTS payment_allocations_staff_read ON public.payment_allocations;
DROP POLICY IF EXISTS payment_allocations_staff_insert ON public.payment_allocations;
DROP POLICY IF EXISTS payment_allocations_staff_update ON public.payment_allocations;
DROP POLICY IF EXISTS payment_allocations_admin_delete ON public.payment_allocations;
CREATE POLICY payment_allocations_staff_read ON public.payment_allocations
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY payment_allocations_staff_insert ON public.payment_allocations
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY payment_allocations_staff_update ON public.payment_allocations
  FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY payment_allocations_admin_delete ON public.payment_allocations
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- Locked multi-package allocation RPC.  The API passes a JSON array of
-- {package_id, amount}; all validation and inserts happen in one transaction.
CREATE OR REPLACE FUNCTION public.link_payment_allocations(
  _payment_notification_id text,
  _allocations jsonb,
  _linked_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_notification public.payment_notifications;
  v_input jsonb;
  v_key text;
  v_amount numeric;
  v_package public.cargo_packages;
  v_package_id text;
  v_new_total numeric := 0;
  v_existing_evidence_total numeric := 0;
  v_existing_package_total numeric := 0;
  v_id text;
  v_rows jsonb;
BEGIN
  IF _payment_notification_id IS NULL OR btrim(_payment_notification_id) = '' THEN
    RAISE EXCEPTION 'payment_notification_id is required';
  END IF;
  IF _allocations IS NULL OR jsonb_typeof(_allocations) <> 'array' OR jsonb_array_length(_allocations) = 0 THEN
    RAISE EXCEPTION 'At least one allocation is required';
  END IF;

  CREATE TEMP TABLE link_payment_rows (
    package_id text NOT NULL,
    amount numeric NOT NULL
  ) ON COMMIT DROP;

  FOR v_input IN SELECT value FROM jsonb_array_elements(_allocations)
  LOOP
    v_key := NULLIF(btrim(COALESCE(v_input->>'package_id', v_input->>'order_id', v_input->>'tracking_number', '')), '');
    IF v_key IS NULL THEN RAISE EXCEPTION 'Every allocation needs a package_id'; END IF;
    BEGIN
      v_amount := (v_input->>'amount')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Allocation amount must be a positive number';
    END;
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Allocation amount must be a positive number';
    END IF;

    SELECT p.* INTO v_package
    FROM public.cargo_packages p
    WHERE p.id = v_key
       OR lower(btrim(COALESCE(p.tracking_number, ''))) = lower(v_key)
    ORDER BY CASE WHEN p.id = v_key THEN 0 ELSE 1 END, p.registered_at ASC
    LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'No package found for "%"', v_key; END IF;

    INSERT INTO link_payment_rows(package_id, amount) VALUES (v_package.id, v_amount);
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM link_payment_rows GROUP BY package_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A package may appear only once in one payment allocation request';
  END IF;

  -- Lock the evidence first, then all packages in deterministic ID order.
  SELECT * INTO v_notification
  FROM public.payment_notifications
  WHERE id = _payment_notification_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment evidence not found'; END IF;

  FOR v_package_id IN SELECT package_id FROM link_payment_rows ORDER BY package_id
  LOOP
    SELECT * INTO v_package
    FROM public.cargo_packages
    WHERE id = v_package_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Package was not found'; END IF;

    IF v_package.collected_at IS NOT NULL THEN
      RAISE EXCEPTION 'Package "%" has already been released', v_package.id;
    END IF;
    IF v_package.payment_status = 'paid' OR v_package.status = 'paid' THEN
      RAISE EXCEPTION 'Package "%" is already fully paid', v_package.id;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.payment_allocations a
      WHERE a.payment_notification_id = v_notification.id AND a.order_id = v_package.id
    ) THEN
      RAISE EXCEPTION 'This payment evidence is already linked to package "%"', v_package.id;
    END IF;

    SELECT COALESCE(SUM(a.allocated_amount), 0)
      INTO v_existing_package_total
    FROM public.payment_allocations a
    WHERE a.order_id = v_package.id;
    SELECT amount INTO v_amount FROM link_payment_rows WHERE package_id = v_package.id;
    IF v_package.cost IS NOT NULL AND v_package.cost > 0
       AND v_existing_package_total + v_amount > v_package.cost THEN
      RAISE EXCEPTION 'Allocation for package "%" exceeds its remaining balance', v_package.id;
    END IF;
    v_new_total := v_new_total + v_amount;
  END LOOP;

  SELECT COALESCE(SUM(a.allocated_amount), 0)
    INTO v_existing_evidence_total
  FROM public.payment_allocations a
  WHERE a.payment_notification_id = v_notification.id;
  IF v_notification.amount IS NOT NULL
     AND v_existing_evidence_total + v_new_total > v_notification.amount THEN
    RAISE EXCEPTION 'Allocations exceed the payment evidence amount';
  END IF;

  FOR v_package_id IN SELECT package_id FROM link_payment_rows ORDER BY package_id
  LOOP
    SELECT amount INTO v_amount FROM link_payment_rows WHERE package_id = v_package_id;
    v_id := 'PA-' || gen_random_uuid()::text;
    INSERT INTO public.payment_allocations(
      id, payment_notification_id, order_id, tracking_number, allocated_amount,
      linked_by, linked_at, notification_number
    ) VALUES (
      v_id, v_notification.id, v_package_id, v_package_id, v_amount,
      NULLIF(btrim(_linked_by), ''), now(), v_notification.notification_number
    );
  END LOOP;

  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id), '[]'::jsonb)
    INTO v_rows
  FROM public.cargo_packages p
  WHERE p.id IN (SELECT package_id FROM link_payment_rows);

  RETURN jsonb_build_object(
    'payment_notification_id', v_notification.id,
    'allocated_total', v_new_total,
    'packages', v_rows
  );
END;
$$;
REVOKE ALL ON FUNCTION public.link_payment_allocations(text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_payment_allocations(text, jsonb, text) TO service_role;

-- Release is physical collection, not a second cargo payment status.  It
-- stamps collected_at while retaining cargo status='paid', and audits the
-- transition in the legacy audit_logs shape used by the mobile backend.
CREATE OR REPLACE FUNCTION public.release_cargo_package(
  _package_id text,
  _actor_employee_id uuid,
  _actor text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_package public.cargo_packages;
  v_now timestamptz := now();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = _actor_employee_id
      AND e.is_active = true
      AND lower(e.role::text) IN ('admin', 'logistics_manager', 'sales_manager')
  ) THEN
    RAISE EXCEPTION 'Your account does not have permission to release packages';
  END IF;

  SELECT * INTO v_package
  FROM public.cargo_packages
  WHERE id = btrim(COALESCE(_package_id, ''))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Package was not found'; END IF;

  IF v_package.collected_at IS NOT NULL THEN
    RETURN to_jsonb(v_package);
  END IF;

  IF v_package.payment_status <> 'paid'
     AND NOT (
       v_package.paid_at IS NOT NULL
       OR lower(COALESCE(v_package.status, '')) IN ('paid', 'cleared', 'collected', 'released')
     ) THEN
    RAISE EXCEPTION 'Only paid packages can be released';
  END IF;

  UPDATE public.cargo_packages
  SET status = 'paid', collected_at = v_now, updated_at = now()
  WHERE id = v_package.id
  RETURNING * INTO v_package;

  INSERT INTO public.audit_logs(id, action, actor, timestamp, details)
  VALUES (
    'AL-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS') || '-' || substr(gen_random_uuid()::text, 1, 8),
    'RELEASE_PACKAGE',
    COALESCE(NULLIF(btrim(_actor), ''), _actor_employee_id::text),
    v_now,
    format('Package %s physically released; cargo status retained as paid.', COALESCE(v_package.tracking_number, v_package.id))
  );

  RETURN to_jsonb(v_package);
END;
$$;
REVOKE ALL ON FUNCTION public.release_cargo_package(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_cargo_package(text, uuid, text) TO service_role;

-- The existing audited unlink RPC must recalculate partial/unknown packages as
-- well as the old zero-allocation case.  Approved/paid commission history is
-- preserved; only pending payment commission is removed when settlement falls.
CREATE OR REPLACE FUNCTION public.admin_unlink_payment_allocation(
  _allocation_id text,
  _actor_employee_id uuid,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_allocation public.payment_allocations;
  v_package public.cargo_packages;
  v_notification public.payment_notifications;
  v_after_package public.cargo_packages;
  v_remaining_package_allocations integer;
  v_remaining_evidence_allocations integer;
  v_commissions_before jsonb := '[]'::jsonb;
  v_commissions_deleted integer := 0;
  v_after jsonb;
BEGIN
  IF _reason IS NULL OR length(trim(_reason)) < 5 THEN
    RAISE EXCEPTION 'A correction reason of at least 5 characters is required';
  END IF;

  SELECT * INTO v_allocation FROM public.payment_allocations
  WHERE id = _allocation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment allocation was not found'; END IF;

  SELECT * INTO v_notification FROM public.payment_notifications
  WHERE id = v_allocation.payment_notification_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment evidence was not found'; END IF;

  SELECT * INTO v_package FROM public.cargo_packages
  WHERE id = v_allocation.order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The linked package was not found'; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_commissions_before
  FROM public.commissions c
  WHERE c.cargo_package_id = v_package.id AND c.trigger = 'payment';

  DELETE FROM public.payment_allocations WHERE id = v_allocation.id;
  PERFORM public.recalculate_cargo_payment_state(v_package.id);

  SELECT count(*) INTO v_remaining_package_allocations
  FROM public.payment_allocations WHERE order_id = v_package.id;

  SELECT * INTO v_after_package FROM public.cargo_packages WHERE id = v_package.id;
  IF v_after_package.payment_status <> 'paid' THEN
    DELETE FROM public.commissions
    WHERE cargo_package_id = v_package.id AND trigger = 'payment' AND status = 'pending';
    GET DIAGNOSTICS v_commissions_deleted = ROW_COUNT;
  END IF;

  SELECT count(*) INTO v_remaining_evidence_allocations
  FROM public.payment_allocations WHERE payment_notification_id = v_notification.id;
  IF v_remaining_evidence_allocations = 0 THEN
    UPDATE public.payment_notifications
    SET status = 'PENDING', updated_at = now()
    WHERE id = v_notification.id;
  END IF;

  SELECT * INTO v_after_package FROM public.cargo_packages WHERE id = v_package.id;
  v_after := jsonb_build_object(
    'action', 'unlink_payment_allocation',
    'removed_allocation', to_jsonb(v_allocation),
    'package', to_jsonb(v_after_package),
    'payment_notification_status', CASE WHEN v_remaining_evidence_allocations = 0 THEN 'PENDING' ELSE 'LINKED' END,
    'remaining_package_allocations', v_remaining_package_allocations,
    'remaining_evidence_allocations', v_remaining_evidence_allocations,
    'payment_commissions_removed', v_commissions_deleted,
    'payment_commissions_before', v_commissions_before
  );

  INSERT INTO public.payment_control_audit(
    payment_notification_id, actor_employee_id, reason, before_record, after_record
  ) VALUES (
    v_notification.id, _actor_employee_id, trim(_reason),
    jsonb_build_object(
      'allocation', to_jsonb(v_allocation),
      'payment_notification', to_jsonb(v_notification),
      'package', to_jsonb(v_package),
      'payment_commissions', v_commissions_before
    ),
    v_after
  );

  RETURN v_after;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_unlink_payment_allocation(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unlink_payment_allocation(text, uuid, text) TO service_role;
