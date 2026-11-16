<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    // PostgreSQL commits table creation, constraints, and access controls together.
    public $withinTransaction = true;

    public function up(): void
    {
        DB::statement(<<<'SQL'
            DO $$
            BEGIN
                IF current_schema() IS DISTINCT FROM 'public' THEN
                    RAISE EXCEPTION 'Order migrations require the public schema search path.';
                END IF;
                IF CURRENT_USER IN ('anon', 'authenticated', 'service_role') THEN
                    RAISE EXCEPTION 'Order migrations require a private server-side owner role.';
                END IF;
            END;
            $$;
            SQL);

        Schema::create('order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->restrictOnDelete();
            $table->foreignId('product_id')->constrained()->restrictOnDelete();
            $table->foreignId('product_variant_id')->constrained()->restrictOnDelete();
            $table->string('product_name_snapshot', 100);
            $table->string('variant_name_snapshot', 50)->nullable();
            $table->bigInteger('unit_price_centavos');
            $table->unsignedSmallInteger('quantity');
            $table->bigInteger('line_total_centavos');
            $table->timestamps();
            $table->unique(['order_id', 'product_variant_id']);
            $table->index('product_id');
            $table->index('product_variant_id');
        });

        DB::statement('ALTER TABLE order_items ADD CONSTRAINT order_items_price_nonnegative CHECK (unit_price_centavos >= 0), ADD CONSTRAINT order_items_quantity_valid CHECK (quantity BETWEEN 1 AND 20), ADD CONSTRAINT order_items_total_valid CHECK (line_total_centavos >= 0 AND line_total_centavos = unit_price_centavos * quantity)');

        // No client policies: non-owner roles are denied by RLS as well as ACLs.
        // Do not FORCE RLS: the same private Laravel role owns these new tables.
        DB::statement('ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY');
        DB::statement('REVOKE ALL PRIVILEGES ON TABLE public.order_items FROM PUBLIC, anon, authenticated, service_role');
        DB::statement('GRANT SELECT, INSERT ON TABLE public.order_items TO CURRENT_USER');
        DB::statement(<<<'SQL'
            DO $$
            DECLARE
                id_sequence text := pg_get_serial_sequence('public.order_items', 'id');
                api_role text;
            BEGIN
                IF id_sequence IS NULL THEN
                    RAISE EXCEPTION 'The order item ID sequence is required.';
                END IF;
                EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', id_sequence);
                EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO CURRENT_USER', id_sequence);
                FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                    IF has_table_privilege(api_role, 'public.order_items', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                        OR has_any_column_privilege(api_role, 'public.order_items', 'SELECT, INSERT, UPDATE, REFERENCES')
                        OR has_sequence_privilege(api_role, id_sequence, 'USAGE, SELECT, UPDATE') THEN
                        RAISE EXCEPTION 'Order item access must not remain available to API roles.';
                    END IF;
                END LOOP;
                IF row_security_active('public.order_items') THEN
                    RAISE EXCEPTION 'The private server role must retain access through order item RLS.';
                END IF;
            END;
            $$;
            SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('order_items');
    }
};
