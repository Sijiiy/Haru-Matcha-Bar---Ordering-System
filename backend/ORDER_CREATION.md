# Order creation foundation (Milestone 4A)

Implementation is prepared; live order schema migration and endpoint activation
remain pending separate approval. No frontend submission is implemented.

## Feature guard and operational review

`config/orders.php` ships with `creation_enabled => false`. Disabled
`POST /api/orders` requests return JSON 503 before request validation, order-table
queries, or rate-limit cache access. The action also checks the flag. Tests enable
it only within the isolated test application. Do not enable this flag until the
live schema migration, deployment/security review, and Milestone 4B integration
have each been authorized. No .env values or browser flags were added.

Enabled requests are limited to 30 attempts per minute per source IP, including
replays and validation failures. This is abuse mitigation, not kiosk/device
authentication. Before deployment, review HTTPS, trusted proxies and reliable IP
attribution, shared rate-limit storage across workers, shared kiosk/NAT limits,
network exposure/device authorization, debug settings, and server log access.
Before approving live migration, also verify database-role grants and Supabase
Data API/RLS exposure for the new order tables. Kiosk clients must not be able to
read or write orders directly through another database interface: the feature
guard and pricing validation protect Laravel requests only. Live permissions
were not inspected or changed in this audit.
The UUID is a retry token, not a customer authentication credential; use random
client-generated UUIDs and avoid logging them unnecessarily.

## Request and response

Send JSON to the public `POST /api/orders` endpoint:

```json
{
  "idempotency_key": "a18f6adc-e22f-47df-b91c-c51a23f46070",
  "items": [{ "variant_id": 123, "quantity": 2 }]
}
```

The variant ID above illustrates the shape only: clients must use the actual
IDs returned by `GET /api/menu`. No catalog IDs are hardcoded in the action.
Only these JSON fields are allowed. Query parameters, extra top-level/line
fields (including null price/status/payment values), numeric strings, malformed
JSON, non-list item collections, and non-JSON requests are rejected.

Successful creation returns 201; an identical replay returns 200:

```json
{
  "data": {
    "order_reference": "HARU-<26-character ULID>",
    "status": "pending",
    "currency": "PHP",
    "subtotal_centavos": 44000,
    "items": [{
      "product_id": 456,
      "variant_id": 123,
      "product_name": "Volume I",
      "variant_name": "12 oz",
      "unit_price_centavos": 22000,
      "quantity": 2,
      "line_total_centavos": 44000
    }]
  }
}
```

`pending` means recorded only: payment is unverified and barista acceptance is
unconfirmed. There is no checkout, payment, queue, or status-transition workflow.
The Hojicha internal catalog marker `__single_price__` becomes a null variant
name snapshot and response field, never an invented customer-facing size.
References are unique ULIDs prefixed `HARU-`, not sequential database IDs. ULIDs
contain a timestamp and are not authentication secrets.

Limits: 16 KiB JSON body, 50 submitted lines, 20 drinks per combined variant,
100 drinks overall, and PHP 100,000 (10,000,000 centavos) subtotal. These are
operational safety ceilings, not fees or changes to catalog pricing. Repeated
variant IDs are merged before limits and fingerprinting; distinct variants stay
separate. Adjustments to these ceilings need matching validation/tests and any
applicable database constraints.

Validation errors return 422, changed intent under the same key returns 409,
and throttling returns 429 with retry headers. Unexpected errors return a generic
500, even in debug mode, with instructions to retry using the same key. The
response excludes internal order/item IDs, fingerprints, retry keys, timestamps,
SQL, connection details, and exception traces. Server logs still require normal
access controls.

## Pricing, transactions and idempotency

Laravel loads the requested variants and their parent products/categories from
the primary database, locks each level in ascending ID order, and checks all
three active flags. Prices, names and associations come from those locked rows.
Integer centavos are checked against the ceiling before multiplication/addition.
Orders and every item snapshot are written in one transaction. No HTTP calls or
external side effects occur inside the transaction. Catalog records are never
modified by order creation.

The request UUID is lowercased. Item IDs are sorted numerically and duplicate
quantities combined. SHA-256 fingerprints cover this normalized item list, not
client prices. Identical retries return the original snapshots without repricing
or rechecking current catalog availability. Changed quantities or variants under
the same key return 409. A changed/new order needs a new UUID.

The action checks the key again after acquiring catalog locks, before validating
current availability or prices. A competing order may have committed while the
retry waited for those locks. Under READ COMMITTED the second lookup sees that
winner and returns its snapshots (or a conflict), even if the catalog has since
changed. It must not reject an already-recorded order using today's catalog.

Both reference and idempotency key have database unique constraints. A duplicate
insert waits for the competing PostgreSQL transaction, then fails uniquely if
that transaction commits. The failed transaction is rolled back before reading
the winner from the primary connection and comparing fingerprints. Reference
collisions receive bounded retries with a new ULID; transactions also have
bounded deadlock retries. Do not remove the unique constraints or catch a unique
violation inside a PostgreSQL transaction and continue querying it.

