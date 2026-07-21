# Dexcargo Backend API — Mobile Integration Guide

This document maps every REST endpoint the Android app needs to the live Lovable Cloud (Supabase) backend. All endpoints follow the PostgREST convention, so the mobile Retrofit interfaces work as-is.

## 1. Base configuration

| Setting | Value |
| --- | --- |
| Base URL | `https://bxbpuqzrbvkfrmwohqwd.supabase.co` |
| `apikey` header (publishable) | `sb_publishable_2aAwawQ3-zBwZTu3lE6n6Q__-g2fWsN` |
| REST prefix | `/rest/v1` |
| Auth prefix | `/auth/v1` |
| Storage prefix | `/storage/v1` |

**Every request must include:**
```
apikey: sb_publishable_2aAwawQ3-zBwZTu3lE6n6Q__-g2fWsN
Authorization: Bearer <access_token>   // except /auth/v1/token which only needs apikey
```

Access tokens are JWTs valid for 3600 s; refresh tokens are long-lived and rotate on use.

---

## 2. Authentication

### 2.1 Login
`POST /auth/v1/token?grant_type=password`

Headers: `apikey`, `Content-Type: application/json`

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

### 2.2 Refresh
`POST /auth/v1/token?grant_type=refresh_token`
```json
{ "refresh_token": "d9f8g7..." }
```

### 2.3 Logout
`POST /auth/v1/logout`  (bearer token; empty body)

---

## 3. Profile & Roles

### 3.1 Fetch profile
`GET /rest/v1/profiles?id=eq.{user_id}&select=*`

```json
[{
  "id": "uuid",
  "name": "John Kamau",
  "email": "john@dexcargo.com",
  "is_active": true,
  "pin_hash": "hashed_pin_or_null",
  "biometric_enabled": false
}]
```

Profile rows are auto-created on signup by a database trigger — no client insert needed.

### 3.2 Update profile
`PATCH /rest/v1/profiles?id=eq.{user_id}`
```json
{ "pin_hash": "...", "biometric_enabled": true }
```
Add `Prefer: return=representation` to receive the updated row.

### 3.3 Fetch role
`GET /rest/v1/user_roles?user_id=eq.{user_id}&select=role`
```json
[{ "role": "sr" }]
```

Values: `admin`, `sm`, `lm`, `sr`. Legacy long names (`sales_manager`, `logistics_manager`, `sales_rep`) also accepted.

---

## 4. Cargo Packages

Table `cargo_packages` matches the mobile schema 1:1.

### 4.1 List
`GET /rest/v1/cargo_packages?select=*&order=registered_at.desc&limit=50`

Filters: `status=eq.registered`, `phone=eq.0711223344`, `sales_rep=like.SR-002*`.

### 4.2 Get one
`GET /rest/v1/cargo_packages?id=eq.{tracking_number}&select=*`

### 4.3 Register
`POST /rest/v1/cargo_packages`  (header `Prefer: return=representation`)
```json
{
  "id": "1260707534982",
  "consignee": "Mary Wanjiku",
  "phone": "0711223344",
  "origin": "Guangzhou (CAN)",
  "dest": "Nairobi (NBO)",
  "description": "Salon Equipment",
  "mode": "Sea Freight",
  "weight": 12.0,
  "pcs": 3,
  "cost": 3800,
  "sales_rep": "SR-002 John Kamau",
  "status": "registered"
}
```

### 4.4 Offline sync (bulk upsert)
`POST /rest/v1/cargo_packages` with header `Prefer: resolution=merge-duplicates,return=representation` and a JSON array body. Conflicts on `id` update the row — safe for offline reconnect flushes.

### 4.5 Update package
`PATCH /rest/v1/cargo_packages?id=eq.{id}`
```json
{
  "status": "collected",
  "collected_at": "2026-07-20T17:00:00Z",
  "collector_name": "David Ochieng",
  "collector_id": "ID-29402941",
  "collector_phone": "0700112233",
  "signature_points": "[(10,20),(12,21),...]"
}
```
Status lifecycle enforced by CHECK: `registered` → `paid` → `collected`.

