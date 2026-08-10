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
---

## 19. M-Pesa STK Push (Daraja) — initiate a payment

Trigger a Safaricom STK prompt on the customer's phone. Called by the mobile
app (Retrofit) with a signed-in staff JWT.

### 19.1 `POST /api/mpesa-stk-push`

Headers:
```
Authorization: Bearer <supabase_access_token>
Content-Type: application/json
```

Body:
```json
{
  "phone": "0712345678",
  "amount": 4500,
  "tracking_number": "1260707534975",
  "description": "Air freight"
}
```

- `phone` accepts `07XX...`, `2547XX...`, or `+2547XX...`; normalized to `2547XXXXXXXX` before Daraja.
- `amount` is KES, whole shillings.
- `tracking_number` is the `cargo_packages.id`; used as the Daraja
  `AccountReference` unless `MPESA_ACCOUNT_REFERENCE` is set.

Response 200:
```json
{
  "ok": true,
  "notification_id": "PN-8f3a1c22",
  "notification_number": "PAY-20260723-2b4f7a",
  "checkout_request_id": "ws_CO_23072026...",
  "merchant_request_id": "29115-34620561-1",
  "customer_message": "Success. Request accepted for processing"
}
```

Behavior:
1. Verifies the Supabase JWT (`Authorization: Bearer ...`).
2. Requests a Daraja OAuth token, then calls
   `POST /mpesa/stkpush/v1/processrequest`.
3. Inserts a **pending** row in `payment_notifications` keyed by
   `checkout_request_id`, so the webhook can match the callback.
4. Returns the Daraja `CheckoutRequestID` — poll `notification_id` for status.

### 19.2 Callback (server-to-server)

Safaricom POSTs the result to `MPESA_CALLBACK_URL`, which must be:
```
https://project--5e9b81ad-6c63-4331-af7a-01008019e17f.lovable.app/api/public/mpesa-webhook?secret=<MPESA_WEBHOOK_SECRET>
```

The webhook:
- Looks up the pending `payment_notifications` row by `checkout_request_id`.
- On `ResultCode = 0`: sets `status = 'PENDING'` → allocation, stores
  `mpesa_receipt`, and inserts a `payment_allocations` row when the
  `AccountReference` matches a `cargo_packages.id`. The existing DB trigger
  then flips the package to `paid` and creates the commission.
- On non-zero `ResultCode`: sets `status = 'FAILED'`, stores `result_code`
  and `result_desc`.

### 19.3 Poll status

The mobile app polls the notification row every ~3s:
```
GET /rest/v1/payment_notifications?id=eq.PN-8f3a1c22&select=status,mpesa_receipt,result_code,result_desc
```

`status` values:
- `PENDING` — STK sent, awaiting customer PIN / callback.
- `LINKED`  — payment succeeded and was allocated to the cargo package.
- `FAILED`  — customer cancelled, wrong PIN, timeout, or Daraja error.

### 19.4 Secrets used

| Secret | Purpose |
| --- | --- |
| `MPESA_ENV` | `sandbox` or `production` (defaults to `sandbox`) |
| `MPESA_CONSUMER_KEY` | Daraja app consumer key |
| `MPESA_CONSUMER_SECRET` | Daraja app consumer secret |
| `MPESA_SHORTCODE` | Your PayBill / Till number registered on Daraja |
| `MPESA_PASSKEY` | Daraja Lipa Na M-Pesa Online passkey |
| `MPESA_PARTY_B` | Optional — receiving PayBill (e.g. `522522` for shared KCB); defaults to `MPESA_SHORTCODE` |
| `MPESA_ACCOUNT_REFERENCE` | Optional — force a static AccountReference; otherwise the tracking number is used |
| `MPESA_CALLBACK_URL` | Full public URL of `/api/public/mpesa-webhook` including `?secret=...` |
| `MPESA_WEBHOOK_SECRET` | Shared secret validating incoming Daraja callbacks |

### 19.5 Kotlin / Retrofit example

