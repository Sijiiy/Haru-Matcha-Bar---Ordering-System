<?php

namespace Tests;

use App\Models\Product;
use App\Models\ProductVariant;
use Database\Seeders\HaruCatalogSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

abstract class OrderTestCase extends CatalogTestCase
{
    protected function setUp(): void
    {
        // CatalogTestCase checks testing + sqlite + :memory: before any DDL.
        parent::setUp();

        // SQLite equivalents of the proposed PostgreSQL schema: no migration
        // commands are run and no persistent database is used by these tests.
        DB::statement("CREATE TABLE orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_reference VARCHAR(32) NOT NULL UNIQUE,
            idempotency_key VARCHAR(36) NOT NULL UNIQUE,
            request_fingerprint CHAR(64) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status = 'pending'),
            currency CHAR(3) NOT NULL DEFAULT 'PHP' CHECK (currency = 'PHP'),
            subtotal_centavos BIGINT NOT NULL CHECK (subtotal_centavos >= 0),
            created_at DATETIME, updated_at DATETIME
        )");
        DB::statement('CREATE TABLE order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
            product_variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
            product_name_snapshot VARCHAR(100) NOT NULL,
            variant_name_snapshot VARCHAR(50),
            unit_price_centavos BIGINT NOT NULL CHECK (unit_price_centavos >= 0),
            quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
            line_total_centavos BIGINT NOT NULL CHECK (line_total_centavos >= 0 AND line_total_centavos = unit_price_centavos * quantity),
            created_at DATETIME, updated_at DATETIME,
            UNIQUE (order_id, product_variant_id)
        )');

        (new HaruCatalogSeeder)->run();
        config(['orders.creation_enabled' => true]);
    }

    protected function variant(string $slug = 'volume-i', string $name = '12 oz'): ProductVariant
    {
        return Product::where('slug', $slug)->firstOrFail()->variants()->where('name', $name)->firstOrFail();
    }

    protected function payload(?array $items = null, ?string $key = null): array
    {
        return [
            'idempotency_key' => $key ?? (string) Str::uuid(),
            'items' => $items ?? [['variant_id' => $this->variant()->id, 'quantity' => 2]],
        ];
    }
}
