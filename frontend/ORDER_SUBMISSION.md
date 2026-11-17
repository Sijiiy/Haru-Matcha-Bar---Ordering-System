# Kiosk order submission — Milestone 4B

Live order submission is **OFF by default**. The Laravel order feature guard is
unchanged and remains disabled. This milestone does not authorize turning either
gate on or creating live orders. No .env file, backend file, migration, catalog
record, price, or product image was changed.

## Customer flow

The existing cart retains its thumbnails, quantities, removal and Clear Order
confirmation. Its footer adds Review order; totals there and in review are
explicitly **estimated subtotals**. Back to cart and Continue browsing remain
available. The review shows the drinks/variants/quantities before sending, and
explains that Laravel confirms the prices. Empty selections cannot be sent.

Successful 201 creation or 200 idempotent replay opens a confirmation containing
only the actual API's public reference, item snapshots, prices, currency, status
and subtotal. The status must be `pending`; payment has not been verified and
barista acceptance remains pending. No payment, checkout or acceptance workflow
is implemented. Integer centavos are used throughout calculations. The currency
helper retains whole-peso menu formatting and shows two decimals for centavos.

## Public configuration and request boundary

`VITE_ORDER_SUBMISSION_ENABLED` must equal the exact string `true` for the browser
UI/request boundary to allow HTTP submission. Missing/false/other values keep it
off. It is a non-secret build-time setting, not authorization. A mock menu source
always disables real submission, even with that flag set, so mock IDs cannot be
submitted. No runtime fixture mode or silent order fallback exists.

The API module uses the same public `VITE_API_BASE_URL` rules as the menu. With
no base URL it posts to `/api/orders` through the existing Vite `/api` proxy;
production hosting must route that path to Laravel. No CORS or proxy settings
were changed. URLs containing credentials, queries or fragments are rejected.
Never put database credentials, APP_KEY or private keys in a VITE variable.

The wire request contains only:

```json
{
  "idempotency_key": "20cc41e2-587c-4e3f-a1bc-df4a4c61ad20",
  "items": [{ "variant_id": 123, "quantity": 2 }]
}
```

The example ID is illustrative. Actual IDs come from the normalized Laravel menu
response. Prices, totals, product names, status and payment fields are never sent.
Backend availability and pricing remain authoritative. Presentation components
never contact Supabase. Submission limits mirror the existing request contract:
50 submitted lines, 20 per combined variant, and 100 drinks overall.

## Retry and recovery rules

`createOrderSession` is a small testable state container owned by `MenuPage`,
observed through `useSyncExternalStore`. It survives all modal closures and
category changes. A strictly validated unresolved attempt is also saved in
same-tab `sessionStorage`. There are no submission effects that could POST on
mount or reload.

The first valid send snapshots the cart, combines/sorts variant IDs, generates a
Web Crypto random UUID v4, freezes the request and caches its exact JSON string.
No Math.random fallback is used. Concurrent taps share one in-flight promise.
Reopening a modal or retrying never silently creates another key or body.
The recovery write and readback finish synchronously **before** HTTP is started.
If storage cannot be read or written, sending is blocked rather than falling
back to an unprotected in-memory request.

## Refresh recovery and shared-kiosk bounds

Only one unresolved attempt is stored under `haru.order-recovery.v1`: its exact
wire body (containing UUID/variant IDs/quantities), creation time, outcome,
uncertainty/cooldown metadata, public API endpoint scope and whitelisted catalog
display fields for review. Display prices are estimates only. Image paths,
arbitrary cart fields, credentials, customer information, payment details and
completed order history are not stored. The cart itself remains in memory.

After refresh, an earlier unresolved submission opens the existing review modal
with an explicit recovery notice. No request is sent automatically. A pending
HTTP attempt is conservatively restored as uncertain; explicit retry uses the
same UUID and byte-identical original body even if the current cart is empty or
has been edited. Editing/Clear Order cannot replace this recovery record.
Conflict locks, earlier uncertainty and rate-limit cooldowns survive refresh.
Both normal and restored submission remain subject to the default-OFF flag.

Customer retry is bounded to **30 minutes from the first submission**, without
extending the window on retries. Expiry blocks retry/new submission and requests
staff assistance. It does **not** erase the unresolved record or generate a new
UUID. Invalid/oversized/unsupported records, future timestamps, unavailable
storage and API endpoint mismatches likewise fail closed and retain the record.
There is no customer-facing "forget this order" action. These cases require
staff to check the earlier order and resolve the kiosk safely; this milestone
adds neither staff authorization nor a backend lookup/cancellation workflow.

