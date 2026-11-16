<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Grammars\PostgresGrammar;
use Illuminate\Database\Schema\PostgresBuilder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\CatalogTestCase;

class OrderSchemaTest extends CatalogTestCase
{
    #[DataProvider('orderMigrations')]
    public function test_order_security_is_part_of_the_atomic_creation_migration(string $filename, string $table): void
    {
        $connection = DB::connection();
        $originalGrammar = $connection->getSchemaGrammar();
        $postgresGrammar = new PostgresGrammar($connection);
        $connection->setSchemaGrammar($postgresGrammar);
        Schema::swap(new PostgresBuilder($connection));
        $migration = require database_path('migrations/'.$filename);

        try {
            $this->assertTrue($migration->withinTransaction);
            $this->assertTrue($postgresGrammar->supportsSchemaTransactions());
            $queries = $connection->pretend(fn () => $migration->up());
        } finally {
            $connection->setSchemaGrammar($originalGrammar);
            Schema::swap($connection->getSchemaBuilder());
        }

        $statements = array_column($queries, 'query');
        $sql = implode("\n", $statements);
        $this->assertContains("ALTER TABLE public.{$table} ENABLE ROW LEVEL SECURITY", $statements);
        $this->assertContains("REVOKE ALL PRIVILEGES ON TABLE public.{$table} FROM PUBLIC, anon, authenticated, service_role", $statements);
        $this->assertContains("GRANT SELECT, INSERT ON TABLE public.{$table} TO CURRENT_USER", $statements);
        $this->assertStringContainsString("pg_get_serial_sequence('public.{$table}', 'id')", $sql);
        $this->assertStringContainsString('IF id_sequence IS NULL THEN', $sql);
        $this->assertStringContainsString('REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', $sql);
        $this->assertStringContainsString('GRANT USAGE, SELECT ON SEQUENCE %s TO CURRENT_USER', $sql);
        $this->assertStringContainsString("FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']", $sql);
        $this->assertStringContainsString("has_table_privilege(api_role, 'public.{$table}', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')", $sql);
        $this->assertStringContainsString("has_any_column_privilege(api_role, 'public.{$table}', 'SELECT, INSERT, UPDATE, REFERENCES')", $sql);
        $this->assertStringContainsString("has_sequence_privilege(api_role, id_sequence, 'USAGE, SELECT, UPDATE')", $sql);
        $this->assertStringContainsString("IF row_security_active('public.{$table}') THEN", $sql);
        $this->assertStringContainsString("IF CURRENT_USER IN ('anon', 'authenticated', 'service_role') THEN", $statements[0]);
        $this->assertStringContainsString("IF current_schema() IS DISTINCT FROM 'public' THEN", $statements[0]);
        $this->assertStringContainsString('RAISE EXCEPTION', $statements[0]);
        $this->assertStringContainsString('RAISE EXCEPTION', $statements[array_key_last($statements)]);
        $this->assertStringNotContainsString('FORCE ROW LEVEL SECURITY', $sql);
        $this->assertStringNotContainsString('CREATE POLICY', $sql);
        $this->assertStringNotContainsString('ALL TABLES IN SCHEMA', $sql);
        $this->assertStringNotContainsString('ALL SEQUENCES IN SCHEMA', $sql);
        $this->assertStringNotContainsString('ALTER DEFAULT PRIVILEGES', $sql);
        $this->assertStringNotContainsString('CREATE ROLE', $sql);
        $this->assertStringNotContainsString('ALTER ROLE', $sql);
        $this->assertStringNotContainsString('TO service_role', $sql);
        $this->assertStringStartsWith('create table "'.$table.'"', $statements[1]);
        $this->assertFalse(Schema::hasTable($table));
    }

    public static function orderMigrations(): array
    {
        return [
            'orders' => ['2026_11_15_110806_create_orders_table.php', 'orders'],
            'order items' => ['2026_11_15_110807_create_order_items_table.php', 'order_items'],
        ];
    }

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
