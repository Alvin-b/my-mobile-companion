# Mobile-to-backend contract

The Android application and companion app share one Supabase project. New Android work must use the canonical `employees`, `customers`, `packages`, `payments`, and `deliveries` tables. Do not write to `cargo_packages`, `payment_allocations`, or Firebase Firestore for operational data.

## Authentication and identity

Sign in through Supabase Auth. After login, resolve the staff member with:

```http
GET /rest/v1/employees?user_id=eq.<auth_user_id>&select=id,employee_code,full_name,email,role,is_active,commission_percentage
Authorization: Bearer <access_token>
apikey: <publishable_key>
```

`auth_user_id` and `employees.id` are different UUIDs. Use `employees.id` for `received_by_employee_id`, `received_by_employee_id` on payments, and `released_by_employee_id` on deliveries.

If no active employee row is returned, sign the user out and show “Account is not provisioned. Contact an administrator.”

## Admin HTTP endpoints

All endpoints use the companion deployment base URL and require a current Supabase JWT:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

### List staff

```http
GET /api/admin/employees
```

The returned `employees[].id` is the ID required by the update and deletion calls.

### Create staff

```http
POST /api/admin/employees

{
  "full_name": "Jane Wanjiru",
  "email": "jane@example.com",
  "password": "at-least-eight-characters",
  "phone": "+254712345678",
  "role": "sales_rep",
  "commission_percentage": 5
}
```

Allowed roles are `admin`, `sales_manager`, `logistics_manager`, and `sales_rep`. The server creates the Auth user, profile trigger record, employee row, and role atomically. Do not call `/auth/v1/signup` from Android for staff creation.

### Enable or disable staff

```http
PATCH /api/admin/employees

{ "employee_id": "<employees.id>", "is_active": false }
```

Administrators cannot deactivate themselves or another administrator through this endpoint.

### Delete staff access

```http
POST /api/admin/delete-user

{ "employee_id": "<employees.id>" }
```

The server deactivates the employee and deletes the linked Supabase Auth account. Package/payment history is retained because the employee row is archived rather than removed. Do not call the old `/api/public/revoke-user-tokens` endpoint; it does not exist.

After a successful response, Android may delete the matching Firebase document only if Firebase is still required for another feature. It must not report success before this server response succeeds.

## Package lifecycle

| Android action | Canonical request |
| --- | --- |
| Register cargo | Create/find a `customers` row, then insert `packages` with `tracking_number`, `customer_id`, `description`, `weight_kg`, `amount_due`, and `received_by_employee_id`. |
| Verify | `POST /rest/v1/rpc/transition_package_status` with `{ "_package_id": "<packages.id>", "_to": "verified", "_by": "<employees.id>" }`. |
| Request payment | Patch `packages.amount_due`, then transition to `awaiting_payment`. |
| STK Push | `POST /api/mpesa-stk-push` with `phone`, integer `amount`, and `tracking_number`. Never create a paid payment locally. |
| Payment callback | Refresh `packages`/`payments`; the backend webhook creates the paid payment and transitions the package. |
| Collection | Insert `deliveries` using `packages.id`, then transition to `collected`. |

Status values are exactly: `received`, `verified`, `awaiting_payment`, `paid`, `ready_for_collection`, `collected`, `cleared`.

## Server-only features

- OCR: `POST /api/public/gemini-ocr` with `{ "image_base64": "...", "mime_type": "image/jpeg" }`.
- SMS: `POST /api/public/send-sms` with `{ "to": "+254...", "message": "...", "package_id": "<packages.id>" }`.
- M-Pesa: `POST /api/mpesa-stk-push`; do not fall back to `/functions/v1/mpesa-stk-push`.

All three routes require the Supabase access token. Keep Gemini, M-Pesa, Twilio, and Supabase service-role keys only in backend deployment secrets.