### 4.6 Upload cargo photo
`POST /storage/v1/object/package-photos/{packageId}/{filename}`

Headers: `Authorization`, `Content-Type: image/jpeg`. Body: raw JPEG bytes.

After upload PATCH the cargo row:
```json
{
  "package_photo_url": "package-photos/1260707534982/photo.jpg",
  "package_photo_captured_at": "2026-07-20T15:31:00Z",
  "package_photo_captured_by": "SR-002 (John Kamau)"
}
```
Signed read URL: `POST /storage/v1/object/sign/package-photos/{path}` with `{ "expiresIn": 3600 }`.

---

## 5. Payments

### 5.1 Inbox
`GET /rest/v1/payment_notifications?select=*&order=uploaded_at.desc`
Filter pending: `status=eq.PENDING`.

### 5.2 Upload evidence

Image path — upload first:
`POST /storage/v1/object/proofs/{notificationId}/{filename}` (JPEG/PNG bytes)

Then insert:
`POST /rest/v1/payment_notifications`
```json
{
  "id": "PN-1721512410",
  "notification_number": "PAY-20260720-9402",
  "evidence_type": "IMAGE",
  "image_url": "proofs/PN-1721512410/screenshot.jpg",
  "uploaded_by": "ADM-001 (Admin)",
  "amount": 5600,
  "sender_phone": "0711223344",
  "timestamp": "2026-07-20T15:15:00Z",
  "status": "PENDING"
}
```

Text evidence: `"evidence_type": "TEXT"` with `"text_content": "..."`.

### 5.3 Link payment to cargo
`POST /rest/v1/payment_allocations`
```json
{
  "id": "PA-1721512599-43",
  "payment_notification_id": "PN-1721512410",
  "order_id": "1260707534982",
  "tracking_number": "1260707534982",
  "allocated_amount": 3800,
  "linked_by": "LM-001 (Mary Wanjiku)",
  "notification_number": "PAY-20260720-9402"
}
```
A trigger automatically marks the notification `LINKED` and transitions the cargo to `paid` with `paid_at` and `payment_ref` set.

---

## 6. Commissions

### 6.1 List
`GET /rest/v1/commissions?employee_id=eq.{employee_id}&status=eq.pending&select=*`

### 6.2 Approve (RPC)
`POST /rest/v1/rpc/approve_commission`
```json
{ "_id": "commission-uuid" }
```

### 6.3 Mark paid (RPC)
`POST /rest/v1/rpc/mark_commission_paid`
```json
{ "_id": "commission-uuid", "_reference": "MPESA_REF" }
```

Both RPCs require manager or admin role.

---

## 7. Storage buckets

| Bucket | Purpose | Public |
| --- | --- | --- |
| `package-photos` | Cargo condition photos | No |
| `sticker-photos` | QR/sticker captures | No |
| `signatures` | Handover signature PNGs | No |
| `proofs` | Payment screenshots | No |

Signed URLs: `POST /storage/v1/object/sign/{bucket}/{path}` with `{ "expiresIn": 3600 }`.

---

## 8. Row-Level Security summary

| Table | Read | Write |
| --- | --- | --- |
| `profiles` | Any authenticated user | Own row only |
| `user_roles` | Authenticated | Admin only |
| `cargo_packages` | Any active staff | Any active staff |
| `payment_notifications` | Any active staff | Any active staff |
| `payment_allocations` | Any active staff | Any active staff |
| `commissions` | Employee sees own | RPC only |

Active staff = an `employees` row with `is_active = true`. Admins provision new employees from the web admin console.

---

## 9. Error format

PostgREST:
```json
{ "code": "42501", "message": "permission denied", "details": null, "hint": null }
```
Auth:
```json
{ "error": "invalid_grant", "error_description": "Invalid login credentials" }
```

The mobile 401 → refresh interceptor works unchanged.

---

## 10. Admin bootstrap

Seeded admin: `dex3cargo@gmail.com` / `alvina@44` (role `admin`, code `ADM-0001`). Additional employees are provisioned via the web admin console at `/admin/employees`, which creates the auth user, `employees` row, and `user_roles` entry in one call.
