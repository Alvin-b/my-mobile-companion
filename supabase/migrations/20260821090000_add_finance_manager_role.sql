-- Finance Manager is a staff role for the Finance dashboard and reconciliation
-- workflow.  It deliberately has no commission rule: finance users do not earn
-- package commissions.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'finance_manager';

-- A finance employee must be allowed to read the shared operational tables
-- used by the finance dashboard. Existing policies use is_staff(), which is
-- based on an active employees row, so no broad administrator permission is
-- granted by this migration.
