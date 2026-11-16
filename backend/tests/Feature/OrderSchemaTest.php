<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Grammars\PostgresGrammar;
use Illuminate\Database\Schema\PostgresBuilder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\CatalogTestCase;

class OrderSchemaTest extends CatalogTestCase
{
    public function test_proposed_migrations_compile_restrictive_keys_indexes_and_checks_without_executing_ddl(): void
    {
        // The parent guard has already enforced SQLite :memory:. Pretend mode
        // compiles PostgreSQL SQL only; it never sends that SQL to a database.
        $connection = DB::connection();
        $originalGrammar = $connection->getSchemaGrammar();
        $connection->setSchemaGrammar(new PostgresGrammar($connection));
        Schema::swap(new PostgresBuilder($connection));

        try {
            $queries = $connection->pretend(function (): void {
                (require database_path('migrations/2026_11_15_110806_create_orders_table.php'))->up();
                (require database_path('migrations/2026_11_15_110807_create_order_items_table.php'))->up();
            });
        } finally {
            $connection->setSchemaGrammar($originalGrammar);
            Schema::swap($connection->getSchemaBuilder());
        }

        $sql = implode("\n", array_column($queries, 'query'));
        $this->assertStringContainsString('"idempotency_key" uuid not null', $sql);
        $this->assertStringContainsString('unique ("idempotency_key")', $sql);
        $this->assertStringContainsString('unique ("order_reference")', $sql);
        $this->assertStringContainsString('unique ("order_id", "product_variant_id")', $sql);
        $this->assertStringContainsString('create index "order_items_product_id_index"', $sql);
        $this->assertStringContainsString('create index "order_items_product_variant_id_index"', $sql);
        $this->assertSame(3, substr_count($sql, 'on delete restrict'));
        $this->assertStringContainsString('CHECK (subtotal_centavos >= 0)', $sql);
        $this->assertStringContainsString('CHECK (quantity BETWEEN 1 AND 20)', $sql);
        $this->assertStringContainsString('line_total_centavos = unit_price_centavos * quantity', $sql);
        $this->assertFalse(Schema::hasTable('orders'));
        $this->assertFalse(Schema::hasTable('order_items'));
    }
}
