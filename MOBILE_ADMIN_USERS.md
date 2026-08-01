# Android: Admin — create, list and delete employees

## Why you get `HTTP 403 failed to create user`

403 comes from **our** server, not Supabase, and it means exactly one thing:

> the access token you sent does not belong to an **active `admin`** row in `employees`.

Causes, in order of likelihood:

1. You are calling the endpoint with the **anon/publishable key** as the bearer token instead of the signed-in admin's `access_token`.
2. You are sending a token from a user whose `employees.role != 'admin'` or `is_active = false`.
3. The token expired (Supabase access tokens live 1 hour) — refresh before the call.
4. You called the **preview** host (`id-preview--…lovable.app`). Preview is auth-gated at the edge. Use the URLs below.

Never call Supabase's `/auth/v1/admin/users` from the app — the service-role key must never ship in an APK. All admin user management goes through our backend.

## Base URL

```
https://project--5e9b81ad-6c63-4331-af7a-01008019e17f.lovable.app
```
(stable preview build; production: `https://swift-creation-app.lovable.app`)

## Endpoints

All require header `Authorization: Bearer <supabase access_token of an active admin>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/public/admin/employees` | List all employees |
| POST | `/api/public/admin/employees` | Create employee (auth login + employee row + role) |
| PATCH | `/api/public/admin/employees` | Enable/disable an employee |
| POST | `/api/public/admin/delete-user` | Permanently delete employee + their login |

### POST create — body

```json
{
  "full_name": "Jane Wanjiru",
  "email": "jane@dexcargo.co.ke",
  "password": "TempPass123",
  "phone": "+254712345678",
  "role": "sales_rep",
  "commission_percentage": 5
}
```

`role` ∈ `admin | sales_manager | logistics_manager | sales_rep`.
`password` min 8 chars. `phone` optional (nullable).

**201** →
```json
{ "employee": { "id": "uuid", "user_id": "uuid", "employee_code": "SR-0001",
  "full_name": "Jane Wanjiru", "email": "jane@dexcargo.co.ke", "role": "sales_rep",
  "commission_percentage": 5, "is_active": true, "created_at": "…" } }
```
The employee code (`ADM-/SM-/LM-/SR-0001`) is generated server-side. The user signs in immediately with that email + password (email is pre-confirmed).

### GET list — `200`
```json
{ "employees": [ { "id": "…", "employee_code": "SR-0001", "full_name": "…",
  "email": "…", "phone": "…", "role": "sales_rep", "commission_percentage": 5,
  "is_active": true, "created_at": "…" } ] }
```

### PATCH toggle — body
```json
{ "employee_id": "uuid", "is_active": false }
```

### POST delete — body
```json
{ "employee_id": "uuid" }
```
`200` → `{ "ok": true, "deleted": { "employee_id": "…", "employee_code": "SR-0001" } }`

Rules enforced server-side: you cannot delete or disable **your own** account, and `admin` rows cannot be disabled via PATCH.

### Error shape

```json
{ "error": "Active administrator access is required" }
```
`401` missing/expired token · `403` not an active admin · `400` validation / duplicate email · `404` unknown employee.

---

## Kotlin / Retrofit

### 1. Models

```kotlin
data class CreateEmployeeRequest(
    @SerializedName("full_name") val fullName: String,
    val email: String,
    val password: String,
    val phone: String? = null,
    val role: String,                       // "sales_rep" | "logistics_manager" | "sales_manager" | "admin"
    @SerializedName("commission_percentage") val commissionPercentage: Double = 0.0,
)

data class Employee(
    val id: String,
    @SerializedName("user_id") val userId: String?,
    @SerializedName("employee_code") val employeeCode: String,
    @SerializedName("full_name") val fullName: String,
    val email: String?,
    val phone: String?,
    val role: String,
    @SerializedName("commission_percentage") val commissionPercentage: Double,
    @SerializedName("is_active") val isActive: Boolean,
    @SerializedName("created_at") val createdAt: String?,
)

data class EmployeeListResponse(val employees: List<Employee>)
data class EmployeeResponse(val employee: Employee)
data class SetActiveRequest(
    @SerializedName("employee_id") val employeeId: String,
    @SerializedName("is_active") val isActive: Boolean,
)
data class DeleteEmployeeRequest(@SerializedName("employee_id") val employeeId: String)
data class ApiErrorBody(val error: String?)
```

### 2. API interface

```kotlin
interface AdminApi {
    @GET("api/public/admin/employees")
    suspend fun listEmployees(@Header("Authorization") bearer: String): Response<EmployeeListResponse>

    @POST("api/public/admin/employees")
    suspend fun createEmployee(
        @Header("Authorization") bearer: String,
        @Body body: CreateEmployeeRequest,
    ): Response<EmployeeResponse>

    @PATCH("api/public/admin/employees")
    suspend fun setEmployeeActive(
        @Header("Authorization") bearer: String,
        @Body body: SetActiveRequest,
    ): Response<Unit>

    @POST("api/public/admin/delete-user")
    suspend fun deleteEmployee(
        @Header("Authorization") bearer: String,
        @Body body: DeleteEmployeeRequest,
    ): Response<Unit>
}
```

### 3. Retrofit client — note the host

This is a **second** Retrofit instance, separate from your Supabase REST client.
No `apikey` header here; only the bearer token.

