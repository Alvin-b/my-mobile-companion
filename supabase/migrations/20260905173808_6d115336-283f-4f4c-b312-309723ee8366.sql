-- 1. Receipt counters (uninterrupted ascending series per receipt label)
CREATE TABLE public.finance_receipt_counters (
  label text PRIMARY KEY,
  last_number bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.finance_receipt_counters TO authenticated;
GRANT ALL ON public.finance_receipt_counters TO service_role;
ALTER TABLE public.finance_receipt_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance staff can view receipt counters"
  ON public.finance_receipt_counters FOR SELECT TO authenticated
  USING (public.is_finance_manager(auth.uid()) OR public.is_admin(auth.uid()));

INSERT INTO public.finance_receipt_counters(label) VALUES ('NS'),('NC'),('CS'),('CC'),('TS'),('TC'),('PS');

-- 2. Invoice header fields required by the TIS/VSCU spec
ALTER TABLE public.finance_invoices
  ADD COLUMN IF NOT EXISTS receipt_label text,
  ADD COLUMN IF NOT EXISTS receipt_number bigint,
  ADD COLUMN IF NOT EXISTS invoice_seq bigint,
  ADD COLUMN IF NOT EXISTS payment_type_code text NOT NULL DEFAULT '06',
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'KES',
  ADD COLUMN IF NOT EXISTS exchange_rate numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS customer_address text,
  ADD COLUMN IF NOT EXISTS customer_email text,
  ADD COLUMN IF NOT EXISTS original_invoice_number text,
  ADD COLUMN IF NOT EXISTS credit_note_reason_code text,
  ADD COLUMN IF NOT EXISTS total_discount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_amount_a numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_amount_b numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_amount_c numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_amount_d numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_amount_e numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount_a numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount_b numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount_c numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount_d numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount_e numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scu_id text,
  ADD COLUMN IF NOT EXISTS scu_receipt_number bigint,
  ADD COLUMN IF NOT EXISTS scu_total_receipt_counter bigint,
  ADD COLUMN IF NOT EXISTS scu_receipt_signature text,
  ADD COLUMN IF NOT EXISTS scu_internal_data text,
  ADD COLUMN IF NOT EXISTS scu_receipt_date timestamptz,
  ADD COLUMN IF NOT EXISTS scu_qr_url text;

ALTER TABLE public.finance_invoices
  DROP CONSTRAINT IF EXISTS finance_invoices_receipt_label_check;
ALTER TABLE public.finance_invoices
  ADD CONSTRAINT finance_invoices_receipt_label_check
  CHECK (receipt_label IS NULL OR receipt_label IN ('NS','NC','CS','CC','TS','TC','PS'));

ALTER TABLE public.finance_invoices
  DROP CONSTRAINT IF EXISTS finance_invoices_payment_type_code_check;
ALTER TABLE public.finance_invoices
  ADD CONSTRAINT finance_invoices_payment_type_code_check
  CHECK (payment_type_code IN ('01','02','03','04','05','06','07'));

CREATE UNIQUE INDEX IF NOT EXISTS finance_invoices_label_receipt_no_idx
  ON public.finance_invoices(receipt_label, receipt_number)
  WHERE receipt_label IS NOT NULL AND receipt_number IS NOT NULL;

-- 3. Invoice line fields required by the spec
ALTER TABLE public.finance_invoice_items
  ADD COLUMN IF NOT EXISTS item_seq integer,
  ADD COLUMN IF NOT EXISTS item_code text,
  ADD COLUMN IF NOT EXISTS item_class_code text,
  ADD COLUMN IF NOT EXISTS packaging_unit_code text NOT NULL DEFAULT 'NT',
  ADD COLUMN IF NOT EXISTS quantity_unit_code text NOT NULL DEFAULT 'U',
  ADD COLUMN IF NOT EXISTS tax_class_code text NOT NULL DEFAULT 'B',
  ADD COLUMN IF NOT EXISTS tax_rate numeric NOT NULL DEFAULT 16,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.finance_invoice_items
  DROP CONSTRAINT IF EXISTS finance_invoice_items_tax_class_check;
ALTER TABLE public.finance_invoice_items
  ADD CONSTRAINT finance_invoice_items_tax_class_check
  CHECK (tax_class_code IN ('A','B','C','D','E'));

-- 4. Assign receipt label + ascending receipt number on insert
CREATE OR REPLACE FUNCTION public.finance_assign_receipt_label()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
  v_next bigint;
BEGIN
  IF NEW.receipt_label IS NULL THEN
    v_label := CASE upper(coalesce(NEW.etims_receipt_type,'NORMAL'))
        WHEN 'NORMAL'   THEN 'N'
        WHEN 'COPY'     THEN 'C'
        WHEN 'TRAINING' THEN 'T'
        WHEN 'PROFORMA' THEN 'P'
        ELSE 'N' END
      || CASE upper(coalesce(NEW.etims_transaction_type,'SALE'))
        WHEN 'CREDIT NOTE' THEN 'C'
        WHEN 'CREDIT_NOTE' THEN 'C'
        WHEN 'CREDITNOTE'  THEN 'C'
        ELSE 'S' END;
    IF v_label = 'PC' THEN v_label := 'PS'; END IF;
    NEW.receipt_label := v_label;
  END IF;

  IF NEW.receipt_number IS NULL THEN
    INSERT INTO public.finance_receipt_counters(label, last_number, updated_at)
    VALUES (NEW.receipt_label, 1, now())
    ON CONFLICT (label) DO UPDATE
      SET last_number = public.finance_receipt_counters.last_number + 1,
          updated_at = now()
    RETURNING last_number INTO v_next;
    NEW.receipt_number := v_next;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finance_assign_receipt_label() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS finance_invoices_assign_receipt_label ON public.finance_invoices;
CREATE TRIGGER finance_invoices_assign_receipt_label
  BEFORE INSERT ON public.finance_invoices
  FOR EACH ROW EXECUTE FUNCTION public.finance_assign_receipt_label();