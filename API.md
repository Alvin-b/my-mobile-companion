# DexApp Backend — Android Integration Guide

Complete reference for connecting the Jetpack Compose / Retrofit mobile app to
the Lovable Cloud (Supabase) backend. Every endpoint listed here is live and
matches the shipped Postman collection.

---

## 1. Base configuration

| Setting | Value |
| --- | --- |
| Base URL | `https://bxbpuqzrbvkfrmwohqwd.supabase.co` |
| `apikey` header (publishable) | `sb_publishable_2aAwawQ3-zBwZTu3lE6n6Q__-g2fWsN` |
| REST prefix | `/rest/v1` |
| Auth prefix | `/auth/v1` |
| Storage prefix | `/storage/v1` |

### Required headers on every request
```
apikey: sb_publishable_2aAwawQ3-zBwZTu3lE6n6Q__-g2fWsN
Authorization: Bearer <access_token>       // except /auth/v1/token, which only needs apikey
Content-Type: application/json             // for JSON bodies
Prefer: return=representation              // when you want the inserted/updated row back
Prefer: resolution=merge-duplicates        // for upserts
```

### Retrofit setup (Kotlin)
```kotlin
object SupabaseConfig {
    const val BASE_URL = "https://bxbpuqzrbvkfrmwohqwd.supabase.co/"
    const val API_KEY  = "sb_publishable_2aAwawQ3-zBwZTu3lE6n6Q__-g2fWsN"
}

class AuthInterceptor(private val tokenStore: TokenStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request().newBuilder()
            .addHeader("apikey", SupabaseConfig.API_KEY)
            .apply {
                tokenStore.accessToken?.let { addHeader("Authorization", "Bearer $it") }
            }
            .build()
        return chain.proceed(req)
    }
}
```

Access tokens are JWTs valid **3600s**; refresh tokens rotate on every use. Implement
a 401 → refresh → retry interceptor for a smooth experience.

---

## 2. Authentication (`/auth/v1`)

### 2.1 Login (email/password)
`POST /auth/v1/token?grant_type=password`
Headers: `apikey`, `Content-Type`
```json
{ "email": "user@dexcargo.com", "password": "********" }
```
Response:
```json
{
  "access_token": "eyJhbG...",
  "refresh_token": "d9f8g7...",
  "expires_in": 3600,
  "token_type": "bearer",
  "user": { "id": "uuid", "email": "user@dexcargo.com" }
}
```

### 2.2 Refresh token
`POST /auth/v1/token?grant_type=refresh_token`
```json
{ "refresh_token": "d9f8g7..." }
```

### 2.3 Signup (rarely used — admins provision employees)
`POST /auth/v1/signup`
```json
{ "email": "newuser@example.com", "password": "securepassword123",
  "data": { "name": "New Employee" } }
```
A database trigger auto-creates a `profiles` row on signup; you do NOT need to
insert into `profiles` from the client.

### 2.4 Logout
`POST /auth/v1/logout` — bearer token, empty body.

---

## 3. Profiles (`/rest/v1/profiles`)

Schema:
```
id (uuid, PK — matches auth.users.id)
name              text
email             text
is_active         boolean, default true
pin_hash          text (nullable) — SHA-256 or bcrypt of local PIN
biometric_enabled boolean, default false
created_at, updated_at
```

| Method / URL | Notes |
| --- | --- |
| `GET /rest/v1/profiles?select=*` | List — any authenticated user |
| `GET /rest/v1/profiles?id=eq.{user_id}&select=*` | Fetch one |
| `PATCH /rest/v1/profiles?id=eq.{user_id}` | Update **own** row only (RLS) |

```json
{ "pin_hash": "hashed_pin", "biometric_enabled": true }
```

---

## 4. User roles (`/rest/v1/user_roles`)

Roles: `admin`, `sm`, `lm`, `sr` (long forms `sales_manager`, `logistics_manager`,
`sales_rep` also accepted).

| Method / URL | Notes |
| --- | --- |
| `GET /rest/v1/user_roles?select=*` | List |
| `GET /rest/v1/user_roles?user_id=eq.{user_id}&select=role` | Fetch role for current user |
| `POST /rest/v1/user_roles` | **Admin only** |

```json
{ "user_id": "uuid", "role": "sr" }
```

---

## 5. Cargo packages (`/rest/v1/cargo_packages`)

```
id                text PK        (tracking number / QR)
consignee         text
phone             text
origin, dest      text
descr             text           (short label — mobile OCR field)
description       text           (long description)
mode              text           ("Air Freight" | "Sea Freight" | ...)
weight            numeric
pcs               integer
cost              numeric
sales_rep         text           ("SR-002 John Kamau")
status            text           registered | paid | collected
registered_at, paid_at, collected_at   timestamptz
collector_name, collector_id, collector_phone   text
payment_method, payment_ref                     text
package_photo_url                               text  (storage path)
package_photo_captured_at                       timestamptz
package_photo_captured_by                       text
signature_points                                text  (JSON array of {x,y})
```

