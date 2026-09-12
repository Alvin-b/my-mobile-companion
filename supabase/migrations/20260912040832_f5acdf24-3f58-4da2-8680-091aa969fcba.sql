CREATE SEQUENCE IF NOT EXISTS public.cargo_package_seq;
GRANT USAGE, SELECT ON SEQUENCE public.cargo_package_seq TO authenticated, service_role;

ALTER TABLE public.cargo_packages
  ALTER COLUMN id SET DEFAULT ('DXP-' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('public.cargo_package_seq')::text, 4, '0'));

CREATE INDEX IF NOT EXISTS cargo_packages_tracking_idx ON public.cargo_packages (upper(regexp_replace(coalesce(tracking_number, ''), '[^A-Za-z0-9]', '', 'g')));
CREATE INDEX IF NOT EXISTS cargo_packages_phone_idx ON public.cargo_packages (phone);
CREATE INDEX IF NOT EXISTS cargo_packages_status_idx ON public.cargo_packages (status);