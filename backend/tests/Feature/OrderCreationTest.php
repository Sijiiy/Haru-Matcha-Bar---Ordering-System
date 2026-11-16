<?php

namespace Tests\Feature;

use App\Actions\CreateOrder;
use App\Models\Category;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\ProductVariant;
use Database\Seeders\HaruCatalogSeeder;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\MassAssignmentException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\OrderTestCase;

class OrderCreationTest extends OrderTestCase
{
    public function test_public_endpoint_creates_pending_order_with_authoritative_prices_and_snapshots(): void
    {
        $variant = $this->variant();
        $response = $this->postJson('/api/orders', $this->payload())->assertCreated();
        $data = $response->json('data');

        $this->assertMatchesRegularExpression('/^HARU-[0-9A-HJKMNP-TV-Z]{26}$/', $data['order_reference']);
        $response->assertExactJson(['data' => [
            'order_reference' => $data['order_reference'],
            'status' => 'pending',
            'currency' => 'PHP',
            'subtotal_centavos' => 44000,
            'items' => [[
                'product_id' => $variant->product_id,
                'variant_id' => $variant->id,
                'product_name' => 'Volume I',
                'variant_name' => '12 oz',
                'unit_price_centavos' => 22000,
                'quantity' => 2,
                'line_total_centavos' => 44000,
            ]],
        ]]);
        $this->assertDatabaseCount('orders', 1);
        $this->assertDatabaseCount('order_items', 1);
        $this->assertDatabaseHas('order_items', [
            'product_id' => $variant->product_id,
            'product_variant_id' => $variant->id,
            'product_name_snapshot' => 'Volume I',
            'variant_name_snapshot' => '12 oz',
            'unit_price_centavos' => 22000,
            'quantity' => 2,
            'line_total_centavos' => 44000,
        ]);
        $this->assertIsInt($data['subtotal_centavos']);
        $this->assertIsInt($data['items'][0]['unit_price_centavos']);
        $this->assertSame(64, strlen(Order::firstOrFail()->request_fingerprint));
    }

    public function test_different_variants_remain_separate_and_duplicate_ids_merge(): void
    {
        $small = $this->variant();
        $large = $this->variant('volume-i', '16 oz (5g)');
        $response = $this->postJson('/api/orders', $this->payload([
            ['variant_id' => $large->id, 'quantity' => 1],
            ['variant_id' => $small->id, 'quantity' => 1],
            ['variant_id' => $small->id, 'quantity' => 2],
        ]))->assertCreated()->assertJsonPath('data.subtotal_centavos', 97000)->assertJsonCount(2, 'data.items');

        $this->assertSame([$small->id, $large->id], array_column($response->json('data.items'), 'variant_id'));
        $this->assertSame([3, 1], array_column($response->json('data.items'), 'quantity'));
        $this->assertDatabaseCount('order_items', 2);
    }

    public function test_single_price_hojicha_snapshot_does_not_invent_a_visible_variant(): void
    {
        $variant = $this->variant('hojicha', HaruCatalogSeeder::SINGLE_PRICE_NAME);
        $this->postJson('/api/orders', $this->payload([['variant_id' => $variant->id, 'quantity' => 1]]))
            ->assertCreated()->assertJsonPath('data.items.0.variant_name', null)
            ->assertJsonPath('data.items.0.product_name', 'Hojicha')
            ->assertJsonPath('data.subtotal_centavos', 18000);
        $this->assertDatabaseHas('order_items', ['variant_name_snapshot' => null]);
    }

    #[DataProvider('invalidPayloads')]
    public function test_malformed_or_manipulated_requests_are_rejected(array $changes, string $error): void
    {
        $payload = array_replace($this->payload(), $changes);
        $this->postJson('/api/orders', $payload)->assertUnprocessable()->assertJsonValidationErrors($error);
        $this->assertDatabaseCount('orders', 0);
        $this->assertDatabaseCount('order_items', 0);
    }

