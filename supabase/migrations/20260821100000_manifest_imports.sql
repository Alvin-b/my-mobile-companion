-- Excel manifest import metadata. General = normal air cargo; special = special
-- air cargo; sea = sea cargo. Package images are intentionally not part of this
-- workflow: the manifest is the authoritative intake source.
ALTER TABLE public.cargo_packages ADD COLUMN IF NOT EXISTS cargo_category text NOT NULL DEFAULT 'general'
  CHECK (cargo_category IN ('general','special','sea'));
ALTER TABLE public.cargo_packages ADD COLUMN IF NOT EXISTS volume_cbm numeric(12,3);
ALTER TABLE public.cargo_packages ADD COLUMN IF NOT EXISTS manifest_id text;
ALTER TABLE public.cargo_packages ADD COLUMN IF NOT EXISTS manifest_name text;
ALTER TABLE public.cargo_packages ADD COLUMN IF NOT EXISTS imported_by uuid REFERENCES auth.users(id);
ALTER TABLE public.cargo_packages ADD COLUMN IF NOT EXISTS imported_at timestamptz;
CREATE INDEX IF NOT EXISTS cargo_packages_manifest_idx ON public.cargo_packages(manifest_id, cargo_category);

CREATE TABLE IF NOT EXISTS public.manifest_imports (
  id text PRIMARY KEY, category text NOT NULL CHECK (category IN ('general','special','sea')),
  source_file_name text NOT NULL, total_rows integer NOT NULL DEFAULT 0, imported_rows integer NOT NULL DEFAULT 0,
  duplicate_rows integer NOT NULL DEFAULT 0, invalid_rows integer NOT NULL DEFAULT 0,
  imported_by uuid REFERENCES auth.users(id), imported_at timestamptz NOT NULL DEFAULT now(), notes jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.manifest_imports ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.manifest_imports TO authenticated;
DROP POLICY IF EXISTS manifest_imports_admin_sales_manager_read ON public.manifest_imports;
CREATE POLICY manifest_imports_admin_sales_manager_read ON public.manifest_imports FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.employees e WHERE e.user_id=auth.uid() AND e.is_active AND e.role IN ('sales_manager','sm')));
