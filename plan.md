# DEXCARGO hosted admin console

## Implementation approach

The existing Lovable/Supabase application remains the single web product and source of truth. The desktop Electron renderer is used as the behavioral reference, while the hosted React/TanStack Router app provides the live UI so updates can be delivered through the Lovable deployment instead of requiring a new Windows installer for every UI change.

The desktop route family is the admin workspace: `/desktop/` for operational overview, `/desktop/packages` for searchable cargo, `/desktop/payment-control` for administrator-only payment evidence correction/unlink/delete, `/desktop/finance` for finance and commissions, `/desktop/employees` for staff CRUD and access management, `/desktop/operations` for pipeline analytics, and `/desktop/manifests` for controlled Excel imports. Existing server routes and Supabase RPCs remain responsible for authorization, audit logging, payment allocation, commission triggers, employee/Auth synchronization, and finance writes.

Employee updates use the existing admin service and now support optional Auth password reset in the same validated operation. Payment control consumes the existing signed-evidence endpoint and audited correction/deletion/unlink endpoint. The web app uses the DEX logo asset and live-hosted route set; the Electron shell can continue to open the hosted URL as a branded offline-capable wrapper.

## Project structure

- `src/components/desktop/DesktopShell.tsx`: authenticated desktop layout and role-aware navigation.
- `src/routes/desktop.*.tsx`: hosted desktop pages and feature UI.
- `src/routes/api/public/**`: authenticated server handlers for employee, payment, package, manifest, finance, and evidence operations.
- `src/lib/admin-api*.ts` and `src/lib/admin.functions.ts`: validated administrator operations and Auth/DB synchronization.
- `src/hooks/use-admin-metrics.ts`: shared live cargo, payment, staff, and commission queries.
- `public/`: favicon and route manifest assets.
- `app.config.ts`: hosted project logo metadata for platform branding.

## Design direction

Three candidate directions: **Ops Control Room** (0.07), **Warm Logistics Ledger** (0.05), **Signal Dashboard** (0.08). Chosen direction: **Ops Control Room**.

- **Design movement:** aviation/logistics control-room UI translated into a calm, modern data workspace.
- **Core principles:** high information density without clutter; status-first scanning; actions close to the records they change; destructive actions are explicit and audited.
- **Color philosophy:** deep navy surfaces create focus, electric blue marks navigation and primary actions, amber flags review-needed records, and green signals settled states.
- **Layout paradigm:** persistent left rail with wide working tables and analytics panels; data stays in context rather than hiding core actions behind menus.
- **Signature elements:** mono tracking numbers, uppercase micro-labels, and status pills with consistent semantic color.
- **Interaction philosophy:** every mutation shows a clear pending state and readable server error; corrections require a reason; evidence images are visible before opening.
- **Animation:** restrained hover/focus transitions only; no distracting motion in operational tables.
- **Typography system:** display-weight headings plus compact sans-serif labels and mono identifiers for tracking and financial values.
- **Brand essence:** the live command layer for DEXCARGO Kenya logistics operations; precise, accountable, operational.
- **Brand voice:** direct and useful. Example: “Review evidence before it clears cargo.” and “Save employee details” rather than vague calls to action.
- **Wordmark & logo:** use the supplied DEX Logistics mark in favicon and project metadata; do not substitute platform branding.
- **Signature brand color:** electric DEX blue, reserved for navigation, primary actions, and focus states.
