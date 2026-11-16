<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
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
    }

    public function down(): void
    {
        Schema::dropIfExists('order_items');
    }
};
