
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE public.app_role AS ENUM ('admin','sales_manager','logistics_manager','sales_rep');
CREATE TYPE public.package_status AS ENUM ('received','verified','awaiting_payment','paid','ready_for_collection','collected','cleared');
CREATE TYPE public.payment_method AS ENUM ('mpesa_stk','mpesa_manual','cash','bank');
CREATE TYPE public.payment_status AS ENUM ('pending','paid','failed','refunded','cancelled');
CREATE TYPE public.commission_trigger AS ENUM ('received','payment','delivery');
CREATE TYPE public.commission_status AS ENUM ('pending','approved','paid');
CREATE TYPE public.image_kind AS ENUM ('sticker','extra','proof_of_collection','qr','signature');
CREATE TYPE public.notification_audience AS ENUM ('admin','employee','customer');

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  employee_code TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  role public.app_role NOT NULL DEFAULT 'sales_rep',
  commission_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role);
$$;
CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.employees e WHERE e.user_id=_user_id AND e.is_active=true);
$$;
CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'admin');
$$;

CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "admin manage roles" ON public.user_roles FOR ALL TO authenticated
USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "staff read employees" ON public.employees FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()) OR user_id = auth.uid());
CREATE POLICY "admin write employees" ON public.employees FOR ALL TO authenticated
USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL,
  whatsapp_number TEXT, national_id TEXT, email TEXT,
  default_address TEXT, city TEXT, notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "staff manage customers" ON public.customers FOR ALL TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, city TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouses TO authenticated;
GRANT ALL ON public.warehouses TO service_role;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read wh" ON public.warehouses FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "admin write wh" ON public.warehouses FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE TABLE public.warehouse_shelves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  code TEXT NOT NULL, section TEXT, capacity INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(warehouse_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_shelves TO authenticated;
GRANT ALL ON public.warehouse_shelves TO service_role;
ALTER TABLE public.warehouse_shelves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read shelves" ON public.warehouse_shelves FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "admin write shelves" ON public.warehouse_shelves FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE TABLE public.warehouse_bins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shelf_id UUID NOT NULL REFERENCES public.warehouse_shelves(id) ON DELETE CASCADE,
  code TEXT NOT NULL, is_occupied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shelf_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_bins TO authenticated;
GRANT ALL ON public.warehouse_bins TO service_role;
ALTER TABLE public.warehouse_bins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage bins" ON public.warehouse_bins FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.generate_tracking_number()
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN RETURN 'DXC' || to_char(now(),'YYMMDD') || upper(substr(encode(gen_random_bytes(3),'hex'),1,6)); END; $$;

