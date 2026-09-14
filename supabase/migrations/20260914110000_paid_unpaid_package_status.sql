-- DEX exposes exactly two customer-facing package states:
-- unpaid (not yet linked to payment evidence) and paid (paid/cleared).
-- Historical operations states are normalised so every dashboard agrees.
ALTER TABLE public.cargo_packages DROP CONSTRAINT IF EXISTS cargo_packages_status_check;

UPDATE public.cargo_packages
SET status = CASE
  WHEN lower(coalesce(status, '')) IN ('paid', 'cleared', 'collected', 'released') THEN 'paid'
  ELSE 'unpaid'
END;

ALTER TABLE public.cargo_packages
  ADD CONSTRAINT cargo_packages_status_check CHECK (status IN ('unpaid', 'paid'));

CREATE OR REPLACE FUNCTION public.after_payment_allocation_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE v_total numeric;
BEGIN
  SELECT coalesce(sum(allocated_amount), 0) INTO v_total
  FROM public.payment_allocations WHERE order_id = NEW.order_id;

  UPDATE public.payment_notifications
    SET status = 'LINKED', updated_at = now()
    WHERE id = NEW.payment_notification_id;

  UPDATE public.cargo_packages
    SET status = 'paid',
        cost = CASE WHEN coalesce(cost, 0) = 0 THEN v_total ELSE cost END,
        paid_at = coalesce(paid_at, now()),
        payment_ref = coalesce(payment_ref, NEW.notification_number, NEW.payment_notification_id),
        payment_method = coalesce(payment_method, 'payment_evidence'),
        updated_at = now()
    WHERE id = NEW.order_id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_payment_allocation_after_insert ON public.payment_allocations;
CREATE TRIGGER trg_payment_allocation_after_insert
  AFTER INSERT ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.after_payment_allocation_insert();

REVOKE EXECUTE ON FUNCTION public.after_payment_allocation_insert() FROM public, anon, authenticated;

-- A legacy BEFORE trigger may exist on older deployments. It must write the
-- canonical paid state too, otherwise it could attempt to write "cleared"
-- before the AFTER trigger runs.
CREATE OR REPLACE FUNCTION public.on_payment_allocation_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE v_pkg public.cargo_packages;
BEGIN
  SELECT * INTO v_pkg FROM public.cargo_packages
  WHERE id = coalesce(nullif(trim(NEW.order_id), ''), nullif(trim(NEW.tracking_number), ''))
     OR lower(tracking_number) = lower(coalesce(nullif(trim(NEW.order_id), ''), nullif(trim(NEW.tracking_number), '')))
  ORDER BY registered_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cannot link payment: no package found'; END IF;
  NEW.order_id := v_pkg.id;
  NEW.tracking_number := v_pkg.id;
  UPDATE public.cargo_packages
    SET status = 'paid', paid_at = coalesce(paid_at, now()),
        payment_ref = coalesce(payment_ref, NEW.notification_number, NEW.payment_notification_id),
        payment_method = coalesce(payment_method, 'payment_evidence'), updated_at = now()
    WHERE id = v_pkg.id;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.on_payment_allocation_insert() FROM public, anon, authenticated;
