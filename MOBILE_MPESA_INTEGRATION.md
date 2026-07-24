# Mobile App → Daraja STK Push Integration

This is the ONLY correct wiring for the Android app to trigger real M-Pesa
STK prompts. If the app still shows a "simulated" payment path, it is
bypassing this endpoint — remove any local mock/simulator and follow the
steps below verbatim.

> Backend base URL (stable, never changes on rename):
> ```
> https://project--5e9b81ad-6c63-4331-af7a-01008019e17f.lovable.app
> ```
> Do **NOT** call `sandbox.safaricom.co.ke` or `api.safaricom.co.ke`
> directly from the app. The Consumer Key / Secret / Passkey live on the
> server. The app only ever talks to our backend.

---

## 1. High-level flow

```
 Android app                Our backend                    Safaricom Daraja
 -----------                -----------                    ----------------
 1. POST /api/mpesa-stk-push   ──►
                               2. OAuth token   ──►
                                                ◄──  access_token
                               3. STK processrequest ──►
                                                ◄──  CheckoutRequestID
                               4. insert payment_notifications (PENDING)
       ◄── 200 { notification_id, checkout_request_id }

 5. Customer enters M-Pesa PIN on phone
                                                ◄── Safaricom callback
                               6. POST /api/public/mpesa-webhook
                               7. update payment_notifications → LINKED / FAILED
                                  + allocate to cargo_packages (trigger flips
                                    the package to `paid` and creates commission)

 8. App polls GET /rest/v1/payment_notifications?id=eq.<notification_id>
    until status != 'PENDING'
```

The mobile app is responsible for steps **1** and **8** only. Everything
else happens on the backend.

---

## 2. Prerequisite: user must be signed in

The endpoint is authenticated. The app must attach the Supabase access
token from the currently signed-in employee:

```
Authorization: Bearer <supabase_access_token>
Content-Type:  application/json
```

Read it from your existing `AuthRepository` /
`supabase.auth.currentSession.accessToken`. If the user is not signed in
you will get `401 Unauthorized` — do not fall back to a simulator; surface
the error and send them to sign-in.

---

## 3. Endpoint

### `POST /api/mpesa-stk-push`

Request body:

```json
{
  "phone": "0712345678",
  "amount": 1,
  "tracking_number": "DXC260724AB12CD",
  "description": "Air freight"
}
```

| Field             | Type    | Required | Notes |
| ----------------- | ------- | -------- | ----- |
| `phone`           | string  | yes      | Accepts `07XX…`, `01XX…`, `2547XX…`, `+2547XX…`. Backend normalises to `2547XXXXXXXX`. |
| `amount`          | integer | yes      | KES, whole shillings. Sandbox: use `1`. |
| `tracking_number` | string  | yes      | `cargo_packages.id`. Used as Daraja `AccountReference` (unless `MPESA_ACCOUNT_REFERENCE` is set). |
| `description`     | string  | no       | Truncated to 13 chars for Daraja `TransactionDesc`. |

Success response (200):

```json
{
  "ok": true,
  "notification_id": "PN-8f3a1c22",
  "notification_number": "PAY-20260724-2b4f7a",
  "checkout_request_id": "ws_CO_24072026112233445566",
  "merchant_request_id": "29115-34620561-1",
  "customer_message": "Success. Request accepted for processing"
}
```

Error responses:

| Status | Meaning | App action |
| ------ | ------- | ---------- |
| 400    | Invalid phone / body validation failed        | Show error, let user fix input |
| 401    | Missing/invalid `Authorization` bearer        | Send user to sign-in |
| 500    | `M-Pesa not configured` (missing secrets)     | Contact backend admin |
| 502    | `Daraja OAuth failed` / `STK push failed`     | Retry; if persistent, contact admin |

**Persist `notification_id`** — it is the key you poll for status. Do NOT
use `checkout_request_id` as the polling key.

---

## 4. Polling for the result

The customer takes 5–90 seconds to enter their PIN. Poll the Supabase
REST API (not our backend) every ~3 seconds up to ~2 minutes:

