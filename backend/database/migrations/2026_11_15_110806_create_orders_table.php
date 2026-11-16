<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
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
    }

    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};