    public static function invalidPayloads(): array
    {
        return [
            'missing key' => [['idempotency_key' => null], 'idempotency_key'],
            'invalid uuid' => [['idempotency_key' => 'not-a-uuid'], 'idempotency_key'],
            'empty items' => [['items' => []], 'items'],
            'missing items' => [['items' => null], 'items'],
            'invalid variant' => [['items' => [['variant_id' => 999999, 'quantity' => 1]]], 'items'],
            'zero variant' => [['items' => [['variant_id' => 0, 'quantity' => 1]]], 'items.0.variant_id'],
            'string variant' => [['items' => [['variant_id' => '1', 'quantity' => 1]]], 'items.0.variant_id'],
            'zero quantity' => [['items' => [['variant_id' => 1, 'quantity' => 0]]], 'items.0.quantity'],
            'negative quantity' => [['items' => [['variant_id' => 1, 'quantity' => -1]]], 'items.0.quantity'],
            'excessive quantity' => [['items' => [['variant_id' => 1, 'quantity' => 21]]], 'items.0.quantity'],
            'decimal quantity' => [['items' => [['variant_id' => 1, 'quantity' => 1.5]]], 'items.0.quantity'],
            'string quantity' => [['items' => [['variant_id' => 1, 'quantity' => '2']]], 'items.0.quantity'],
            'boolean quantity' => [['items' => [['variant_id' => 1, 'quantity' => true]]], 'items.0.quantity'],
            'missing quantity' => [['items' => [['variant_id' => 1]]], 'items.0.quantity'],
            'fake root price' => [['price_centavos' => 1], 'request'],
            'fake subtotal' => [['subtotal_centavos' => 1], 'request'],
            'fake status' => [['status' => 'paid'], 'request'],
            'fake payment' => [['payment_verified' => true], 'request'],
            'null unexpected field' => [['total' => null], 'request'],
            'fake line price' => [['items' => [['variant_id' => 1, 'quantity' => 1, 'price_centavos' => 1]]], 'items.0'],
            'null unexpected line field' => [['items' => [['variant_id' => 1, 'quantity' => 1, 'unit_price_centavos' => null]]], 'items.0'],
        ];
    }

    public function test_inactive_variants_products_and_categories_cannot_be_ordered(): void
    {
        foreach ([$this->variant(), $this->variant()->product, $this->variant()->product->category] as $record) {
            $record->update(['is_active' => false]);
            $this->postJson('/api/orders', $this->payload())->assertUnprocessable()->assertJsonValidationErrors('items');
            $this->assertDatabaseCount('orders', 0);
            $record->update(['is_active' => true]);
        }
    }

    public function test_aggregated_quantities_and_order_size_are_bounded(): void
    {
        $variant = $this->variant();
        $this->postJson('/api/orders', $this->payload([
            ['variant_id' => $variant->id, 'quantity' => 11],
            ['variant_id' => $variant->id, 'quantity' => 10],
        ]))->assertUnprocessable()->assertJsonValidationErrors('items');

        $items = ProductVariant::orderBy('id')->limit(6)->get()
            ->map(fn ($variant) => ['variant_id' => $variant->id, 'quantity' => 20])->all();
        $this->postJson('/api/orders', $this->payload($items))->assertUnprocessable()->assertJsonValidationErrors('items');
        $this->postJson('/api/orders', $this->payload(array_fill(0, 51, ['variant_id' => $variant->id, 'quantity' => 1])))
            ->assertUnprocessable()->assertJsonValidationErrors('items');
        $this->assertDatabaseCount('orders', 0);
    }

    public function test_maximum_quantity_and_maximum_total_drinks_are_accepted(): void
    {
        $items = ProductVariant::orderBy('id')->limit(5)->get()
            ->map(fn ($variant) => ['variant_id' => $variant->id, 'quantity' => 20])->all();
        $this->postJson('/api/orders', $this->payload($items))->assertCreated()->assertJsonCount(5, 'data.items');
        $this->assertSame(100, (int) OrderItem::sum('quantity'));
    }