```kotlin
interface MpesaApi {
    @POST("api/mpesa-stk-push")
    suspend fun stkPush(@Body req: StkPushRequest): StkPushResponse
}

data class StkPushRequest(
    val phone: String,
    val amount: Int,
    val tracking_number: String,
    val description: String? = null,
)

data class StkPushResponse(
    val ok: Boolean,
    val notification_id: String,
    val notification_number: String,
    val checkout_request_id: String?,
    val merchant_request_id: String?,
    val customer_message: String?,
)
```

Base URL for these automation endpoints:
```
https://project--5e9b81ad-6c63-4331-af7a-01008019e17f.lovable.app
```

---

## 20. Linking a payment to a package (commission automation)

Linking is a single insert into `payment_allocations`. Everything else happens
server-side inside the same transaction — the Android app must **not** patch the
package status or create commissions itself.

```http
POST /rest/v1/payment_allocations
Authorization: Bearer <access_token>
apikey: <publishable_key>
Content-Type: application/json
Prefer: return=representation

{
  "id": "PA-1786266745593-01",
  "payment_notification_id": "PN-1786266745593",
  "notification_number": "PAY-20260809-45593",
  "order_id": "<cargo_packages.id>",
  "tracking_number": "<cargo_packages.id>",
  "allocated_amount": 5000,
  "linked_by": "<auth_user_id> (Full Name)"
}
```

On insert the backend automatically:

1. sets `payment_notifications.status = 'LINKED'`;
2. sets the package `status = 'paid'`, `paid_at = now()`, `payment_ref`, and
   `payment_method` (money now counts as collected/disbursed in every report);
3. awards the commission to the employee named in `cargo_packages.sales_rep`.

### Employee matching for commissions

`sales_rep` is free text, so the resolver accepts any of:

| Stored value | Matched by |
| --- | --- |
| `SR-0001 jane nee` | `employees.employee_code` |
| `037f04e0-...-a4e11cc59d86 jane nee` | `employees.id` or `employees.user_id` |
| `jane nee` | `employees.full_name` |

Best practice for Android: always write `"<employee_code> <full_name>"` into
`sales_rep` at registration time.

### Commission amount

`amount = cargo_packages.cost * percentage / 100 + flat_amount`, using the most
specific active rule in `commission_rules` (employee-specific rule first, then
role rule). If no rule exists, `employees.commission_percentage` is used.
Defaults shipped: sales rep 5%, sales manager 2%, logistics manager 1.5%.
Duplicate protection is enforced by a unique index on
`(cargo_package_id, employee_id, trigger)` — re-linking never double-pays.

Read an employee's own commissions:

```http
GET /rest/v1/commissions?employee_id=eq.<employees.id>&select=id,amount,percentage,status,trigger,created_at,cargo_package_id&order=created_at.desc
```

## 21. Real payment evidence (image, text, or both)

`payment_notifications.image_url` stores a **private storage path** such as
`proofs/proof_1786266743362.jpg`. It is not a public URL, which is why clients
that render it directly fall back to placeholder artwork. Use this endpoint to
get the real, signed, one-hour URL.

Evidence is flexible: the uploader may attach **an image only**, **an image plus
a note**, or **text only**. The response always contains both parts plus an
`evidence_kind` discriminator so the app never has to guess.

```http
GET /api/public/payment-evidence?id=PN-1786266745593
GET /api/public/payment-evidence?status=PENDING&limit=50
GET /api/public/payment-evidence?order_id=<cargo_package_id>
Authorization: Bearer <access_token>
```

```json
{
  "evidence": {
    "id": "PN-1786266745593",
    "notification_number": "PAY-20260809-45593",
    "evidence_type": "IMAGE",
    "image_url": "proofs/proof_1786266743362.jpg",
    "evidence_url": "https://.../object/sign/proofs/proof_...?token=...",
    "has_image": true,
    "note": "this is for tracking number 2003",
    "has_note": true,
    "text_content": "this is for tracking number 2003",
    "evidence_kind": "image_and_text",
    "amount": null,
    "sender_phone": null,
    "mpesa_receipt": null,
    "status": "PENDING",
    "uploaded_by": "DEX Admin",
    "uploaded_at": "2026-08-09T09:12:25Z"
  }
}
```

