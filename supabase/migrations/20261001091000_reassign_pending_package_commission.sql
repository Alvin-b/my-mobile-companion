-- If sales attribution is corrected after a package was paid, refresh its
-- pending commission under the new eligible employee. Approved/paid rows are
-- deliberately preserved for finance auditability.
CREATE OR REPLACE FUNCTION public.auto_create_commission_on_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF NEW.status = 'paid' AND TG_OP = 'UPDATE'
     AND OLD.commission_employee_id IS DISTINCT FROM NEW.commission_employee_id THEN
    DELETE FROM public.commissions
      WHERE cargo_package_id = NEW.id
        AND trigger = 'payment'
        AND status = 'pending';
  END IF;
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid' OR OLD.commission_employee_id IS DISTINCT FROM NEW.commission_employee_id) THEN
    PERFORM public.create_cargo_commission_if_eligible(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_commission_paid ON public.cargo_packages;
CREATE TRIGGER trg_auto_commission_paid
  AFTER INSERT OR UPDATE OF status, commission_employee_id ON public.cargo_packages
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_commission_on_paid();
REVOKE ALL ON FUNCTION public.auto_create_commission_on_paid() FROM public, anon, authenticated;