This relies on PostgreSQL's normal READ COMMITTED behavior and a primary database
connection for replays. Deployment changes to isolation, read replicas, pooling,
or connection routing require review. True PostgreSQL concurrent submissions,
row-lock behavior and PostgreSQL DDL are not verified by SQLite tests. The
race tests deliberately hide initial reads of an existing order. One hidden read
tests the post-lock lookup with changed catalog data; two hidden reads force an
insert attempt and SQLite's actual unique violation to exercise rollback,
replay and conflict. These are deterministic simulations, not concurrent
PostgreSQL sessions.

## Proposed schema (files only; not applied live)

`2026_11_15_110806_create_orders_table.php` creates:

- Bigint primary ID; unique varchar(32) reference; unique UUID idempotency key.
- Char(64) request fingerprint; varchar(20) status default `pending`;
  char(3) currency default `PHP`; bigint subtotal; timestamps.
- Checks enforcing nonnegative subtotal, `pending` status and `PHP` currency.
  Future status/currency workflows need an explicit schema change.

`2026_11_15_110807_create_order_items_table.php` creates:

- Bigint primary ID and required order/product/variant foreign keys, all with
  restrictive deletion; product/variant lookup indexes.
- Varchar(100) product-name snapshot and nullable varchar(50) variant snapshot.
- Bigint unit/line centavos; smallint quantity; timestamps.
- Unique `(order_id, product_variant_id)` (also indexes order lookup).
- Checks for nonnegative unit/line amounts, quantity 1–20 and exact
  `line_total_centavos = unit_price_centavos * quantity`.

The action guarantees that product/variant associations, line sums and subtotal
agree. Cross-row subtotal equality is not encoded as a database CHECK. Guarded
models prevent mass assignment; this is not a substitute for protecting direct
database access. Historical catalog rows cannot be deleted while referenced.
Catalog records should continue to be disabled instead of deleted.

These are additive migrations for two new tables and their constraints/indexes.
They do not alter the catalog, seed data, or create orders. Existing catalog
migrations are unchanged. No live migration command has been run. Applying the
schema requires separate explicit authorization and review of other pending
migrations; a generic migrate command can include unrelated pending files.
Do not roll these tables back after accepting orders without a separate data
retention/backup review, because rollback removes historical orders.

## PostgreSQL/Supabase order-table security

Both order migrations are still unapplied and now include their own access
controls. Each explicitly keeps `withinTransaction = true`; Laravel's
PostgreSQL migrator wraps that file's table creation, constraints, RLS and grants
in one transaction. A failing revoke or sequence lookup rolls that entire file
back. There is no separately committed interval with an unsecured new table.
The two files are separate transactions: if the second fails, the first table
remains created and secured, and order creation must remain disabled.

For `public.orders` and `public.order_items`, each migration:

- Rejects a creator named `anon`, `authenticated` or `service_role`, and rejects
  a current schema other than `public` before creating its table.
- Enables RLS without creating any client policies. Non-owner roles without an
  applicable policy receive PostgreSQL's default-deny row protection.
- Revokes **all** table privileges from `PUBLIC`, `anon`, `authenticated` and
  `service_role`, including privileges such as TRUNCATE that RLS does not cover.
- Resolves the actual `id` sequence with `pg_get_serial_sequence`, fails if it is
  missing, and revokes all its privileges from the same roles. This avoids
  guessing a sequence name and revoking an unrelated sequence after a name
  collision. Sequence operations need their own ACL protection.
- Explicitly grants table SELECT/INSERT and sequence USAGE/SELECT to
  `CURRENT_USER`, the private server role creating and owning these objects.
- Checks `anon`, `authenticated` and `service_role` for effective table/column
  data privileges and all sequence privileges after the revokes, rejecting
  inherited or otherwise remaining access instead of silently accepting a revoke
  warning. It also rejects a creator still subject to row security, so the trusted
  migration connection retains row access.

The security changes are scoped to these two new tables and their own sequences.
They do not change catalog tables, schema-wide/default privileges, role
memberships, credentials, or Supabase project settings. Supabase's standard
`anon`, `authenticated` and `service_role` roles must exist; missing roles cause
migration failure rather than silently skipping the revokes. No Supabase system
role attributes are modified. In particular, `service_role` is denied these
objects through ACL revocation despite its ability to bypass RLS.

### Laravel server access

`config/database.php` uses the conventional `pgsql` connection with a `public`
search path. Both Artisan and Eloquent use the configured database identity;
`DB_URL`, when supplied, can override individual connection settings. No
connection settings were changed, and no .env files were read or modified.