    public function test_overflow_negative_prices_and_excessive_subtotals_are_rejected_before_writes(): void
    {
        $variant = $this->variant();
        foreach ([PHP_INT_MAX, -1, CreateOrder::MAX_SUBTOTAL_CENTAVOS] as $price) {
            $variant->update(['price_centavos' => $price]);
            $this->postJson('/api/orders', $this->payload())->assertUnprocessable()->assertJsonValidationErrors('items');
        }

        $variants = ProductVariant::orderBy('id')->limit(2)->get();
        foreach ($variants as $variant) {
            $variant->update(['price_centavos' => 6000000]);
        }
        $this->postJson('/api/orders', $this->payload($variants->map(fn ($variant) => ['variant_id' => $variant->id, 'quantity' => 1])->all()))
            ->assertUnprocessable()->assertJsonValidationErrors('items');
        $this->assertDatabaseCount('orders', 0);
    }

    public function test_same_key_replays_normalized_request_without_duplicates(): void
    {
        $small = $this->variant()->id;
        $large = $this->variant('volume-i', '16 oz (5g)')->id;
        $payload = $this->payload([
            ['variant_id' => $large, 'quantity' => 1],
            ['variant_id' => $small, 'quantity' => 1],
            ['variant_id' => $small, 'quantity' => 1],
        ]);
        $first = $this->postJson('/api/orders', $payload)->assertCreated()->json();
        $payload['idempotency_key'] = strtoupper($payload['idempotency_key']);
        $payload['items'] = [['variant_id' => $small, 'quantity' => 2], ['variant_id' => $large, 'quantity' => 1]];
        $this->postJson('/api/orders', $payload)->assertOk()->assertExactJson($first);
        $this->assertDatabaseCount('orders', 1);
        $this->assertDatabaseCount('order_items', 2);
    }

    public function test_same_key_with_different_intent_returns_conflict(): void
    {
        $payload = $this->payload();
        $this->postJson('/api/orders', $payload)->assertCreated();
        $payload['items'][0]['quantity'] = 3;
        $this->postJson('/api/orders', $payload)->assertConflict();
        $payload['items'][0] = ['variant_id' => $this->variant('volume-ii')->id, 'quantity' => 2];
        $this->postJson('/api/orders', $payload)->assertConflict();
        $this->assertDatabaseCount('orders', 1);
    }

    public function test_replay_preserves_historical_snapshots_after_catalog_changes(): void
    {
        $payload = $this->payload();
        $first = $this->postJson('/api/orders', $payload)->assertCreated()->json();
        $this->variant()->update(['price_centavos' => 1, 'name' => 'Renamed', 'is_active' => false]);
        Product::where('slug', 'volume-i')->update(['name' => 'Changed name', 'is_active' => false]);
        Category::where('slug', 'matcha')->update(['is_active' => false]);
        $this->postJson('/api/orders', $payload)->assertOk()->assertExactJson($first);
        $this->assertDatabaseCount('orders', 1);
    }

    public function test_concurrent_retry_replays_winner_before_validating_changed_catalog(): void
    {
        $payload = $this->payload();
        $first = $this->postJson('/api/orders', $payload)->assertCreated()->json();
        $this->variant()->update(['price_centavos' => PHP_INT_MAX, 'is_active' => false]);
        Product::where('slug', 'volume-i')->update(['is_active' => false]);
        Category::where('slug', 'matcha')->update(['is_active' => false]);

        // Model a winner committing after the retry's initial lookup, followed
        // by catalog changes before the retry acquires its catalog locks.
        $this->hideWinnerOnInitialReads();
        try {
            $this->postJson('/api/orders', $payload)->assertOk()->assertExactJson($first);
        } finally {
            Order::clearBootedModels();
        }
        $this->assertDatabaseCount('orders', 1);
        $this->assertDatabaseCount('order_items', 1);
    }

    public function test_concurrent_changed_intent_returns_conflict_before_catalog_validation(): void
    {
        $payload = $this->payload();
        $this->postJson('/api/orders', $payload)->assertCreated();
        $this->variant()->update(['is_active' => false]);
        $payload['items'][0]['quantity'] = 3;

        $this->hideWinnerOnInitialReads();
        try {
            $this->postJson('/api/orders', $payload)->assertConflict();
        } finally {
            Order::clearBootedModels();
        }
        $this->assertDatabaseCount('orders', 1);
        $this->assertDatabaseCount('order_items', 1);
    }

