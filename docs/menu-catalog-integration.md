# Haru menu catalog integration

## Frontend source

The default source is **API**. With no extra configuration the kiosk requests
`/api/menu`, and Vite on `http://127.0.0.1:5173` proxies `/api` to Laravel on
`http://127.0.0.1:8000`. Start Laravel with `php artisan serve --host=127.0.0.1`
from `backend`, and Vite with `npm.cmd run dev` from `frontend`.

For a deployed build, `VITE_API_BASE_URL` may contain a **public HTTP(S) base URL**
without `/api/menu` (for example `https://api.example.com`). An empty base uses
the same origin; production hosting must route `/api` to Laravel because the
Vite development proxy does not exist in a static build. Cross-origin hosting
needs a separately reviewed backend CORS configuration. None is changed here.
Vite configuration is embedded at build time. Never put credentials or secrets
in a `VITE_*` value.

Explicit offline prototype mode is `VITE_MENU_SOURCE=mock`. In PowerShell, for
the current terminal only:

```powershell
$env:VITE_MENU_SOURCE = 'mock'
npm.cmd run dev
```

Use `VITE_MENU_SOURCE=api` to switch back; restart Vite after changing it.
Mock mode is visibly labeled "Prototype menu · Mock prices". No `.env` files
are changed by this milestone. API mode never falls back to mock records or
prices, including on connection failures, HTTP errors, invalid JSON, or invalid
nested data. Requests time out after 15 seconds. Retry uses the current source.
An empty API catalog stays empty.

`normalizeMenu.js` validates nested records, preserves database IDs and integer
centavos, and adds Matcha sections using explicit known slugs. Unknown Matcha
products appear under "Matcha"; other unknown categories remain visible in All.
API ordering is preserved. The existing image precedence is retained: mapped
Hot/Iced variant image, then API `image_path`, then default mapped image. Missing
or failed images use the abstract fallback. A supplied `image_path` should be a
public, browser-usable URL. The cart remains in memory and uses actual API IDs.
Displayed prices and subtotals are not authoritative for future order creation.

## Confirmed seed snapshot

`backend/database/data/haru-catalog.json` is the reviewed snapshot derived from
`frontend/src/features/menu/mockMenu.js`, excluding prototype IDs, local image
paths and UI sections. A frontend Node test checks exact parity of names,
descriptions, slugs, variants, ordering and integer prices. It contains three
categories, 18 products and 31 prices. Local PNGs are not uploaded or stored in
the database.

`ProductVariant.name` is NOT NULL. Single-price Hojicha records use the reserved
storage identifier `__single_price__`. The public variant resource converts
that identifier to JSON `null`, so cards, product dialogs and cart lines never
display an invented size. Database variant IDs and prices are unchanged.

## Seeder safety and approval gate

`HaruCatalogSeeder::preview()` performs reads only and returns counts, proposed
inserts, no updates, and any conflicts. The seeder matches category/product
slugs and variants by product plus exact name. It only inserts missing records.
Existing records must match confirmed names, descriptions, order, activation,
category and price. Different-slug name matches, case-insensitive slug matches,
and unexpected variants on a managed product cause a conflict. Conflicts abort
the entire run before inserts. Existing image metadata and unrelated records
are preserved. No rows are deleted or updated. It is not registered in the
default `DatabaseSeeder`, which creates a test user and must not be run here.

The write phase is a transaction. PostgreSQL locks the three catalog tables
against concurrent edits while rechecking conflicts and inserting. A second
run with identical records makes no changes. SQLite tests exercise the logic
but do not validate PostgreSQL locking or production CHECK-constraint syntax.

**Do not run this command against Supabase without explicit live-seed approval.**
The proposed command, from `backend`, is:

```powershell
php artisan db:seed --class=HaruCatalogSeeder
```

No `--force` is used. Before approval, identify the connected environment and
read current catalog counts, review `preview()` and confirm no conflicts. The
seed run rechecks conflicts to guard against changes after inspection. Approval
to inspect is not approval to seed. A failed transaction rolls back; a successful
seed has no automatic undo. Removing committed rows later requires a separate
review, particularly once other records reference them.

## Local verification

Backend tests run only in SQLite `:memory:` with fail-closed database checks and
test-only catalog tables. They never run the PostgreSQL migrations against
Supabase. Existing menu tests are preserved; seeder tests cover counts, exact
public catalog, integer prices, repeat runs, preservation and conflict refusal.

```powershell
# backend
php artisan test
# frontend
node --test src/features/cart/cartState.test.js src/features/menu/menuApi.test.js
npm.cmd run lint
npm.cmd run build
```

## Current live checkpoint

Read-only inspection before implementation: Laravel `local`, PostgreSQL database
`postgres`, Supabase host confirmed, connection fingerprint `8d51fc0ce694`.
The session reported `default_transaction_read_only=on`. Counts were zero for
categories, products and variants. The public menu returned HTTP 200 with an
empty data array. Expected insert plan: 3 categories, 18 products, 31 variants;
zero updates, zero deletes, no observed conflicts. These counts are a snapshot
and must be rechecked before an approved write.

Status: **IMPLEMENTED — LIVE CATALOG SEED PENDING**. Isolated tests are not proof
that a populated live Supabase catalog has been verified end to end.