Recovery is removed only after validated API success, or the explicit Review
edited cart resolution for a definitively rejected, never-uncertain attempt.
If cleanup fails after success, confirmation remains successful but another
order is blocked until cleanup can be verified. A later refresh may then replay
the same UUID safely to recover the confirmed result. Corrupt/different records
are never silently deleted or overwritten.

Network failures, a 20-second timeout (including stalled response bodies), 5xx
other than a known 503, or invalid/mismatched success JSON are **uncertain**.
The order may already exist. The customer is warned and retries the original
request. Late responses from timed-out HTTP operations do not clear the cart.

- 409: retain the attempt and cart, block another send/new key, and ask for staff
  assistance. There is no backend lookup/cancellation endpoint to resolve an
  irreconcilable key conflict in this milestone.
- 422: show a selection/quantity error. A definitely rejected attempt can be
  replaced only through an explicit Review edited cart action after edits.
- 429: honor Retry-After with a visible cooldown; retry uses the original key.
- 503: display ordering unavailable, keep the cart and original request.
- Once any result was uncertain, later 422/503 responses do not erase that
  uncertainty or permit discarding the original attempt.

Editing or clearing the visible cart never cancels an earlier request. Recovery
continues to show and retry the frozen original selection. New submissions are
blocked while an uncertain request is unresolved, with a duplicate-order warning
when the cart differs. There is no "generate a new key and try again" shortcut.

Only a validated successful response can settle the cart. The cart reducer
compares the complete submitted display snapshot with the latest cart state. It
clears an unchanged cart; it preserves all subsequent edits. Confirmation warns
that an edited cart may repeat drinks from the confirmed order. Return to menu
acknowledges the confirmation before a new customer intent may get a new UUID.
Closing confirmation without acknowledgement retains it for reopening.

## Scope and limits

Session storage supports refresh in the same tab and origin, not durable kiosk
storage or coordination between independent tabs/devices. Tab closure, browser
storage clearing/eviction, a crash or kiosk restart may lose the record. A missing
record cannot reveal that browser data was externally erased. Keep the kiosk in
one managed tab and resolve uncertain submissions before closing it or clearing
browser data. Device-wide recovery, staff resolution, lookup/cancellation,
device authorization and handling of abandoned pending orders require separate
backend/product review. No new automatic timeout/reset behavior was added.

The server response is checked against the original variant IDs/quantities,
integer line arithmetic and subtotal before confirmation. Current PHP currency
and `pending` status are required. Raw server errors, traces and unexpected
fields are never displayed. Client checks support usability and do not replace
Laravel validation, price calculation, rate limiting or idempotency constraints.

## Isolated verification

From `frontend`:

```text
node --test src/features/cart/cartState.test.js src/features/menu/menuApi.test.js src/features/orders/orderRequest.test.js src/features/orders/orderApi.test.js src/features/orders/orderSession.test.js src/features/orders/orderRecovery.test.js
npm.cmd run lint
npm.cmd run build
git diff --check
```

Node tests inject fetch responses and UUID factories; none contacts Laravel or
Supabase. `orderTestFixtures.js` is imported by tests only and is not a production
order source. No package was installed. Browser QA, when performed, must use an
isolated HTTP fixture server with `/api` proxying disabled; never submit sample
orders to the actual Laravel service. Keep the production flag off after QA.

Initial milestone verification: all 47 frontend tests, ESLint and the production build
passed. Local Chrome fixture checks passed at 1600×1000 and 1366×768, including
category filtering, duplicate taps, confirmation reopening, uncertain HTTP result
recovery with an identical request, preservation of edited carts, Clear Order
cancel/confirm, and default-off submission. Dialog content scrolls without
horizontal overflow and the subtotal/actions remain visible. The effective
production submission setting was also verified as disabled. No live API order
request was made during these checks.

Refresh-recovery patch verification: all 65 frontend tests, ESLint, production
build and diff checks passed. Fixture-only Chrome QA at both landscape sizes
included an actual reload during a delayed request and after an uncertain HTTP
result: neither reload issued an automatic POST, retries retained the exact
original body, duplicate taps were blocked, success removed recovery storage,
and new cart edits stayed separate. Restored default-OFF, corrupt and expired
records were also checked; dialogs remained scrollable with visible actions and
no horizontal overflow. Laravel proxying was disabled throughout browser QA.