The deployment contract is that migrations and the Laravel API use the **same
private PostgreSQL role**. Creating the tables makes that role their owner, and
the explicit grants preserve read/insert and ID generation even with customized
default ACLs. RLS is deliberately **not forced**: PostgreSQL owners normally
bypass it, so Laravel does not need a public or authenticated-user policy.
This follows [PostgreSQL's RLS owner rules](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).
The additional ACL revokes follow the separation of grants and RLS described in
[Supabase's Data API security guide](https://supabase.com/docs/guides/api/securing-your-api).

The private owner must be distinct from `anon`, `authenticated` and
`service_role`. Required live preflight, under separate read-only authorization:
confirm the effective `CURRENT_USER` for both the migration and API connections
(not merely DB_USERNAME, since DB_URL or role switching can change the identity),
and verify that they use the intended private owner. Confirm the blocked roles
cannot inherit or assume that owner role. Do not print passwords or connection
strings. This identity cannot be guaranteed offline and has not been checked live.
If Laravel currently uses `service_role`, **stop deployment** and report the
connection-design conflict for review; do not restore service_role grants or
silently change the connection/role to make the migration pass. The migrations
reject that creator before creating either table.

If deployment uses a separate non-owner runtime role, these grants to the
migration owner do not authorize that other role. Review a dedicated server-only
policy and minimum table/sequence privileges separately before enabling orders;
do not work around this by granting access to `anon`/`authenticated`/`service_role`
or adding a blanket client policy. No runtime-role name or password is hardcoded.

Live role identity, ownership, effective privileges and RLS behavior have not
been inspected or tested. Before endpoint activation, separately authorized
read-only verification should confirm owners, RLS enabled/unforced, no unexpected
policies, and effective table/sequence privileges for the runtime and API roles.
Review inherited grants, privileged role membership and SECURITY DEFINER/RPC
functions that could bypass these boundaries. Owners and other BYPASSRLS roles
can remain privileged when they retain the needed object grants; protect their
credentials. The blocked service_role must not regain table/sequence access.
Recheck these controls after any later ownership or privilege change.

### Scope the eventual migration operation

Offline inventory contains nine migration files. The two order files are the
only additions since the catalog foundation. Seven older files remain:

- `0001_01_01_000000_create_users_table.php`
- `0001_01_01_000001_create_cache_table.php`
- `0001_01_01_000002_create_jobs_table.php`
- `2026_11_04_145222_create_personal_access_tokens_table.php`
- `2026_11_04_145816_create_categories_table.php`
- `2026_11_05_225111_create_products_table.php`
- `2026_11_05_225112_create_product_variants_table.php`

Project history reports the older foundation migrated, but the live migration
ledger cannot be confirmed offline. A plain `migrate` could apply any older file
missing from that ledger. No additional migration file was added for hardening.
`backend/composer.json` also has two unrestricted migration entry points:
`composer run setup` invokes `artisan migrate --force`, and its
`post-create-project-cmd` hook invokes `artisan migrate --graceful --ansi`.
Do not run these bootstrap paths against the live project during this deployment.
After separate deployment approval and environment/ledger verification, restrict
the operation to these two files. Proposed command from `backend`, **not run**:

```text
php artisan migrate --database=pgsql --path=database/migrations/2026_11_15_110806_create_orders_table.php --path=database/migrations/2026_11_15_110807_create_order_items_table.php
```

Do not run it under the current inspection/hardening authorization. Confirm the
API also uses the reviewed pgsql connection/role. Do not enable the order feature,
seed data, create sample orders, or invoke an unrestricted migration command as
part of this operation. There is no `--force` bypass.

## Isolated checks

Run PHPUnit from `backend` with the existing `phpunit.xml`. `OrderTestCase`
inherits the fail-closed environment/SQLite/:memory: checks from
`CatalogTestCase`, then creates SQLite fixture tables directly. It never invokes
Artisan migrations or targets Supabase. The PostgreSQL checks have SQLite
fixture equivalents; fixture checks are not a PostgreSQL integration test.
`OrderSchemaTest` additionally compiles both new migrations with Laravel's
PostgreSQL schema grammar inside database pretend mode, checks the emitted
foreign keys/indexes/constraints, and verifies neither table was created. This
checks generated SQL structure without executing PostgreSQL DDL.
Security cases also check each file's transactional flag, RLS enablement,
table/sequence revokes, current-owner grants, schema/API-role guards and absence
of FORCE RLS or client policies, including the post-revoke privilege/RLS guards.
The revokes, verification loop and creator guard must all include `service_role`;
grants remain directed to the private `CURRENT_USER` rather than that API role.
SQLite does not execute the PostgreSQL DO blocks or verify actual PostgreSQL
grants/RLS. Real role isolation, DDL rollback and Laravel runtime access remain
deployment checks on an approved PostgreSQL target.

```text
php vendor/bin/phpunit --filter OrderCreationTest
php vendor/bin/phpunit
php vendor/bin/pint --test
git diff --check
```

No persistent carts, live sample orders, frontend changes, catalog writes,
dependencies, or .env changes belong to this milestone.
