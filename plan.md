# DEX Admin desktop UI on the companion backend

## Implementation approach

Use the created DEX Admin desktop renderer as the sole user-facing UI at `/`. Keep the companion project's Supabase project configuration and server/API handlers; the desktop renderer receives the Vite-injected Supabase URL and publishable key and sends protected `/api` requests to the current application origin. Browser session persistence uses local storage; Supabase authorization and server-side checks remain authoritative.

Remove the legacy mobile sign-in, dashboard, scan, package, customer, notification, commission, and React desktop page routes from the client route graph. Preserve `src/routes/api/**`, Supabase integrations, server functions, schemas, and database configuration. Unknown old UI paths return the app's normal not-found page. The desktop renderer owns navigation between its overview, packages, payments, staff, commissions, announcements, and audit views.

## Project structure

- `src/routes/index.tsx`: full-screen DEX desktop UI mount and browser bridge setup.
- `src/legacy/desktop-renderer.ts`: the created DEX desktop renderer and its in-app operational views.
- `public/desktop-console.css` and `public/assets/dex-logo.png`: matching DEX desktop styling and branding.
- `src/routes/api/**`: retained server-side backend routes used by the console.
- `src/integrations/supabase/**` and `supabase/**`: retained Supabase client, types, and backend integration.

## Design direction

- **Movement:** logistics operations control-room interface.
- **Principles:** dense but scannable information; live operational status; actions close to records; preserve explicit role checks and auditable changes.
- **Color:** dark navy work surfaces, electric blue navigation and primary actions, semantic amber/red/green statuses.
- **Layout:** desktop sidebar with a broad operational workspace, adapting to narrower viewports.
- **Signature elements:** DEX brand mark, compact uppercase labels, mono identifiers, semantic status pills.
- **Interaction:** preserve the desktop renderer's sign-in flow, navigation, mutation confirmations, pending states, and server error messaging.
