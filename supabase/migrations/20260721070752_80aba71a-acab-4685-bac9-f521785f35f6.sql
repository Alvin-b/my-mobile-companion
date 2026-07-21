
-- 1. Extend role enum with mobile short codes
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'sr';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'lm';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'sm';

-- 2. PROFILES table
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  email text,
  is_active boolean NOT NULL DEFAULT true,
  pin_hash text,
  biometric_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_authenticated" ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile row on new auth user
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Backfill profiles for existing users
INSERT INTO public.profiles (id, email, name)
SELECT u.id, u.email, COALESCE(e.full_name, u.email)
FROM auth.users u
LEFT JOIN public.employees e ON e.user_id = u.id
ON CONFLICT (id) DO NOTHING;

-- 3. CARGO_PACKAGES table (matches mobile spec exactly)
CREATE TABLE IF NOT EXISTS public.cargo_packages (
  id text PRIMARY KEY,
  consignee text NOT NULL,
  phone text,
  origin text,
  dest text,
  description text,
  mode text,
  weight numeric(10,2),
  pcs integer,
  cost numeric(12,2),
  sales_rep text,
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','paid','collected')),
  registered_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  collected_at timestamptz,
  collector_name text,
  collector_id text,
  collector_phone text,
  payment_method text,
  payment_ref text,
  package_photo_url text,
  package_photo_captured_at timestamptz,
  package_photo_captured_by text,
  signature_points text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cargo_packages TO authenticated;
GRANT ALL ON public.cargo_packages TO service_role;
ALTER TABLE public.cargo_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cargo_packages_all_staff" ON public.cargo_packages
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER cargo_packages_updated_at BEFORE UPDATE ON public.cargo_packages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_cargo_packages_registered_at ON public.cargo_packages(registered_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargo_packages_status ON public.cargo_packages(status);
CREATE INDEX IF NOT EXISTS idx_cargo_packages_phone ON public.cargo_packages(phone);

-- 4. PAYMENT_NOTIFICATIONS table
CREATE TABLE IF NOT EXISTS public.payment_notifications (
  id text PRIMARY KEY,
  notification_number text UNIQUE NOT NULL,
  evidence_type text NOT NULL CHECK (evidence_type IN ('IMAGE','TEXT')),
  image_url text,
  text_content text,
  uploaded_by text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','LINKED')),
  amount numeric(12,2),
  sender_phone text,
  "timestamp" timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_notifications TO authenticated;
GRANT ALL ON public.payment_notifications TO service_role;
ALTER TABLE public.payment_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_notifications_all_staff" ON public.payment_notifications
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER payment_notifications_updated_at BEFORE UPDATE ON public.payment_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_payment_notifications_status ON public.payment_notifications(status);
CREATE INDEX IF NOT EXISTS idx_payment_notifications_uploaded_at ON public.payment_notifications(uploaded_at DESC);

-- 5. PAYMENT_ALLOCATIONS table
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id text PRIMARY KEY,
  payment_notification_id text NOT NULL REFERENCES public.payment_notifications(id) ON DELETE CASCADE,
  order_id text NOT NULL,
  tracking_number text NOT NULL,
  allocated_amount numeric(12,2) NOT NULL,
  linked_by text,
  linked_at timestamptz NOT NULL DEFAULT now(),
  notification_number text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_allocations TO authenticated;
GRANT ALL ON public.payment_allocations TO service_role;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_allocations_all_staff" ON public.payment_allocations
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_payment_allocations_notif ON public.payment_allocations(payment_notification_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_order ON public.payment_allocations(order_id);

-- Trigger: when an allocation is inserted, mark notification as LINKED and cargo as paid
CREATE OR REPLACE FUNCTION public.on_payment_allocation_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.payment_notifications
    SET status = 'LINKED', updated_at = now()
    WHERE id = NEW.payment_notification_id;
  UPDATE public.cargo_packages
    SET status = CASE WHEN status = 'registered' THEN 'paid' ELSE status END,
        paid_at = COALESCE(paid_at, now()),
        payment_ref = COALESCE(payment_ref, NEW.notification_number),
        updated_at = now()
    WHERE id = NEW.order_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payment_allocation_insert ON public.payment_allocations;
CREATE TRIGGER trg_payment_allocation_insert
  AFTER INSERT ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.on_payment_allocation_insert();

-- 6. RPCs for commissions
CREATE OR REPLACE FUNCTION public.approve_commission(_id uuid)
RETURNS public.commissions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.commissions;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'sales_manager') OR public.has_role(auth.uid(), 'sm')) THEN
    RAISE EXCEPTION 'Forbidden: manager or admin only';
  END IF;
  UPDATE public.commissions
    SET status = 'approved', approved_at = now(), approved_by = auth.uid()
    WHERE id = _id
    RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'commission not found'; END IF;
  RETURN r;
END $$;
GRANT EXECUTE ON FUNCTION public.approve_commission(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_commission_paid(_id uuid, _reference text)
RETURNS public.commissions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.commissions;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'sales_manager') OR public.has_role(auth.uid(), 'sm')) THEN
    RAISE EXCEPTION 'Forbidden: manager or admin only';
  END IF;
  UPDATE public.commissions
    SET status = 'paid', paid_at = now(), payment_reference = _reference
    WHERE id = _id
    RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'commission not found'; END IF;
  RETURN r;
END $$;
GRANT EXECUTE ON FUNCTION public.mark_commission_paid(uuid, text) TO authenticated;

-- Ensure user_roles is readable by authenticated (mobile queries it directly)
GRANT SELECT ON public.user_roles TO authenticated;