```
GET https://bxbpuqzrbvkfrmwohqwd.supabase.co/rest/v1/payment_notifications
    ?id=eq.PN-8f3a1c22
    &select=status,mpesa_receipt,result_code,result_desc,amount,sender_phone
Headers:
  apikey:        sb_publishable_2aAwawQ3-zBwZTu3lE6n6Q__-g2fWsN
  Authorization: Bearer <supabase_access_token>
```

`status` transitions:

| Value     | Meaning |
| --------- | ------- |
| `PENDING` | STK sent, waiting for customer PIN / Daraja callback. Keep polling. |
| `LINKED`  | Payment succeeded and was allocated to the cargo package. Package auto-flipped to `paid`, commission auto-created. |
| `FAILED`  | Cancelled, wrong PIN, timeout, insufficient funds — see `result_desc`. |

Stop polling as soon as `status != 'PENDING'` or you hit your timeout
(recommended 120 s). If it is still `PENDING` after timeout, treat it as
"unknown — check dashboard"; the callback may still land later.

---

## 5. Retrofit wiring (Kotlin)

### 5.1 Two Retrofit instances

You need one Retrofit instance pointing at **our backend** (for STK push)
and one pointing at **Supabase REST** (for polling + the rest of the app).
Do not merge them.

```kotlin
// implementation("com.squareup.retrofit2:retrofit:2.11.0")
// implementation("com.squareup.retrofit2:converter-moshi:2.11.0")

object ApiConfig {
    const val BACKEND_BASE  = "https://project--5e9b81ad-6c63-4331-af7a-01008019e17f.lovable.app/"
    const val SUPABASE_BASE = "https://bxbpuqzrbvkfrmwohqwd.supabase.co/"
    const val SUPABASE_ANON = "sb_publishable_2aAwawQ3-zBwZTu3lE6n6Q__-g2fWsN"
}

class AuthInterceptor(private val tokenProvider: () -> String?) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request().newBuilder().apply {
            tokenProvider()?.let { header("Authorization", "Bearer $it") }
        }.build()
        return chain.proceed(req)
    }
}

// Backend client — used ONLY for /api/mpesa-stk-push
val backendRetrofit: Retrofit = Retrofit.Builder()
    .baseUrl(ApiConfig.BACKEND_BASE)
    .client(OkHttpClient.Builder()
        .addInterceptor(AuthInterceptor { SessionStore.accessToken })
        .build())
    .addConverterFactory(MoshiConverterFactory.create())
    .build()

// Supabase client — polling + all other REST reads
val supabaseRetrofit: Retrofit = Retrofit.Builder()
    .baseUrl(ApiConfig.SUPABASE_BASE)
    .client(OkHttpClient.Builder()
        .addInterceptor { chain ->
            val req = chain.request().newBuilder()
                .header("apikey", ApiConfig.SUPABASE_ANON)
                .apply { SessionStore.accessToken?.let { header("Authorization", "Bearer $it") } }
                .build()
            chain.proceed(req)
        }.build())
    .addConverterFactory(MoshiConverterFactory.create())
    .build()
```

### 5.2 API interfaces

```kotlin
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

interface MpesaApi {
    @POST("api/mpesa-stk-push")
    suspend fun stkPush(@Body body: StkPushRequest): StkPushResponse
}

data class PaymentNotification(
    val status: String,               // PENDING | LINKED | FAILED
    val mpesa_receipt: String?,
    val result_code: String?,
    val result_desc: String?,
    val amount: Double?,
    val sender_phone: String?,
)

interface PaymentStatusApi {
    @GET("rest/v1/payment_notifications")
    suspend fun get(
        @Query("id") id: String,       // pass "eq.PN-8f3a1c22"
        @Query("select") select: String = "status,mpesa_receipt,result_code,result_desc,amount,sender_phone",
    ): List<PaymentNotification>       // PostgREST returns an array
}
```

### 5.3 Repository / ViewModel usage

