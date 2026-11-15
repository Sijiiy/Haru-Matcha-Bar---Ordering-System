<?php

namespace Tests;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;

abstract class CatalogTestCase extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $connection = DB::connection();
        if (! app()->environment('testing') || $connection->getDriverName() !== 'sqlite' || $connection->getConfig('database') !== ':memory:') {
            throw new RuntimeException('Catalog tests require the isolated in-memory SQLite database.');
        }

        // Endpoint/seeder tests use a minimal SQLite fixture. Production migrations
        // contain PostgreSQL ALTER TABLE CHECK syntax and remain unchanged.
        Schema::create('categories', function (Blueprint $table) {
            $table->id();
            $table->string('name', 100);
            $table->string('slug', 100)->unique();
            $table->text('description')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->foreignId('category_id')->constrained()->restrictOnDelete();
            $table->string('name', 100);
            $table->string('slug', 120)->unique();
            $table->text('description')->nullable();
            $table->string('image_path', 500)->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->index(['category_id', 'is_active', 'sort_order']);
        });

        Schema::create('product_variants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->restrictOnDelete();
            $table->string('name', 50);
            $table->integer('price_centavos');
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->unique(['product_id', 'name']);
            $table->index(['product_id', 'is_active', 'sort_order']);
        });
    }
}