### 5.1 List / filter
`GET /rest/v1/cargo_packages?select=*&order=registered_at.desc&limit=50`

Common filters: `status=eq.registered`, `phone=eq.0711223344`,
`sales_rep=like.SR-002*`, `consignee=ilike.*Mary*`.

### 5.2 Get one
`GET /rest/v1/cargo_packages?id=eq.{tracking_number}&select=*`

### 5.3 Register a new package
`POST /rest/v1/cargo_packages`  (`Prefer: return=representation`)
```json
{
  "id": "1260707534999",
  "consignee": "Jane Doe",
  "phone": "0712345678",
  "origin": "Nairobi (NBO)",
  "dest": "Kigali (KGL)",
  "descr": "Electronics",
  "description": "Electronics",
  "mode": "Air Freight",
  "weight": 3.5,
  "pcs": 2,
  "cost": 4500,
  "sales_rep": "SR-002 John Kamau",
  "status": "registered"
}
```

### 5.4 Offline bulk upsert
`POST /rest/v1/cargo_packages`  header `Prefer: resolution=merge-duplicates,return=representation`
Body: JSON **array** of packages. Conflicts on `id` update the row — safe for offline flush.

### 5.5 Update / transition status
`PATCH /rest/v1/cargo_packages?id=eq.{id}`
```json
{ "status": "paid", "paid_at": "2026-07-20T11:30:00Z",
  "payment_method": "M-Pesa", "payment_ref": "QM5A8J2K8F" }
```
```json
{ "status": "collected", "collected_at": "2026-07-20T17:00:00Z",
  "collector_name": "David Ochieng", "collector_id": "ID-29402941",
  "collector_phone": "0700112233",
  "signature_points": "[{\"x\":10,\"y\":20},{\"x\":12,\"y\":21}]" }
```
Status lifecycle (CHECK enforced): `registered → paid → collected`.

---

## 6. Payment notifications (`/rest/v1/payment_notifications`)

```
id                   text PK        ("PN-4")
notification_number  text UNIQUE    ("PAY-20260720-0001")
evidence_type        text           IMAGE | TEXT
image_url            text           (storage path when IMAGE)
text_content         text           (when TEXT)
uploaded_by          text           ("ADM-001 (Admin)")
uploaded_at          timestamptz
status               text           PENDING | LINKED
amount               numeric
sender_phone         text
timestamp            timestamptz
```

| Method / URL | Notes |
| --- | --- |
| `GET /rest/v1/payment_notifications?select=*&order=uploaded_at.desc` | Inbox |
| `GET /rest/v1/payment_notifications?status=eq.PENDING&select=*` | Pending filter |
| `POST /rest/v1/payment_notifications` | Create |
| `PATCH /rest/v1/payment_notifications?id=eq.PN-1` | Update (e.g. `{ "status": "LINKED" }`) |

---

## 7. Payment allocations (`/rest/v1/payment_allocations`)

Links a payment notification to a cargo package. A trigger fires on insert and:
1. Marks the notification `LINKED`.
2. Sets the cargo package `status = 'paid'`, `paid_at = now()`, `payment_ref = notification_number`.

```
id                       text PK
payment_notification_id  text FK → payment_notifications.id
order_id                 text          (cargo_packages.id)
tracking_number          text
allocated_amount         numeric
linked_by                text
linked_at                timestamptz
notification_number      text
```

```json
POST /rest/v1/payment_allocations
{
  "id": "PA-2",
  "payment_notification_id": "PN-1",
  "order_id": "1260707534975",
  "tracking_number": "1260707534975",
  "allocated_amount": 5600,
  "linked_by": "LM-001 (Mary Wanjiku)",
  "notification_number": "PAY-20260720-0001"
}
```

---

## 8. Audit logs (`/rest/v1/audit_logs`)

```
id         text PK    ("AL-5")
action     text       ("CREATE_CARGO_PACKAGE")
actor      text       ("SR-002 (John Kamau)")
timestamp  timestamptz
details    text
```

| Method / URL | Notes |
| --- | --- |
| `GET /rest/v1/audit_logs?select=*&order=timestamp.desc` | Any active staff |
| `POST /rest/v1/audit_logs` | Any active staff |

---

## 9. Broadcast messages (`/rest/v1/broadcast_messages`)

```
id         text PK    ("BM-2")
message    text
target     text       ("all" | "sr" | "lm" | "sm" | "admin")
sender     text       ("ADM-001")
timestamp  timestamptz
```

