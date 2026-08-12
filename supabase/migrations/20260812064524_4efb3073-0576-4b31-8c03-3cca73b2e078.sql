ALTER TABLE public.cargo_packages ADD COLUMN IF NOT EXISTS tracking_number text;
UPDATE public.cargo_packages SET tracking_number = id WHERE tracking_number IS NULL OR btrim(tracking_number) = '';

CREATE OR REPLACE FUNCTION public.cargo_normalize_before_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_sea boolean;
BEGIN
  NEW.id := btrim(coalesce(NEW.id, ''));
  IF NEW.id = '' THEN RAISE EXCEPTION 'Package id/tracking number is required'; END IF;

  NEW.tracking_number := nullif(btrim(coalesce(NEW.tracking_number, '')), '');
  IF NEW.tracking_number IS NULL THEN NEW.tracking_number := NEW.id; END IF;

  v_sea := coalesce(NEW.mode, '') ILIKE '%sea%';

  IF TG_OP = 'INSERT' AND NOT v_sea THEN
    IF EXISTS (
      SELECT 1 FROM public.cargo_packages p
      WHERE lower(p.tracking_number) = lower(NEW.tracking_number)
        AND coalesce(p.mode, '') NOT ILIKE '%sea%'
    ) THEN
      RAISE EXCEPTION 'Tracking number % is already registered', NEW.tracking_number
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  IF NEW.status IN ('paid', 'cleared') AND NEW.paid_at IS NULL THEN
    NEW.paid_at := now();
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cargo_normalize ON public.cargo_packages;
CREATE TRIGGER trg_cargo_normalize BEFORE INSERT OR UPDATE ON public.cargo_packages
FOR EACH ROW EXECUTE FUNCTION public.cargo_normalize_before_write();

CREATE UNIQUE INDEX IF NOT EXISTS cargo_packages_tracking_unique_non_sea
  ON public.cargo_packages (lower(tracking_number))
  WHERE coalesce(mode, '') NOT ILIKE '%sea%';

CREATE OR REPLACE FUNCTION public.on_payment_allocation_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  UPDATE public.cargo_packages
    SET status = CASE WHEN status IN ('collected', 'cleared', 'released') THEN status ELSE 'paid' END,
        cost = CASE WHEN coalesce(cost, 0) = 0 THEN NEW.allocated_amount ELSE cost END,
        paid_at = COALESCE(paid_at, now()),
        payment_ref = COALESCE(payment_ref, NEW.notification_number, NEW.payment_notification_id),
        payment_method = COALESCE(payment_method, 'mpesa'),
        updated_at = now()
    WHERE id = v_pkg.id;

  RETURN NEW;
END $$;