    public function test_different_keys_create_unique_nonsequential_references(): void
    {
        $first = $this->postJson('/api/orders', $this->payload())->assertCreated()->json('data.order_reference');
        $second = $this->postJson('/api/orders', $this->payload())->assertCreated()->json('data.order_reference');
        $this->assertNotSame($first, $second);
        $this->assertDatabaseCount('orders', 2);
    }

    public function test_reference_collision_is_retried_without_a_partial_order(): void
    {
        $reference = $this->postJson('/api/orders', $this->payload())->assertCreated()->json('data.order_reference');
        Str::createUlidsUsingSequence([substr($reference, 5)]);
        try {
            $this->postJson('/api/orders', $this->payload())->assertCreated();
        } finally {
            Str::createUlidsNormally();
        }
        $this->assertDatabaseCount('orders', 2);
        $this->assertDatabaseCount('order_items', 2);
    }

    public function test_unique_constraint_race_path_replays_winner_after_rollback(): void
    {
        $payload = $this->payload();
        $first = $this->postJson('/api/orders', $payload)->assertCreated()->json();
        $this->hideWinnerOnInitialReads(2);
        $insertAttempts = 0;
        Order::creating(function () use (&$insertAttempts): void {
            $insertAttempts++;
        });
        try {
            $this->postJson('/api/orders', $payload)->assertOk()->assertExactJson($first);
        } finally {
            Order::flushEventListeners();
            Order::clearBootedModels();
        }
        $this->assertSame(1, $insertAttempts);
        $this->assertDatabaseCount('orders', 1);
        $this->assertDatabaseCount('order_items', 1);
    }

    public function test_unique_constraint_race_path_rejects_different_payload(): void
    {
        $payload = $this->payload();
        $this->postJson('/api/orders', $payload)->assertCreated();
        $payload['items'][0]['quantity'] = 3;
        $this->hideWinnerOnInitialReads(2);
        $insertAttempts = 0;
        Order::creating(function () use (&$insertAttempts): void {
            $insertAttempts++;
        });
        try {
            $this->postJson('/api/orders', $payload)->assertConflict();
        } finally {
            Order::flushEventListeners();
            Order::clearBootedModels();
        }
        $this->assertSame(1, $insertAttempts);
        $this->assertDatabaseCount('orders', 1);
    }

    private function hideWinnerOnInitialReads(int $count = 1): void
    {
        // One miss models a winner becoming visible after catalog locking. Two
        // misses force the actual unique-violation/rollback recovery path.
        $reads = 0;
        Order::addGlobalScope('simulate_concurrent_winner', function (Builder $query) use (&$reads, $count): void {
            if ($reads++ < $count) {
                $query->whereRaw('0 = 1');
            }
        });
    }

    public function test_item_failure_rolls_back_entire_order_and_returns_safe_error_even_in_debug(): void
    {
        config(['app.debug' => true]);
        $created = 0;
        OrderItem::creating(function () use (&$created): void {
            if (++$created === 2) {
                throw new RuntimeException('Sensitive internal failure that must not reach the client.');
            }
        });
        $payload = $this->payload([
            ['variant_id' => $this->variant()->id, 'quantity' => 1],
            ['variant_id' => $this->variant('volume-ii')->id, 'quantity' => 1],
        ]);
        try {
            $this->postJson('/api/orders', $payload)->assertInternalServerError()->assertExactJson([
                'message' => 'We could not create your order. Please retry using the same idempotency key.',
            ]);
        } finally {
            OrderItem::flushEventListeners();
        }
        $this->assertSame(2, $created);
        $this->assertDatabaseCount('orders', 0);
        $this->assertDatabaseCount('order_items', 0);
        $this->postJson('/api/orders', $payload)->assertCreated();
    }