```kotlin
class PaymentRepository(
    private val mpesa: MpesaApi = backendRetrofit.create(MpesaApi::class.java),
    private val status: PaymentStatusApi = supabaseRetrofit.create(PaymentStatusApi::class.java),
) {
    suspend fun payWithMpesa(
        phone: String,
        amountKes: Int,
        trackingNumber: String,
    ): PaymentResult = withContext(Dispatchers.IO) {

        // 1. Initiate STK
        val init = mpesa.stkPush(StkPushRequest(phone, amountKes, trackingNumber))

        // 2. Poll for up to 2 minutes
        val deadline = System.currentTimeMillis() + 120_000
        while (System.currentTimeMillis() < deadline) {
            delay(3_000)
            val row = status.get(id = "eq.${init.notification_id}").firstOrNull()
                ?: continue
            when (row.status) {
                "LINKED" -> return@withContext PaymentResult.Success(row.mpesa_receipt.orEmpty())
                "FAILED" -> return@withContext PaymentResult.Failed(row.result_desc ?: "Payment failed")
                else     -> Unit  // PENDING — keep polling
            }
        }
        PaymentResult.Timeout(init.notification_id)
    }
}

sealed class PaymentResult {
    data class Success(val receipt: String) : PaymentResult()
    data class Failed(val reason: String)   : PaymentResult()
    data class Timeout(val notificationId: String) : PaymentResult()
}
```

In the ViewModel just call `repository.payWithMpesa(...)` from a
coroutine and update UI state from the returned `PaymentResult`. **Delete
any existing `MpesaSimulator`, `FakePaymentGateway`, `stubPay()`, or
`BuildConfig.USE_MOCK_MPESA` branches** — those are the reason the app
still looks simulated.

---

## 6. Sandbox test values

- `MPESA_ENV = sandbox` (already set on the backend).
- Amount: `1` KES.
- Phone: any real Safaricom line you can answer, OR Daraja test MSISDN
  `254708374149` with test PIN `12345678`.
- Expected: STK prompt on the phone within ~5 s; after PIN entry the
  `payment_notifications` row moves `PENDING → LINKED` within a few
  seconds and `mpesa_receipt` is populated.

You can verify without the app at `/mpesa-test` in the preview — same
backend endpoint, same behaviour. If `/mpesa-test` works but the app
doesn't, the problem is in the app, not the backend.

---

## 7. Common reasons the app still "simulates"

1. **A local mock class is still called.** Search the codebase for
   `simulate`, `mock`, `fake`, `stub`, `dummy`, `BuildConfig.DEBUG`
   inside payment code paths and remove those branches.
2. **Wrong base URL.** The app is calling
   `bxbpuqzrbvkfrmwohqwd.supabase.co/api/...` — that endpoint does not
   exist there. STK push lives on the backend base URL in §1, not on
   Supabase.
3. **Calling Daraja directly.** If the app has `sandbox.safaricom.co.ke`
   anywhere, delete it. The Consumer Key/Secret must never ship in the APK.
4. **Missing `Authorization` header.** Response will be `401`. Attach the
   Supabase access token as shown in §5.1.
5. **Not polling.** The initiate call returns immediately with
   `PENDING`. If you show "Success" based on that response you'll always
   look "simulated". Wait for `status = LINKED` from §4.
6. **Polling the wrong row.** Poll by `id=eq.<notification_id>` (from
   the initiate response), not by `checkout_request_id`.

---

## 8. After a successful payment

You do **not** need to update `cargo_packages` from the app. The backend
webhook + DB trigger already:

- inserts a `payment_allocations` row linking the payment to the package,
- flips `cargo_packages.status` from `registered` → `paid`,
- stamps `paid_at` and `payment_ref = notification_number`,
- inserts a `commissions` row for the sales rep per active
  `commission_rules`.

Refresh the package detail screen
(`GET /rest/v1/cargo_packages?id=eq.<tracking>`) after `LINKED` to show
the new status and receipt.