| Method / URL | Notes |
| --- | --- |
| `GET /rest/v1/broadcast_messages?select=*&order=timestamp.desc` | All staff |
| `POST /rest/v1/broadcast_messages` | **Admin only** |

---

## 10. Commissions (`/rest/v1/commissions`) + RPC

`GET /rest/v1/commissions?order=created_at.desc`
Employees see only **their own** rows; admins/managers see all.

### 10.1 Approve
`POST /rest/v1/rpc/approve_commission`
```json
{ "_id": "commission-uuid" }
```

### 10.2 Mark paid
`POST /rest/v1/rpc/mark_commission_paid`
```json
{ "_id": "commission-uuid", "_reference": "MPS-REF-2026-001" }
```

Both RPCs require **admin, sales_manager, or sm** role.

### 10.3 Commission rates
`GET /rest/v1/commission_rates?select=*`

Returns active rate rules (`role`, `trigger`, `percentage`, `flat_amount`, `active`).

---

## 11. Storage (`/storage/v1`)

| Bucket | Purpose | Public |
| --- | --- | --- |
| `package-photos` | Cargo condition photos | No |
| `sticker-photos` | QR / sticker captures | No |
| `signatures` | Handover signature PNGs | No |
| `proofs` | Payment screenshots | No |

### Upload
`POST /storage/v1/object/{bucket}/{path}`
Headers: `Authorization`, `Content-Type: image/jpeg`. Body: raw bytes.

```
POST /storage/v1/object/package-photos/1260707534975/photo_001.jpg
```

After upload, patch the cargo row with the storage path:
```json
{ "package_photo_url": "package-photos/1260707534975/photo_001.jpg",
  "package_photo_captured_at": "2026-07-20T15:31:00Z",
  "package_photo_captured_by": "SR-002 (John Kamau)" }
```

### Download (authenticated)
`GET /storage/v1/object/{bucket}/{path}`

### Signed URL (share for N seconds)
`POST /storage/v1/object/sign/{bucket}/{path}`
```json
{ "expiresIn": 3600 }
```
Response: `{ "signedURL": "/object/sign/..." }` — prepend base URL.

---

## 12. External — Google Gemini OCR

Not proxied by this backend. Call directly from the app:
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=<GEMINI_API_KEY>
```
Prompt Gemini to return raw JSON with keys `tracking_number, consignee_name,
consignee_phone, origin, destination, description, mode, weight, pieces, cost`.
Then map the JSON to a `cargo_packages` POST (§5.3).

---

## 13. Row-Level Security summary

| Table | Read | Write |
| --- | --- | --- |
| `profiles` | Any authenticated user | Own row only |
| `user_roles` | Authenticated | Admin only |
| `cargo_packages` | Any active staff | Any active staff |
| `payment_notifications` | Any active staff | Any active staff |
| `payment_allocations` | Any active staff | Any active staff |
| `audit_logs` | Any active staff | Any active staff (insert) |
| `broadcast_messages` | Any active staff | Admin only |
| `commissions` | Own rows (managers/admin: all) | RPC only |
| `commission_rates` | Any active staff | Admin only |

**Active staff** = an `employees` row with `is_active = true`. Admins provision
new employees through the web admin console at `/admin/employees`, which creates
the auth user, `employees` row, and `user_roles` entry in one call.

---

## 14. Error format

PostgREST:
```json
{ "code": "42501", "message": "permission denied", "details": null, "hint": null }
```
Auth:
```json
{ "error": "invalid_grant", "error_description": "Invalid login credentials" }
```
Storage:
```json
{ "statusCode": "404", "error": "Not found", "message": "Object not found" }
```

The mobile 401 → refresh interceptor covers session expiry transparently.

---

## 15. Admin bootstrap

Seeded admin: **`dex3cargo@gmail.com` / `alvina@44`**
(role `admin`, employee code `ADM-0001`).

All additional employees are provisioned via the web admin console
(`/admin/employees`). That flow:
1. Creates the auth user (email + password).
2. Inserts an `employees` row with an auto-assigned code
   (`SR-0001`, `LM-0001`, `SM-0001`, `ADM-0001`).
3. Assigns the matching role in `user_roles`.

The mobile app never needs to call `auth/v1/signup` for staff — just log in with
the credentials the admin provides.

---

## 16. Quick reference — Postman collection

Import `DexApp-Supabase-API.postman_collection.json` and set the collection
variables:

| Variable | Value |
| --- | --- |
| `base_url` | `https://bxbpuqzrbvkfrmwohqwd.supabase.co` |
| `apikey`   | `sb_publishable_2aAwawQ3-zBwZTu3lE6n6Q__-g2fWsN` |
| `user_email` | your test login |
| `user_password` | your test password |