    public function test_disabled_feature_stops_before_database_and_limiter_access(): void
    {
        config(['orders.creation_enabled' => false, 'cache.default' => 'database']);
        $queries = [];
        DB::listen(function ($event) use (&$queries): void {
            $queries[] = $event->sql;
        });
        $this->postJson('/api/orders', ['invalid' => true])->assertServiceUnavailable()->assertExactJson([
            'message' => 'Order creation is not available.',
        ]);
        $this->assertSame([], $queries);
    }

    public function test_feature_is_disabled_in_shipped_configuration(): void
    {
        $settings = require config_path('orders.php');
        $this->assertFalse($settings['creation_enabled']);
    }

    public function test_rate_limiter_restricts_retries_without_creating_duplicates(): void
    {
        $payload = $this->payload();
        for ($request = 0; $request < 30; $request++) {
            $this->postJson('/api/orders', $payload)->assertStatus($request === 0 ? 201 : 200);
        }
        $this->postJson('/api/orders', $payload)->assertTooManyRequests()->assertHeader('Retry-After');
        $this->assertDatabaseCount('orders', 1);
    }

    public function test_malformed_json_content_type_numeric_objects_and_query_fields_are_rejected(): void
    {
        $this->call('POST', '/api/orders', [], [], [], ['CONTENT_TYPE' => 'application/json'], '{broken')->assertBadRequest();
        $this->call('POST', '/api/orders', [], [], [], ['CONTENT_TYPE' => 'application/json'], '[]')->assertBadRequest();
        $this->post('/api/orders', $this->payload())->assertUnsupportedMediaType();
        $payload = $this->payload();
        $payload['items'] = (object) ['0' => (object) ['variant_id' => $this->variant()->id, 'quantity' => 1]];
        $this->postJson('/api/orders', $payload)->assertUnprocessable()->assertJsonValidationErrors('items');
        $this->postJson('/api/orders?status=paid', $this->payload())->assertUnprocessable()->assertJsonValidationErrors('request');
        $this->call('POST', '/api/orders', [], [], [], ['CONTENT_TYPE' => 'application/json'], str_repeat(' ', 16385))->assertStatus(413);
        $this->assertDatabaseCount('orders', 0);
    }

    public function test_mass_assignment_cannot_set_order_status_or_prices(): void
    {
        foreach ([[new Order, ['status' => 'paid']], [new OrderItem, ['unit_price_centavos' => 1]]] as [$model, $attributes]) {
            try {
                $model->fill($attributes);
                $this->fail('Order models must reject mass assignment.');
            } catch (MassAssignmentException) {
                $this->assertNull($model->getAttribute(array_key_first($attributes)));
            }
        }
    }

    public function test_sqlite_fixture_enforces_money_quantity_and_restrictive_foreign_keys(): void
    {
        $this->postJson('/api/orders', $this->payload())->assertCreated();
        foreach ([
            fn () => DB::table('orders')->update(['subtotal_centavos' => -1]),
            fn () => DB::table('orders')->update(['status' => 'paid']),
            fn () => DB::table('order_items')->update(['unit_price_centavos' => -1]),
            fn () => DB::table('order_items')->update(['quantity' => 0]),
            fn () => DB::table('order_items')->update(['quantity' => 21]),
            fn () => DB::table('order_items')->update(['line_total_centavos' => 1]),
            fn () => DB::table('orders')->delete(),
            fn () => $this->variant()->delete(),
        ] as $write) {
            try {
                $write();
                $this->fail('The database must reject invalid order data.');
            } catch (QueryException) {
                $this->assertDatabaseCount('orders', 1);
                $this->assertDatabaseCount('order_items', 1);
            }
        }
    }

    public function test_existing_menu_remains_public_and_unchanged(): void
    {
        $this->getJson('/api/menu')->assertOk()->assertJsonCount(3, 'data')
            ->assertJsonPath('data.0.products.0.variants.0.price_centavos', 22000);
        $this->assertSame(18, Product::count());
        $this->assertSame(31, ProductVariant::count());
    }
}
