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

        Schema::create('orders', function (Blueprint $table) {
            $table->id();
            $table->string('order_reference', 32)->unique();
            $table->uuid('idempotency_key')->unique();
            $table->char('request_fingerprint', 64);
            $table->string('status', 20)->default('pending');
            $table->char('currency', 3)->default('PHP');
            $table->bigInteger('subtotal_centavos');
            $table->timestamps();
        });

        DB::statement("ALTER TABLE orders ADD CONSTRAINT orders_subtotal_nonnegative CHECK (subtotal_centavos >= 0), ADD CONSTRAINT orders_status_pending CHECK (status = 'pending'), ADD CONSTRAINT orders_currency_php CHECK (currency = 'PHP')");

        // No client policies: non-owner roles are denied by RLS as well as ACLs.
        // Do not FORCE RLS: the same private Laravel role owns these new tables.
        DB::statement('ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY');
        DB::statement('REVOKE ALL PRIVILEGES ON TABLE public.orders FROM PUBLIC, anon, authenticated, service_role');
        DB::statement('GRANT SELECT, INSERT ON TABLE public.orders TO CURRENT_USER');
        DB::statement(<<<'SQL'
            DO $$
            DECLARE
                id_sequence text := pg_get_serial_sequence('public.orders', 'id');
                api_role text;
            BEGIN
                IF id_sequence IS NULL THEN
                    RAISE EXCEPTION 'The order ID sequence is required.';
                END IF;
                EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', id_sequence);
                EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO CURRENT_USER', id_sequence);
                FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                    IF has_table_privilege(api_role, 'public.orders', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                        OR has_any_column_privilege(api_role, 'public.orders', 'SELECT, INSERT, UPDATE, REFERENCES')
                        OR has_sequence_privilege(api_role, id_sequence, 'USAGE, SELECT, UPDATE') THEN
                        RAISE EXCEPTION 'Order access must not remain available to API roles.';
                    END IF;
                END LOOP;
                IF row_security_active('public.orders') THEN
                    RAISE EXCEPTION 'The private server role must retain access through order RLS.';
                END IF;
            END;
            $$;
            SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};
