-- Canonical values extracted from every DEX manifest layout. The original
-- source row remains intact in manifest_data for future columns/layouts.
ALTER TABLE public.cargo_packages
  ADD COLUMN IF NOT EXISTS chargeable_weight numeric(12,3),
  ADD COLUMN IF NOT EXISTS unit_price_usd numeric(14,2),
  ADD COLUMN IF NOT EXISTS total_price_rmb numeric(16,2),
  ADD COLUMN IF NOT EXISTS total_price_usd numeric(16,2),
  ADD COLUMN IF NOT EXISTS total_price_kes numeric(16,2),
  ADD COLUMN IF NOT EXISTS payment_mode text,
  ADD COLUMN IF NOT EXISTS manifest_line_date text,
  ADD COLUMN IF NOT EXISTS manifest_signature text,
  ADD COLUMN IF NOT EXISTS warehouse_received_date text,
  ADD COLUMN IF NOT EXISTS warehouse_receipt_number text,
  ADD COLUMN IF NOT EXISTS container_position text,
  ADD COLUMN IF NOT EXISTS billing_formula text,
  ADD COLUMN IF NOT EXISTS billing_amount numeric(16,2),
  ADD COLUMN IF NOT EXISTS billing_currency text,
  ADD COLUMN IF NOT EXISTS billing_rate numeric(16,4);

CREATE INDEX IF NOT EXISTS cargo_packages_manifest_category_tracking_idx
  ON public.cargo_packages (cargo_category, tracking_number);
