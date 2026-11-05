# DEXCARGO desktop console outcomes

## Desktop UI replacement
- [x] The app root renders the DEX Admin desktop console and its administrator sign-in instead of the previous mobile login, dashboard, scan, package, customer, notification, and commission screens.
- [x] The desktop console keeps its internal operations navigation for overview, packages, payments, staff, commissions, finance, manifests, announcements, and audit views.
- [x] Legacy mobile and React desktop page routes are removed from the client route graph; unknown legacy page paths use the normal not-found route.

## Backend and authentication
- [x] Sign-in uses the configured Supabase URL and publishable key, with the prior Electron project's shared Supabase defaults available when local build variables are absent.
- [x] The desktop renderer's authenticated `/api` requests target the companion app's same-origin backend.
- [x] Existing server API routes, Supabase integrations, database types, and backend configuration are retained.
- [x] The desktop UI's employee, payment-control, commission, finance, package-operation, manifest, revenue, and tracking endpoint families have matching server handlers in this project.
- [x] Browser sessions use Supabase-compatible persisted access/refresh tokens; authorization and role checks continue to be enforced by Supabase and server endpoints.
