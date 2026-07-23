
ALTER TABLE public.payment_notifications
  ADD COLUMN IF NOT EXISTS checkout_request_id text,
  ADD COLUMN IF NOT EXISTS merchant_request_id text,
  ADD COLUMN IF NOT EXISTS account_reference text,
  ADD COLUMN IF NOT EXISTS mpesa_receipt text,
  ADD COLUMN IF NOT EXISTS result_code integer,
  ADD COLUMN IF NOT EXISTS result_desc text;

CREATE INDEX IF NOT EXISTS idx_payment_notifications_checkout_request_id
  ON public.payment_notifications(checkout_request_id);
