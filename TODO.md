# DEXCARGO hosted console outcomes

## Hosted desktop workspace
- [x] The full app is implemented from the working desktop reference in the existing hosted React/Supabase project, with role-aware desktop navigation and live backend data.
- [x] The hosted project keeps the Electron desktop route family: overview, packages, finance, employees, operations, and manifest import.
- [x] The desktop app exposes a stable hosted URL path so UI changes can be delivered without downloading a new `.exe` for every update.

## Staff management
- [x] Administrators can register employees, enable/disable permitted accounts, delete accounts safely, and see role distribution.
- [x] Administrators can edit employee full name, email address, phone, role, and optionally reset the sign-in password.
- [x] Employee updates synchronize Auth, profiles, employee records, and role records through the backend service with readable validation errors.

## Payment control and reconciliation
- [x] Payment evidence is listed with extracted amount, sender/message details, status, and small image thumbnails that open the full proof.
- [x] Administrators can correct the total amount and message content with a mandatory audit reason.
- [x] Administrators can unlink individual package allocations with an audit record.
- [x] Administrators can delete payment evidence only after all package links are removed; deletion is audited and storage cleanup is attempted.
- [x] Payment evidence remains restricted to administrator actions for correction and deletion.

## Packages and commissions
- [x] Packages are grouped by general, special, and sea cargo categories and can be searched by tracking number, client, sales representative, or destination.
- [x] Commission data is visible in finance analytics and retains the existing approval and paid-out actions.
- [x] The overview dashboard no longer exposes company-wide revenue summary cards; it retains operational counts, payment-state counts, and commission insight.

## Branding and delivery
- [x] The supplied DEX logo is used for hosted project branding metadata and favicon assets.
- [ ] Push the completed hosted app commit to the connected GitHub repository once GitHub authentication is restored; the code is validated locally and ready to publish.
- [ ] Publish the latest checkpoint to the hosted deployment and verify the public URL serves the updated route set.