CREATE TABLE public.packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_number TEXT UNIQUE NOT NULL DEFAULT public.generate_tracking_number(),
  external_barcode TEXT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  supplier TEXT, description TEXT, category TEXT,
  weight_kg NUMERIC(10,2), length_cm NUMERIC(10,2), width_cm NUMERIC(10,2), height_cm NUMERIC(10,2),
  courier TEXT, destination_city TEXT, special_notes TEXT,
  status public.package_status NOT NULL DEFAULT 'received',
  amount_due NUMERIC(12,2) DEFAULT 0, currency TEXT NOT NULL DEFAULT 'KES',
  qr_code_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  barcode TEXT,
  warehouse_id UUID REFERENCES public.warehouses(id),
  shelf_id UUID REFERENCES public.warehouse_shelves(id),
  bin_code TEXT,
  intake_photo_url TEXT, ocr_payload JSONB, ocr_confidence NUMERIC(5,2),
  received_by_employee_id UUID REFERENCES public.employees(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ, ready_at TIMESTAMPTZ, collected_at TIMESTAMPTZ, cleared_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.packages TO authenticated;
GRANT ALL ON public.packages TO service_role;
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_packages_updated BEFORE UPDATE ON public.packages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_packages_status ON public.packages(status);
CREATE INDEX idx_packages_customer ON public.packages(customer_id);
CREATE INDEX idx_packages_received ON public.packages(received_at DESC);
CREATE POLICY "staff manage packages" ON public.packages FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.package_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  kind public.image_kind NOT NULL, url TEXT NOT NULL,
  uploaded_by UUID REFERENCES public.employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.package_images TO authenticated;
GRANT ALL ON public.package_images TO service_role;
ALTER TABLE public.package_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage pkg images" ON public.package_images FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.package_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  from_status public.package_status, to_status public.package_status NOT NULL,
  notes TEXT, changed_by_employee_id UUID REFERENCES public.employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.package_status_history TO authenticated;
GRANT ALL ON public.package_status_history TO service_role;
ALTER TABLE public.package_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read history" ON public.package_status_history FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff insert history" ON public.package_status_history FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.transition_package_status(_package_id UUID, _to public.package_status, _by UUID DEFAULT NULL, _notes TEXT DEFAULT NULL)
RETURNS public.packages LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.packages;
BEGIN
  SELECT * INTO p FROM public.packages WHERE id=_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'package not found'; END IF;
  INSERT INTO public.package_status_history(package_id,from_status,to_status,notes,changed_by_employee_id)
    VALUES (_package_id, p.status, _to, _notes, _by);
  UPDATE public.packages SET
    status=_to,
    verified_at=CASE WHEN _to='verified' THEN now() ELSE verified_at END,
    ready_at=CASE WHEN _to='ready_for_collection' THEN now() ELSE ready_at END,
    collected_at=CASE WHEN _to='collected' THEN now() ELSE collected_at END,
    cleared_at=CASE WHEN _to='cleared' THEN now() ELSE cleared_at END
  WHERE id=_package_id RETURNING * INTO p;
  RETURN p;
END; $$;

CREATE OR REPLACE FUNCTION public.pkg_after_insert() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.package_status_history(package_id,to_status,changed_by_employee_id) VALUES (NEW.id, NEW.status, NEW.received_by_employee_id);
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_pkg_after_insert AFTER INSERT ON public.packages FOR EACH ROW EXECUTE FUNCTION public.pkg_after_insert();

CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL, currency TEXT NOT NULL DEFAULT 'KES',
  method public.payment_method NOT NULL, status public.payment_status NOT NULL DEFAULT 'pending',
  mpesa_receipt TEXT, phone TEXT, checkout_request_id TEXT, receipt_url TEXT,
  received_by_employee_id UUID REFERENCES public.employees(id),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_payments_package ON public.payments(package_id);
CREATE POLICY "staff manage payments" ON public.payments FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.commission_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.app_role, employee_id UUID REFERENCES public.employees(id) ON DELETE CASCADE,
  trigger public.commission_trigger NOT NULL,
  percentage NUMERIC(5,2) DEFAULT 0, flat_amount NUMERIC(12,2) DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commission_rules TO authenticated;
GRANT ALL ON public.commission_rules TO service_role;
ALTER TABLE public.commission_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read rules" ON public.commission_rules FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "admin write rules" ON public.commission_rules FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE TABLE public.commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  package_id UUID REFERENCES public.packages(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  trigger public.commission_trigger NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0, percentage NUMERIC(5,2),
  status public.commission_status NOT NULL DEFAULT 'pending',
  approved_by UUID REFERENCES public.employees(id), approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commissions TO authenticated;
GRANT ALL ON public.commissions TO service_role;
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_commissions_employee ON public.commissions(employee_id);
CREATE POLICY "staff read own commissions" ON public.commissions FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()) OR employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()));
CREATE POLICY "admin write commissions" ON public.commissions FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE TABLE public.deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  collected_by_name TEXT NOT NULL, collected_by_id_number TEXT,
  collected_by_phone TEXT, relationship_to_customer TEXT,
  signature_url TEXT, proof_photo_url TEXT,
  released_by_employee_id UUID REFERENCES public.employees(id),
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deliveries TO authenticated;
GRANT ALL ON public.deliveries TO service_role;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage deliveries" ON public.deliveries FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.whatsapp_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  package_id UUID REFERENCES public.packages(id) ON DELETE SET NULL,
  template TEXT NOT NULL, payload JSONB,
  status TEXT NOT NULL DEFAULT 'queued', provider_message_id TEXT, error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_logs TO authenticated;
GRANT ALL ON public.whatsapp_logs TO service_role;
ALTER TABLE public.whatsapp_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read wa" ON public.whatsapp_logs FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff insert wa" ON public.whatsapp_logs FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audience public.notification_audience NOT NULL DEFAULT 'employee',
  employee_id UUID REFERENCES public.employees(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT, data JSONB, read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own notifications" ON public.notifications FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()) OR employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()));
CREATE POLICY "update own notifications" ON public.notifications FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid()) OR employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()));
CREATE POLICY "staff insert notifications" ON public.notifications FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID, actor_employee_id UUID REFERENCES public.employees(id),
  resource_type TEXT NOT NULL, resource_id UUID, action TEXT NOT NULL,
  before JSONB, after JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read audit" ON public.audit_logs FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "staff insert audit" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.settings (
  key TEXT PRIMARY KEY, value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read settings" ON public.settings FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "admin write settings" ON public.settings FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- Storage object policies
CREATE POLICY "staff read sticker" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='sticker-photos' AND public.is_staff(auth.uid()));
CREATE POLICY "staff write sticker" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='sticker-photos' AND public.is_staff(auth.uid()));
CREATE POLICY "staff read pkg photos" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='package-photos' AND public.is_staff(auth.uid()));
CREATE POLICY "staff write pkg photos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='package-photos' AND public.is_staff(auth.uid()));
CREATE POLICY "staff read sig" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='signatures' AND public.is_staff(auth.uid()));
CREATE POLICY "staff write sig" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='signatures' AND public.is_staff(auth.uid()));
CREATE POLICY "staff read proofs" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='proofs' AND public.is_staff(auth.uid()));
CREATE POLICY "staff write proofs" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='proofs' AND public.is_staff(auth.uid()));