`evidence_kind` is one of `image`, `text`, `image_and_text`, `none`.

Kotlin:

```kotlin
interface EvidenceApi {
    @GET("api/public/payment-evidence")
    suspend fun evidence(
        @Query("status") status: String? = null,
        @Query("order_id") orderId: String? = null,
        @Query("limit") limit: Int = 50,
    ): EvidenceListResponse
}

data class EvidenceListResponse(val evidence: List<PaymentEvidence>, val count: Int)

data class PaymentEvidence(
    val id: String,
    val notification_number: String,
    val evidence_type: String,
    val evidence_url: String?,    // load this with Coil, never image_url
    val has_image: Boolean,
    val note: String?,            // typed note / full text, may be null
    val has_note: Boolean,
    val evidence_kind: String,    // image | text | image_and_text | none
    val amount: Double?,
    val sender_phone: String?,
    val status: String,
    val uploaded_by: String?,
    val uploaded_at: String,
)
```

Render rule (do NOT branch on `evidence_type`):

```kotlin
if (e.has_image) AsyncImage(model = e.evidence_url, contentDescription = null)
if (e.has_note)  Text(e.note!!)
if (!e.has_image && !e.has_note) Text("No evidence attached")
```

Never show a bundled sample receipt. Signed URLs expire after one hour, so
refetch rather than caching them long-term.

---

## 22. Package photos (private buckets)

Same problem, same fix: `cargo_packages.package_photo_url` and rows in
`package_images` hold private storage paths (`package-photos/...`,
`sticker-photos/...`, `signatures/...`). Loading them directly returns 400/404,
which is why the app shows blank package cards.

```http
GET /api/public/package-media?id=<cargo_package_id>
GET /api/public/package-media?limit=50
Authorization: Bearer <access_token>
```

```json
{
  "package": {
    "id": "CG-1786266745593",
    "consignee": "Jane Doe",
    "status": "paid",
    "package_photo_url": "package-photos/pkg_178626.jpg",
    "photo_url": "https://.../object/sign/package-photos/pkg_178626.jpg?token=...",
    "package_photo_captured_at": "2026-08-09T09:12:25Z"
  },
  "images": [
    { "id": "...", "kind": "sticker", "url": "sticker-photos/s1.jpg", "signed_url": "https://..." }
  ]
}
```

The list form returns `{ "packages": [...], "count": n }` with a `photo_url` on
every row — call it once when the packages screen loads and map by `id`.

```kotlin
@GET("api/public/package-media")
suspend fun packageMedia(@Query("limit") limit: Int = 50): PackageMediaList

data class PackageMediaList(val packages: List<PackageMedia>, val count: Int)
data class PackageMedia(val id: String, val consignee: String?, val photo_url: String?)
```

---

## 23. Generic media signer

For any other stored path (signatures, proofs referenced elsewhere, sticker
photos) use the generic signer instead of hardcoding bucket URLs:

```http
GET  /api/public/media?path=signatures/sig_1.png&expires=3600
POST /api/public/media      { "paths": ["proofs/a.jpg", "package-photos/b.jpg"] }
Authorization: Bearer <access_token>
```

Single: `{ "path": "...", "url": "https://...", "expires_in": 3600 }`
Batch:  `{ "urls": { "proofs/a.jpg": "https://...", ... }, "expires_in": 3600 }`

The bucket is inferred from the first path segment (`proofs`,
`package-photos`, `sticker-photos`, `signatures`); bare filenames default to
`proofs`. Full Supabase storage URLs are accepted and re-signed. Batch is
capped at 100 paths, `expires` at 24h. All three endpoints require a
signed-in staff access token — the anon key alone returns 401.
