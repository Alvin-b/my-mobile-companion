# DEX Admin desktop console enhancements

## Implementation approach

Keep the existing desktop renderer as the sole UI for this work. Mobile-client UI/build/update requests are deferred as requested; retain backend routes and data contracts that may still be used by the mobile app. Make desktop package, payment, staff, and commission workflows use the existing authenticated server routes and Supabase data model rather than introducing a second frontend.

Represent payment state separately from cargo release using four canonical values: `unpaid`, `part_paid`, `paid`, and `invoice`. Derive paid/part-paid totals from payment allocations, support separate evidence records against the same tracking number, and keep a package releasable only once its balance is fully paid. Physical release is recorded through the existing release endpoint and `collected_at`; do not write `released` into the constrained two-state cargo `status` column.

Keep payment amount corrections audited, retain payment unlink/delete audit history, enforce payment deletion as administrator-only in both the API and database policies, and make staff profile edits expose the backend's existing optional password change. Ensure sales attribution is visible from each staff member's package list and commission view while protecting accrued commissions from premature payout. Remove company-revenue cards from dashboards, hide desktop tracking/manifest UI and route/freight presentation, and add search/scroll controls to shared package views.

## Project structure

- `src/legacy/desktop-renderer.ts`: desktop console navigation, overview, package, payment, staff, and commission screens.
- `public/desktop-console.css`: desktop workspace, scrollable package lists, and responsive styles.
- `src/routes/api/public/**`: authenticated package/payment operations, commission reporting, and finance invoice integration.
- `src/lib/admin-api.server.ts` and `src/lib/storage-sign.server.ts`: shared active-user/admin authorization helpers.
- `supabase/migrations/**`: payment-state, payment-deletion policy, allocation, and release invariants.
- `src/integrations/supabase/types.ts`: generated database type contract kept in sync with new fields.

## Design direction

Preserve the existing DEX logistics control-room styling: dark navy work surfaces, electric-blue primary actions, compact operational tables, semantic payment/status badges, and sticky headers for dense desktop package workflows. Make package scrolling and filters easy to discover without changing the mobile app or replacing the established visual system.

## Windows offline desktop shell

Add a separate Electron Windows installer which loads the existing desktop renderer and assets locally; do not replace the current web or Capacitor mobile entry points. Use SQLite in the Electron main process (Android Room is not a Windows library), with user-partitioned cached snapshots and an encrypted outbox using Electron `safeStorage`. Keep Supabase credentials and JWT handling out of the renderer process and never bundle service-role keys.

On sign-in, cache only datasets returned under that account's existing Supabase RLS permissions. When offline, restore the saved account and cached rows, allow record edits to enter a visible, ordered outbox, and distinguish locally queued changes from server-confirmed data. On reconnection, revalidate the current user, replay supported mutations with duplicate protection, preserve conflicts for review, and refresh the cache. Use Supabase Realtime events for connected refreshes with an online refresh fallback. File uploads and operations with irreversible external side effects must remain online-only unless an idempotent server contract is implemented. The deployed application API origin is a runtime configuration requirement because the packaged app cannot contain the service-role backend.

Package the UI via a small `electron/` main/preload/renderer shell, enable context isolation and sandboxing, expose only narrow typed IPC, and persist the local store in the OS user-data directory. Add SQLite schema/versioning, Windows NSIS packaging, and repeatable build/test scripts; keep the legacy browser path and mobile build unchanged.
