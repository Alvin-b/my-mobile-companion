REVOKE EXECUTE ON FUNCTION public.auto_create_commission_on_paid() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.auto_create_commission_for_payment() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.on_payment_allocation_insert() FROM anon, authenticated, public;