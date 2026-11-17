# Staff dashboard foundation — Milestone 5A

Live staff access is OFF: `config/staff.php` hardcodes `access_enabled => false`.
Order creation remains OFF in the unchanged `config/orders.php`. This milestone
does not authorize enabling either guard, accessing Supabase, migrating, creating
staff accounts, or changing any live data/permissions.

## Authentication and authorization

The existing `web` guard uses Laravel cookie sessions and the Eloquent User
provider. Sanctum is already installed; its `/sanctum/csrf-cookie` endpoint is
used for the first-party CSRF handshake. Only staff API routes receive `web`
session/request-forgery middleware. Global Sanctum stateful-domain settings and
the stateless kiosk endpoints are unchanged. Staff routes explicitly use
`auth:web`, so bearer tokens do not grant staff access.

`GET /api/staff/session` checks the current session and Gate; guests receive 401.
`POST /api/staff/login` accepts only JSON email/password. The server requires
`is_staff=true` during password authentication; failure is generic for unknown
accounts, wrong passwords and non-staff accounts. Successful login rotates the
session ID and CSRF token. There is no remember-me, registration, password reset
or developer login bypass. No API token is issued. Passwords exist only in the
transient form/request; the field is cleared when submitted.

The `view-staff-orders` Gate strictly requires the server-loaded boolean
`User::is_staff === true`. The permission is cast to boolean, hidden from normal
serialization, and excluded from mass assignment. Missing/null permissions deny
access. Gate checks run for every data request; revoked staff cannot retain
access through an old authenticated session. `POST /api/staff/logout` logs out
the web guard, invalidates the session and rotates the CSRF token. Sign-out is
available to revoked/non-staff sessions and remains available when staff access
is disabled. It is still authenticated, CSRF-protected and rate-limited.

Laravel 13's native request-forgery middleware verifies its supported same-origin
Fetch Metadata signal or the CSRF token. The client always performs the Sanctum
cookie handshake and sends the decoded encrypted XSRF cookie as X-XSRF-TOKEN.
No CSRF exceptions or custom origin bypasses were added. Tokens and credentials
are never stored in localStorage or sessionStorage.

Disabled staff login/session/order routes stop before StartSession or the rate
limiter can touch database-backed stores. The pre-existing public Sanctum CSRF
cookie endpoint remains available; the normal UI calls it only after the staff
session check allows a login attempt, or during an explicit logout.

Limits: login 5/minute per IP+normalized-email hash and 20/minute per IP;
staff reads/logout 60/minute per IP+user hash. These are abuse controls, not
device authorization. Cache/session writes are necessary authentication activity;
the order APIs perform SELECTs only and never mutate order/catalog records.
Staff responses and errors use no-store/private cache headers. Error bodies
remain generic even with debug enabled, and never echo raw database errors.

## Order endpoints

- `GET /api/staff/orders?page=1&per_page=12`
- `GET /api/staff/orders/{reference}` where reference is the official HARU ULID

Both require the feature guard, a cookie-authenticated user, and the staff Gate.
There is no public implicit order binding: a reference is looked up inside the
controller after authorization, preventing existence enumeration by non-staff.
Only pending orders are included, oldest `created_at` first then `id` ascending.
Page size defaults to 12, caps at 25; page numbers are restricted to 1..10000.
Items are eager loaded in one query per page. No polling or write endpoint exists.

List shape:

```json
{
  "data": [{
    "order_reference": "HARU-<26-character ULID>",
    "created_at": "<UTC ISO-8601 timestamp>",
    "status": "pending", "currency": "PHP", "subtotal_centavos": 44000,
    "items": [{"product_name":"Volume I","variant_name":"12 oz",
      "quantity":2,"unit_price_centavos":22000,"line_total_centavos":44000}]
  }],
  "meta": {"current_page":1,"last_page":1,"per_page":12,"total":1}
}
```

Detail uses the same order object under `data`. Names and amounts come from
historical order/item snapshots, not current menu prices. Null variant names stay
unlabelled. The API omits internal database IDs, idempotency keys, fingerprints,
customer identity and payment details. Pending means recorded only: payment is
unverified and acceptance unconfirmed. No payment/acceptance controls are present.

## Frontend and isolated preview

`/staff` (also `/staff/`) is a separate React entry selected by pathname; `/`
retains the kiosk. Full-page links are sufficient for these two entry points,
without adding a routing package. Production hosting must serve Vite index.html
for `/staff` and proxy `/api/*` plus `/sanctum/*` to Laravel on the SAME origin.
Vite binds loopback and now proxies `/sanctum` as well as `/api`. Cross-origin
staff login is deliberately unsupported; kiosk VITE_API_BASE_URL does not redirect
staff passwords/cookies to another origin. No CORS configuration was changed.

Staff UI includes session check/login, pending cards, bounded pagination,
snapshot details, Philippine timestamps, manual refresh, empty/loading/error
states and logout. A 401/403 clears displayed order data; logout clears data
immediately and reports failure without falsely claiming session invalidation.
Out-of-order page/detail responses cannot overwrite newer navigation. No staff
identity/order cache or persistent browser credential storage is added.

An explicit non-secret `VITE_STAFF_DEMO=true` selects a separate fixture-only
adapter, marked DEMO on every screen. Open demo dashboard is a local preview
action with no credentials and no HTTP capability. It never authenticates with
Laravel or falls back to real endpoints. Normal mode never falls back to demo
orders on failure. Defaults keep demo OFF. Use process-local flags only during
preview; do not commit .env changes or deploy a demo build as the staff system.

