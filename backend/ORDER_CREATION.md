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

```text
php vendor/bin/phpunit --filter OrderCreationTest
php vendor/bin/phpunit
php vendor/bin/pint --test
git diff --check
```

No persistent carts, live sample orders, frontend changes, catalog writes,
dependencies, or .env changes belong to this milestone.
