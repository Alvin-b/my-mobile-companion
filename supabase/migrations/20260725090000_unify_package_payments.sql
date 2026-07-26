-- Make public.packages the canonical shipment record for both clients.
-- cargo_packages is retained as a legacy source during the Android migration;
-- new writes must target packages using tracking_number as the external ID.

-- Bring existing Android-created shipments into the canonical model once.
INSERT INTO public.customers (full_name, phone)
SELECT DISTINCT ON (trim(phone))
  COALESCE(NULLIF(trim(consignee), ''), 'Unknown customer'),
  trim(phone)
FROM public.cargo_packages
WHERE NULLIF(trim(phone), '') IS NOT NULL
ON CONFLICT (phone) DO NOTHING;

INSERT INTO public.packages (
  tracking_number, customer_id, supplier, description, destination_city,
  weight_kg, amount_due, status, received_at, verified_at, ready_at, collected_at
)
SELECT
  c.id,
  customer.id,
  c.sales_rep,
  COALESCE(c.description, c.descr),
  c.dest,
  c.weight,
  COALESCE(c.cost, 0),
  CASE c.status
    WHEN 'registered' THEN 'awaiting_payment'::public.package_status
    WHEN 'paid' THEN 'paid'::public.package_status
    WHEN 'collected' THEN 'collected'::public.package_status
    ELSE 'received'::public.package_status
  END,
  c.registered_at,
  CASE WHEN c.status IN ('paid', 'collected') THEN c.paid_at ELSE NULL END,
  CASE WHEN c.status = 'collected' THEN c.collected_at ELSE NULL END,
  CASE WHEN c.status = 'collected' THEN c.collected_at ELSE NULL END
FROM public.cargo_packages AS c
LEFT JOIN public.customers AS customer ON customer.phone = trim(c.phone)
ON CONFLICT (tracking_number) DO NOTHING;

-- A Daraja callback can fail. The original constraint accepted only PENDING/LINKED.
ALTER TABLE public.payment_notifications
  DROP CONSTRAINT IF EXISTS payment_notifications_status_check;
ALTER TABLE public.payment_notifications
  ADD CONSTRAINT payment_notifications_status_check
  CHECK (status IN ('PENDING', 'LINKED', 'FAILED'));

-- A callback may be retried; one checkout request must create at most one payment.
CREATE UNIQUE INDEX IF NOT EXISTS payments_checkout_request_id_unique
  ON public.payments (checkout_request_id)
  WHERE checkout_request_id IS NOT NULL;

-- Apply a successful M-Pesa callback atomically and idempotently. This function
-- is called only by a server-side service-role client.
CREATE OR REPLACE FUNCTION public.apply_mpesa_payment(
  _notification_id text,
  _tracking_number text,
  _amount numeric,
  _receipt text,
  _phone text,
  _checkout_request_id text,
  _result_desc text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_package public.packages;
  v_payment_id uuid;
BEGIN
  -- Serialize duplicate callbacks using the notification row.
  PERFORM 1 FROM public.payment_notifications WHERE id = _notification_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment notification not found';
  END IF;

  SELECT id INTO v_payment_id
  FROM public.payments
  WHERE checkout_request_id = _checkout_request_id
  LIMIT 1;
  IF FOUND THEN
    RETURN v_payment_id;
  END IF;

  SELECT * INTO v_package
  FROM public.packages
  WHERE tracking_number = _tracking_number
  FOR UPDATE;
  IF NOT FOUND THEN
    -- Preserve the successful callback for staff review, but do not create an
    -- orphan payment or alter an unrelated package.
    UPDATE public.payment_notifications
      SET result_code = 0, result_desc = _result_desc, mpesa_receipt = NULLIF(_receipt, ''),
          sender_phone = NULLIF(_phone, ''), amount = _amount, status = 'PENDING', updated_at = now()
      WHERE id = _notification_id;
    RETURN NULL;
  END IF;

  INSERT INTO public.payments (
    package_id, amount, method, status, mpesa_receipt, phone,
    checkout_request_id, paid_at
  ) VALUES (
    v_package.id, _amount, 'mpesa_stk', 'paid', NULLIF(_receipt, ''),
    NULLIF(_phone, ''), NULLIF(_checkout_request_id, ''), now()
  )
  RETURNING id INTO v_payment_id;

  UPDATE public.payment_notifications
    SET result_code = 0, result_desc = _result_desc, mpesa_receipt = NULLIF(_receipt, ''),
        sender_phone = NULLIF(_phone, ''), amount = _amount, status = 'LINKED', updated_at = now()
    WHERE id = _notification_id;

  IF v_package.status NOT IN ('paid', 'ready_for_collection', 'collected', 'cleared') THEN
    INSERT INTO public.package_status_history(package_id, from_status, to_status, notes)
      VALUES (v_package.id, v_package.status, 'paid', 'M-Pesa ' || COALESCE(NULLIF(_receipt, ''), 'payment'));
    UPDATE public.packages SET status = 'paid' WHERE id = v_package.id;
  END IF;

  RETURN v_payment_id;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_mpesa_payment(text, text, numeric, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_mpesa_payment(text, text, numeric, text, text, text, text) TO service_role;

-- Commissions belong to the canonical package/payment IDs, not legacy cargo IDs.
DROP TRIGGER IF EXISTS trg_auto_commission_paid ON public.cargo_packages;

CREATE OR REPLACE FUNCTION public.auto_create_commission_for_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF NOT FOUND OR EXISTS (SELECT 1 FROM public.commissions WHERE payment_id = NEW.id) THEN RETURN NEW; END IF;
  v_amount := NEW.amount * COALESCE(v_rule.percentage, 0) / 100 + COALESCE(v_rule.flat_amount, 0);
  INSERT INTO public.commissions (employee_id, package_id, payment_id, trigger, amount, percentage)
    VALUES (v_employee.id, NEW.package_id, NEW.id, 'payment', v_amount, v_rule.percentage);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_auto_commission_for_payment ON public.payments;
CREATE TRIGGER trg_auto_commission_for_payment
  AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_commission_for_payment();

-- Keep a new deployment reproducible; all buckets are private.
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('package-photos', 'package-photos', false),
  ('sticker-photos', 'sticker-photos', false),
  ('signatures', 'signatures', false),
  ('proofs', 'proofs', false)
ON CONFLICT (id) DO NOTHING;