For manual fixture preview only, from a dedicated frontend PowerShell terminal:

```powershell
$env:VITE_STAFF_DEMO = 'true'
npm.cmd run dev
```

Open `/staff`. No Laravel server is needed for the staff DEMO view. Stop that
process and close its terminal afterward so the flag does not carry into a later
build. Neither this preview flag nor the UI can enable the backend feature guard.

## Pending migration and deployment/security gate

Prepared only: `2026_11_17_140000_add_is_staff_to_users_table.php` adds the non-null
boolean `users.is_staff` with default false. Existing users remain non-staff.
No migration was run. The nine pre-existing migrations/catalog/order schema are
unchanged. This is the single new local migration; inspect the live migration
ledger under separately approved read-only access before any future deployment.
Do not use an unrestricted migration command or account seeder.

Before enabling live access, obtain separate approval for the exact additive
migration and private provisioning of named staff. Provisioning must use a trusted
server/admin procedure, not request mass assignment, a public registration route,
frontend edits, an anonymous Supabase client or hardcoded seed credentials.

Live preflight MUST audit users, sessions, password_reset_tokens, personal access
tokens and cache-table ACLs/RLS as well as the already-hardened order tables.
In particular, Supabase anon/authenticated/service_role or another public API/RPC
must not be able to change users.is_staff, read password hashes, forge/read
sessions or bypass the staff Gate. Application mass-assignment protection cannot
secure direct database/Data API access. This milestone does not inspect/change
live grants or add policies. Review any required permission changes separately.

Verify Laravel's private runtime role retains the required users/session/cache
access and order SELECT access. Do not grant order access to Supabase API roles.
Review HTTPS with Secure+HttpOnly session cookies, SameSite Lax/Strict, trusted
hosts/proxies, session lifetime on shared staff devices, deployment cache behavior,
shared rate-limit storage, log access and the absence of public forwarding. Do
not enable staff access on a customer kiosk/shared browser profile. No bearer
token/device-auth or production exposure approval is implied by these fixtures.

The retained development test order will appear as pending if the development
staff API is later enabled. It has no test flag or automatic exclusion. Preserve
it and use its previously recorded reference for operational traceability;
do not delete or alter it as part of dashboard deployment.

## Verification

Backend tests use the existing fail-closed testing+SQLite+:memory: guards and
fixture equivalents, not live migrations or Supabase. Permission migration SQL
is compiled in pretend mode only. CSRF tests explicitly re-enable verification
that the Laravel test runner normally skips. Existing order/menu tests remain.
Run PHP syntax checks, full PHPUnit and Pint for affected files. Frontend uses
native node:test tests for the API/session/source boundary, plus lint/build.
Browser QA must intercept all staff/Sanctum/menu HTTP with isolated fixtures or
use DEMO with the Laravel proxy disabled. Never sign in or query live orders
during visual QA. No live account or order was created for this milestone.

## File inventory

Created backend files:

- `config/staff.php`
- `database/migrations/2026_11_17_140000_add_is_staff_to_users_table.php`
- `app/Http/Controllers/Api/StaffSessionController.php`
- `app/Http/Controllers/Api/StaffOrderController.php`
- `app/Http/Middleware/EnsureStaffAccessEnabled.php`
- `app/Http/Middleware/NoStoreStaffResponses.php`
- `app/Http/Requests/StaffLoginRequest.php`
- `app/Http/Resources/StaffOrderResource.php`
- `tests/Feature/StaffAccessTest.php`
- `STAFF_DASHBOARD.md`

Modified backend files: `app/Models/User.php`,
`app/Providers/AppServiceProvider.php`, `bootstrap/app.php`, `routes/api.php`.

Created frontend files (under `src/features/staff/` unless noted):

- `StaffPage.jsx`
- `StaffLogin.jsx`
- `StaffOrderDetails.jsx`
- `staff.css`
- `staffApi.js`
- `staffApi.test.js`
- `staffSession.js`
- `staffSession.test.js`
- `staffSource.js`
- `staffDemo.js`
- `staffTime.js`
- `useStaff.js`
- `src/utils/appPath.js`

Modified frontend files: `src/App.jsx`, `vite.config.js`. No files were deleted.

## Milestone verification result

- Full backend suite: 80 tests, 741 assertions passed, including all existing
  order/menu tests. APP_ENV=testing, DB_CONNECTION=sqlite, DB_DATABASE=:memory:,
  empty DB_URL, CACHE_STORE=array and SESSION_DRIVER=array were explicitly set
  in the test command process. No live database was contacted.
- PHP syntax checks and Pint --test passed for all 13 affected PHP files.
- Full frontend suite: 95 tests passed (65 existing plus 30 staff cases).
- npm.cmd run lint and npm.cmd run build passed; staff JS/CSS are lazy loaded
  separately from the kiosk. No dependencies were added.
- Fixture-only local Chrome QA passed at 1600x1000 and 1366x768: login/error,
  CSRF handshake, loading, pending cards, details, Escape/focus return,
  pagination, refresh, empty/error/forbidden states, expiry clearing, logout,
  unavailable-feature sign-out and explicitly labeled DEMO. No horizontal
  overflow; modal footer/actions remain visible. Login/long lists can scroll.
- QA removed both Laravel proxies and intercepted all API/Sanctum requests;
  DEMO made zero staff HTTP requests. The kiosk still rendered all 18 products.
- No Supabase access, live migration, real staff account, permission change,
  order write, catalog edit or permanent feature activation was performed.