Run **1. Authentication → Login** first — the test script auto-populates
`access_token` and `user_id` so every downstream request works.

---

## 17. Automation endpoints (Lovable server routes)

These are TanStack Start server routes hosted at:

```
https://project--5e9b81ad-6c63-4331-af7a-01008019e17f.lovable.app
```

(stable across renames; use `-dev` suffix for the preview build).

### 17.1 Auto-commission trigger (server-side, no endpoint)

A Postgres trigger (`trg_auto_commission_paid`) fires when a `cargo_packages`
row transitions to `status = 'paid'`. It:

1. Reads the `sales_rep` field (expects `"SR-002 John Kamau"` shape).
2. Looks up the matching active `employees` row by `employee_code`.
3. Picks the active `commission_rules` row for that role + `trigger = 'payment'`.
4. Inserts a `commissions` row with `amount = cost * percentage / 100 + flat_amount`
   and `status = 'pending'`.

Nothing to call — payments made through `PATCH /rest/v1/cargo_packages` or
auto-linked via M-Pesa create the commission automatically.

### 17.2 `POST /api/public/mpesa-webhook`

Receiver for Safaricom Daraja C2B / STK Push callbacks. Configure Daraja's
`CallBackURL` to:

```
https://project--5e9b81ad-6c63-4331-af7a-01008019e17f.lovable.app/api/public/mpesa-webhook?secret=<MPESA_WEBHOOK_SECRET>
```

or send the secret as `X-Webhook-Secret` header. Requests without the correct
secret return `401`.

Behavior:
- Inserts a row into `payment_notifications` (`evidence_type = 'TEXT'`,
  `status = 'PENDING'`, `uploaded_by = 'MPESA_WEBHOOK'`, `amount`,
  `sender_phone`).
- If the STK `AccountReference` matches a `cargo_packages.id` (tracking
  number), an entry is inserted into `payment_allocations` and the existing
  DB trigger flips the package to `paid` and generates the commission.
- Returns `{ "ResultCode": 0, "ResultDesc": "Accepted" }` on success (Daraja
  requires that shape).

The mobile app does not need to call this — it is server-to-server only.

### 17.3 `POST /api/public/gemini-ocr`

Server-side OCR for airway bills / shipping labels. The mobile app sends the
captured image; the server calls Gemini via the Lovable AI Gateway (API key
stays on the server).

Headers:
```
Authorization: Bearer <supabase_access_token>
Content-Type: application/json
```

Body:
```json
{ "image_base64": "<jpeg-bytes-base64>", "mime_type": "image/jpeg" }
```

Response 200:
```json
{
  "tracking_number": "1260707534975",
  "consignee_name": "Jane Doe",
  "consignee_phone": "0712345678",
  "origin": "Nairobi (NBO)",
  "destination": "Kigali (KGL)",
  "description": "Electronics",
  "mode": "Air Freight",
  "weight": "3.5",
  "pieces": "2",
  "cost": "4500"
}
```

Map the response directly into a `POST /rest/v1/cargo_packages` body (§5.3).

### 17.4 `POST /api/public/send-sms`

Outbound customer notification (SMS / WhatsApp). Requires a logged-in staff
JWT.

Headers:
```
Authorization: Bearer <supabase_access_token>
Content-Type: application/json
```

Body:
```json
{ "to": "+254712345678",
  "message": "Your parcel 1260707534975 is ready for collection.",
  "package_id": "1260707534975" }
```

Behavior:
- If `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`
  secrets are configured, the message is sent via Twilio Programmable SMS.
- Otherwise the request is queued into `whatsapp_logs` with `status = 'queued'`
  for manual delivery.
- Every attempt is recorded in `whatsapp_logs` (`template = 'manual'`, payload
  carries `to`, `message`, `tracking_number`, `sent_by`).

Response:
```json
{ "ok": true, "status": "sent", "ref": "SM1234...", "error": null }
```

---

## 18. Secrets the backend expects

Configured via Lovable Cloud (never checked into git):

| Secret | Purpose | Required for |
| --- | --- | --- |
| `MPESA_WEBHOOK_SECRET` | Shared secret validating Daraja callbacks | §17.2 (auto-set) |
| `LOVABLE_API_KEY` | Lovable AI Gateway auth | §17.3 (auto-set) |
| `TWILIO_ACCOUNT_SID` | Twilio credential | §17.4 (add if using Twilio) |
| `TWILIO_AUTH_TOKEN` | Twilio credential | §17.4 |
| `TWILIO_FROM_NUMBER` | Twilio sender in E.164 | §17.4 |

Ask the Lovable admin to add the Twilio trio before switching `send-sms`
off queue mode.