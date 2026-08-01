-- 1. search_path on remaining function
CREATE OR REPLACE FUNCTION public.generate_tracking_number()
RETURNS text LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN RETURN 'DXC' || to_char(now(),'YYMMDD') || upper(substr(encode(gen_random_bytes(3),'hex'),1,6)); END; $function$;

-- 2. Lock down SECURITY DEFINER function execution
REVOKE EXECUTE ON FUNCTION public.apply_mpesa_payment(text,text,numeric,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_commission(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_commission_paid(uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transition_package_status(uuid, public.package_status, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pkg_after_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_payment_allocation_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_create_commission_for_payment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_create_commission_on_paid() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_tracking_number() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_commission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_commission_paid(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_package_status(uuid, public.package_status, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_tracking_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_mpesa_payment(text,text,numeric,text,text,text,text) TO service_role;

-- 3. profiles: own row, or admin
DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;
CREATE POLICY profiles_select_own_or_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));

-- 4. storage: explicit update/delete scoped to file owner or admin
DO $$
DECLARE b text;
BEGIN
  FOREACH b IN ARRAY ARRAY['package-photos','proofs','signatures','sticker-photos'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', 'owner update ' || b);
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', 'owner delete ' || b);
    EXECUTE format($f$CREATE POLICY %I ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = %L AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin')))
      WITH CHECK (bucket_id = %L AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin')))$f$,
      'owner update ' || b, b, b);
    EXECUTE format($f$CREATE POLICY %I ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = %L AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin')))$f$,
      'owner delete ' || b, b);
  END LOOP;
END $$;

-- 5. warehouse_bins: staff read, admin write
DROP POLICY IF EXISTS "staff manage bins" ON public.warehouse_bins;
CREATE POLICY "staff read bins" ON public.warehouse_bins
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "admins manage bins" ON public.warehouse_bins
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));