```kotlin
object DexBackend {
    private const val BASE_URL =
        "https://project--5e9b81ad-6c63-4331-af7a-01008019e17f.lovable.app/"

    val adminApi: AdminApi = Retrofit.Builder()
        .baseUrl(BASE_URL)
        .client(
            OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .build()
        )
        .addConverterFactory(GsonConverterFactory.create())
        .build()
        .create(AdminApi::class.java)
}
```

### 4. Getting the right token (this is what fixes the 403)

```kotlin
// supabase-kt
suspend fun freshAdminBearer(): String {
    val session = supabase.auth.currentSessionOrNull()
        ?: error("Not signed in")
    if (session.expiresAt <= Clock.System.now()) supabase.auth.refreshCurrentSession()
    return "Bearer " + supabase.auth.currentAccessTokenOrNull()!!
}
```
If you store the session manually, pass `session.access_token` — **never** `BuildConfig.SUPABASE_ANON_KEY`.

### 5. Repository

```kotlin
class AdminRepository(private val api: AdminApi = DexBackend.adminApi) {

    suspend fun listEmployees(): Result<List<Employee>> = call {
        api.listEmployees(freshAdminBearer())
    }.map { it.employees }

    suspend fun createEmployee(req: CreateEmployeeRequest): Result<Employee> = call {
        api.createEmployee(freshAdminBearer(), req)
    }.map { it.employee }

    suspend fun setActive(id: String, active: Boolean): Result<Unit> =
        callUnit { api.setEmployeeActive(freshAdminBearer(), SetActiveRequest(id, active)) }

    suspend fun deleteEmployee(id: String): Result<Unit> =
        callUnit { api.deleteEmployee(freshAdminBearer(), DeleteEmployeeRequest(id)) }

    private suspend fun <T> call(block: suspend () -> Response<T>): Result<T> = try {
        val res = block()
        if (res.isSuccessful && res.body() != null) Result.success(res.body()!!)
        else Result.failure(Exception(res.errorMessage()))
    } catch (t: Throwable) { Result.failure(t) }

    private suspend fun callUnit(block: suspend () -> Response<Unit>): Result<Unit> = try {
        val res = block()
        if (res.isSuccessful) Result.success(Unit) else Result.failure(Exception(res.errorMessage()))
    } catch (t: Throwable) { Result.failure(t) }

    private fun Response<*>.errorMessage(): String {
        val raw = errorBody()?.string().orEmpty()
        val parsed = runCatching { Gson().fromJson(raw, ApiErrorBody::class.java).error }.getOrNull()
        return parsed ?: when (code()) {
            401 -> "Session expired — sign in again"
            403 -> "Only an active administrator can manage employees"
            else -> "Request failed (HTTP ${code()})"
        }
    }
}
```

### 6. ViewModel + Compose screen (Employees list)

```kotlin
class EmployeesViewModel(private val repo: AdminRepository = AdminRepository()) : ViewModel() {
    var employees by mutableStateOf<List<Employee>>(emptyList()); private set
    var loading by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null)

    fun load() = viewModelScope.launch {
        loading = true
        repo.listEmployees()
            .onSuccess { employees = it; error = null }
            .onFailure { error = it.message }
        loading = false
    }

    fun create(req: CreateEmployeeRequest, onDone: () -> Unit) = viewModelScope.launch {
        repo.createEmployee(req)
            .onSuccess { error = null; load(); onDone() }
            .onFailure { error = it.message }
    }

    fun delete(id: String) = viewModelScope.launch {
        repo.deleteEmployee(id).onSuccess { load() }.onFailure { error = it.message }
    }
}

@Composable
fun EmployeesScreen(vm: EmployeesViewModel = viewModel()) {
    LaunchedEffect(Unit) { vm.load() }

    Column(Modifier.fillMaxSize()) {
        vm.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) }
        if (vm.loading) LinearProgressIndicator(Modifier.fillMaxWidth())

        LazyColumn {
            items(vm.employees, key = { it.id }) { e ->
                ListItem(
                    overlineContent = { Text(e.employeeCode) },
                    headlineContent = { Text(e.fullName) },
                    supportingContent = { Text("${e.role} · ${e.email ?: "—"}") },
                    trailingContent = {
                        IconButton(onClick = { vm.delete(e.id) }) {
                            Icon(Icons.Default.Delete, contentDescription = "Delete ${e.fullName}")
                        }
                    },
                )
                HorizontalDivider()
            }
        }
    }
}
```

Create call from the form:

```kotlin
vm.create(
    CreateEmployeeRequest(
        fullName = name.trim(),
        email = email.trim().lowercase(),
        password = password,            // min 8 chars
        phone = phone.trim().ifBlank { null },
        role = selectedRole,            // "sales_rep" etc.
        commissionPercentage = commission,
    )
) { showDialog = false }
```

---

## Checklist when 403 persists

1. Log the token's `sub` and query `employees` for it: `role` must be `admin`, `is_active` must be `true`.
2. Confirm the header is `Authorization: Bearer eyJhbGciOi…` (a JWT, three dot-separated parts) — not `sb_publishable_…`.
3. Confirm the base URL is the `project--…lovable.app` host, not `…supabase.co` and not the `id-preview--…` host.
4. Do not add an `apikey` header on these four calls.
5. Refresh the session if the app has been backgrounded for over an hour.