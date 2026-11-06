# DEXCARGO desktop console outcomes

**Implementation status:** Desktop changes are implemented and pass build/type checks. Apply `supabase/migrations/20261106090000_payment_state_and_control.sql` to the Supabase database before deploying the updated app; this workspace did not have a database connection for applying it.

## Payment control and package payment states
- [x] Administrators can edit the total amount and message details linked to payment evidence, preserving the existing reasoned audit trail.
- [x] Package payment states are `unpaid`, `part_paid`, `paid`, and `invoice`; allocations can be split and additional payment evidence can be linked to a partially paid tracking number.
- [x] Payment control supports linking one payment to additional tracking numbers and separate payment records to the same tracking number.
- [x] The desktop Payments screen no longer offers payment-evidence upload; staff link existing evidence only.
- [x] Only administrators can delete payment evidence, enforced in the UI, server API, and database row-security policies.

## Package operations and workspace
- [x] Cargo release is a separate desktop action, available only after full payment and hidden after release. Payment recording/linking is separate from physical handover.
- [x] Route/freight details are removed from package views.
- [x] Desktop tracking remains hidden; manifest import navigation, upload/preview, and commit workflow are restored. Mobile screens/builds are unchanged.
- [x] Warehouse packages use the shared searchable package list.
- [x] Live package lists have a larger scroll area and prominent scroll controls across roles.

## Sales attribution and commissions
- [x] Staff can link a package/tracking number to its commission owner; assigned packages show immediately in the commission view.
- [x] Payable commissions continue to follow the existing full-payment rule.
- [x] Administrators can filter commissions by employee, month/year, and status, and see both filtered and all-staff totals.
- [x] Every non-admin desktop role has a personal commission view; admin reports load the complete selected period from the protected report endpoint.
- [x] Non-admin dashboards show personal monthly/yearly commission totals, sales, and customer counts; the Admin dashboard shows the company operations/revenue snapshot.

## Staff administration
- [x] Administrators can update staff email, role, and password from the staff profile editor, alongside existing profile fields.

## Deferred mobile work
- Phone/mobile UI changes and automatic in-app mobile updates remain deferred as requested.

## Previously delivered desktop migration outcomes
- [x] The app root renders the DEX Admin desktop console and administrator sign-in instead of the previous mobile login, dashboard, scan, package, customer, notification, and commission screens.
- [x] The desktop console retains its internal operational views for overview, packages, payments, staff, commissions, finance, announcements, and audit.
- [x] Legacy mobile and React desktop page routes are removed from the client route graph; unknown legacy page paths use the normal not-found route.
- [x] Sign-in uses the configured Supabase URL and publishable key, with the prior Electron project's shared Supabase defaults available when local build variables are absent.
- [x] The desktop renderer's authenticated `/api` requests target the companion app's same-origin backend.
- [x] Existing server API routes, Supabase integrations, database types, and backend configuration are retained.
- [x] The desktop UI's employee, payment-control, commission, finance, package-operation, manifest, revenue, and tracking endpoint families have matching server handlers in this project.
- [x] Browser sessions use Supabase-compatible persisted access/refresh tokens; authorization and role checks continue to be enforced by Supabase and server endpoints.


## Windows offline desktop app (approved: SQLite + queued edits)
- [ ] Add a Windows Electron shell that loads the existing DEX desktop UI and can install as an `.exe`; preserve the browser and mobile builds.
- [ ] Implement local SQLite storage with encrypted, per-user cached data and session handling; allow offline viewing only of previously authorized data.
- [ ] Queue eligible offline record edits, surface pending/conflicted/failed sync status, replay after reconnect, and use Supabase Realtime for connected refreshes.
- [ ] Keep irreversible external actions and file uploads online-only unless server-side idempotency is available; never bundle service-role keys.
- [ ] Add schema migrations, automated tests, Windows installer build, and instructions for configuring the deployed API URL.


## Manifest auth and Admin Overview follow-up
- [x] Serialize Supabase refresh-token rotation across browser tabs and retry authenticated API/manifest requests once with the newest same-user session.
- [x] Return a clear expired-session response; surface the manifest API's partial-success warning if package rows were inserted but the audit log failed.
- [x] Restore the screenshot-style monthly operations/revenue Overview for Admin only; keep staff dashboards scoped to personal commission/sales metrics.
- [x] Count imported package KES values and subtract payment allocations when calculating remaining balances in the revenue summary.
- [ ] User to sign in and verify the authenticated Overview and manifest preview/commit on the local preview.
