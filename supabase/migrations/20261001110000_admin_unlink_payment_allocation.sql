-- Admin-only, atomic reversal of a payment-evidence allocation.
-- The full before/after state is written to payment_control_audit in the same
-- transaction, so package state, evidence status, commissions and audit cannot
-- get out of sync if any step fails.
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

  SELECT * INTO v_allocation
  FROM public.payment_allocations
  WHERE id = _allocation_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment allocation was not found'; END IF;

  SELECT * INTO v_notification
  FROM public.payment_notifications
  WHERE id = v_allocation.payment_notification_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment evidence was not found'; END IF;

  SELECT * INTO v_package
  FROM public.cargo_packages
  WHERE id = v_allocation.order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The linked package was not found'; END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
    INTO v_commissions_before
  FROM public.commissions c
  WHERE c.cargo_package_id = v_package.id AND c.trigger = 'payment';

  DELETE FROM public.payment_allocations WHERE id = v_allocation.id;

  SELECT count(*) INTO v_remaining_package_allocations
  FROM public.payment_allocations WHERE order_id = v_package.id;

  IF v_remaining_package_allocations = 0 THEN
    -- Unlinking the final allocation returns the package to the unpaid queue.
    -- A group imported as one cargo_packages record therefore moves as a unit.
    UPDATE public.cargo_packages
    SET status = 'unpaid', paid_at = NULL, payment_ref = NULL,
        payment_method = NULL, updated_at = now()
    WHERE id = v_package.id;

    -- Payment-triggered commission rows are included in the audit snapshot
    -- above and removed along with the payment state they were generated from.
    DELETE FROM public.commissions
    WHERE cargo_package_id = v_package.id AND trigger = 'payment';
    GET DIAGNOSTICS v_commissions_deleted = ROW_COUNT;
  END IF;

  SELECT count(*) INTO v_remaining_evidence_allocations
  FROM public.payment_allocations
  WHERE payment_notification_id = v_notification.id;

  IF v_remaining_evidence_allocations = 0 THEN
    UPDATE public.payment_notifications
    SET status = 'PENDING', updated_at = now()
    WHERE id = v_notification.id;
  END IF;

  SELECT * INTO v_after_package
  FROM public.cargo_packages WHERE id = v_package.id;

  v_after := jsonb_build_object(
    'action', 'unlink_payment_allocation',
    'removed_allocation', to_jsonb(v_allocation),
    'package', to_jsonb(v_after_package),
    'payment_notification_status', CASE WHEN v_remaining_evidence_allocations = 0 THEN 'PENDING' ELSE v_notification.status END,
    'remaining_package_allocations', v_remaining_package_allocations,
    'remaining_evidence_allocations', v_remaining_evidence_allocations,
    'payment_commissions_removed', v_commissions_deleted,
    'payment_commissions_before', v_commissions_before
  );

  INSERT INTO public.payment_control_audit (
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
