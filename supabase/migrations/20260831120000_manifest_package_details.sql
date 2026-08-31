-- Preserve every source manifest field on the package record.
-- This is intentionally JSON so sea, special, and general layouts can evolve
-- without dropping columns that are unique to one manifest format.
ALTER TABLE public.cargo_packages
  ADD COLUMN IF NOT EXISTS manifest_data jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS cargo_packages_manifest_data_gin
  ON public.cargo_packages USING gin (manifest_data);
