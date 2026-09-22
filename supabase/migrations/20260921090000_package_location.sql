-- A separate manual warehouse-location field.  Container position remains
-- manifest metadata; location is maintained by DEX warehouse operations.
alter table public.cargo_packages
  add column if not exists location text;

alter table public.cargo_packages
  drop constraint if exists cargo_packages_location_length_check;

alter table public.cargo_packages
  add constraint cargo_packages_location_length_check
  check (location is null or char_length(location) <= 100);
