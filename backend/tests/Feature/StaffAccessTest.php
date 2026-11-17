<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\User;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\OrderTestCase;

class StaffAccessTest extends OrderTestCase
{
    protected function setUp(): void
    {
        parent::setUp(); // Fail-closed testing/sqlite/:memory: guard before DDL.
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('email')->unique();
            $table->string('password');
            $table->boolean('is_staff')->default(false);
            $table->rememberToken();
            $table->timestamps();
        });
        config(['staff.access_enabled' => true, 'orders.creation_enabled' => false]);
    }

    private function user(bool $staff = false): User
    {
        $user = new User;
        $user->name = 'Fixture staff';
        $user->email = 'fixture@example.test';
        $user->password = Hash::make('fixture-password-only');
        $user->is_staff = $staff;
        $user->save();

        return $user;
    }

    private function order(): Order
    {
        $variant = $this->variant();
        $order = new Order;
        $order->order_reference = 'HARU-'.Str::ulid();
        $order->idempotency_key = (string) Str::uuid();
        $order->request_fingerprint = hash('sha256', 'fixture');
        $order->status = 'pending';
        $order->currency = 'PHP';
        $order->subtotal_centavos = 44000;
        $order->save();
        $item = new OrderItem;
        $item->product_id = $variant->product_id;
        $item->product_variant_id = $variant->id;
        $item->product_name_snapshot = 'Volume I';
        $item->variant_name_snapshot = '12 oz';
        $item->unit_price_centavos = 22000;
        $item->quantity = 2;
        $item->line_total_centavos = 44000;
        $order->items()->save($item);

        return $order;
    }

    public function test_guests_cannot_enumerate_orders_or_use_bearer_tokens(): void
    {
        $reference = $this->order()->order_reference;
        foreach (['/api/staff/orders', '/api/staff/orders/'.$reference, '/api/staff/session'] as $url) {
            $this->getJson($url)->assertUnauthorized()->assertHeader('Cache-Control', 'no-store, private');
            $this->withHeader('Authorization', 'Bearer fixture-not-a-session')->getJson($url)->assertUnauthorized();
        }
        $this->get('/api/staff/orders')->assertUnauthorized();
    }

    public function test_nonstaff_gets_the_same_forbidden_response_before_any_order_lookup(): void
    {
        $reference = $this->order()->order_reference;
        $this->actingAs($this->user());
        $orderQueries = [];
        DB::listen(function ($event) use (&$orderQueries): void {
            if (str_contains($event->sql, '"orders"')) {
                $orderQueries[] = $event->sql;
            }
        });
        $this->getJson('/api/staff/orders')->assertForbidden();
        $this->getJson('/api/staff/orders/'.$reference)->assertForbidden();
        $this->getJson('/api/staff/orders/HARU-01ARZ3NDEKTSV4RRFFQ69G5FAV')->assertForbidden();
        $this->getJson('/api/staff/session')->assertForbidden();
        $this->assertSame([], $orderQueries);
    }

    public function test_feature_is_off_by_default_and_blocks_before_database_session_or_limiter_access(): void
    {
        $this->assertFalse((require config_path('staff.php'))['access_enabled']);
        config(['staff.access_enabled' => false, 'session.driver' => 'database']);
        foreach (['/api/staff/orders', '/api/staff/session'] as $url) {
            $this->getJson($url)->assertStatus(503)->assertHeader('Cache-Control', 'no-store, private');
        }
        $this->postJson('/api/staff/login', ['email' => 'fixture@example.test', 'password' => 'irrelevant'])->assertStatus(503);
        $this->postJson('/api/orders', $this->payload())->assertStatus(503);
    }

    public function test_staff_list_has_bounded_pagination_and_stable_oldest_first_ordering(): void
    {
        $older = $this->order();
        $older->created_at = now()->subDay();
        $older->save();
        $first = $this->order();
        $second = $this->order();
        $second->created_at = $first->created_at;
        $second->save();
        $this->actingAs($this->user(true));
        $page = $this->getJson('/api/staff/orders?per_page=2')->assertOk()
            ->assertJsonPath('meta.current_page', 1)->assertJsonPath('meta.last_page', 2)
            ->assertJsonPath('meta.total', 3)->assertJsonCount(2, 'data');
        $page->assertJsonPath('data.0.order_reference', $older->order_reference)
            ->assertJsonPath('data.1.order_reference', $first->order_reference);
        $this->getJson('/api/staff/orders?per_page=2&page=2')->assertOk()
            ->assertJsonPath('data.0.order_reference', $second->order_reference);
        foreach (['per_page=26', 'per_page=0', 'page=0', 'page=10001', 'page=bad'] as $query) {
            $this->getJson('/api/staff/orders?'.$query)->assertUnprocessable();
        }
    }

    public function test_staff_details_use_historical_snapshots_and_only_intended_fields_without_writes(): void
    {
        $order = $this->order();
        $variant = $this->variant();
        $variant->product->update(['name' => 'Changed fixture catalog name']);
        $variant->update(['price_centavos' => 1]);
        $beforeOrder = $order->fresh()->getAttributes();
        $beforeItem = $order->items()->first()->getAttributes();
        $this->actingAs($this->user(true));
        $response = $this->getJson('/api/staff/orders/'.$order->order_reference)->assertOk();
        $response->assertExactJson(['data' => [
            'order_reference' => $order->order_reference,
            'created_at' => $order->created_at->toISOString(), 'status' => 'pending', 'currency' => 'PHP',
            'subtotal_centavos' => 44000,
            'items' => [['product_name' => 'Volume I', 'variant_name' => '12 oz',
                'unit_price_centavos' => 22000, 'quantity' => 2, 'line_total_centavos' => 44000]],
        ]])->assertHeader('Cache-Control', 'no-store, private');
        $this->getJson('/api/staff/orders')->assertOk();
        $this->assertSame($beforeOrder, $order->fresh()->getAttributes());
        $this->assertSame($beforeItem, $order->items()->first()->getAttributes());
        $this->assertStringNotContainsString('idempotency', $response->getContent());
        $this->assertStringNotContainsString('fingerprint', $response->getContent());
        $this->getJson('/api/staff/orders/HARU-01ARZ3NDEKTSV4RRFFQ69G5FAV')->assertNotFound();
        $this->patchJson('/api/staff/orders/'.$order->order_reference, ['status' => 'paid'])->assertStatus(405);
    }

    public function test_order_items_are_eager_loaded_once_for_an_entire_page(): void
    {
        for ($i = 0; $i < 4; $i++) {
            $this->order();
        }
        $this->actingAs($this->user(true));
        $queries = 0;
        DB::listen(function ($event) use (&$queries): void {
            if (str_starts_with($event->sql, 'select') && str_contains($event->sql, '"order_items"')) {
                $queries++;
            }
        });
        $this->getJson('/api/staff/orders')->assertOk()->assertJsonCount(4, 'data');
        $this->assertSame(1, $queries);
    }

    public function test_successful_staff_login_rotates_session_and_logout_removes_authentication(): void
    {
        $this->user(true);
        $this->withSession(['_token' => 'fixture-original-token']);
        $oldId = session()->getId();
        $this->postJson('/api/staff/login', ['email' => 'fixture@example.test', 'password' => 'fixture-password-only'])
            ->assertOk()->assertExactJson(['data' => ['name' => 'Fixture staff']]);
        $this->assertAuthenticated('web');
        $this->assertNotSame($oldId, session()->getId());
        $this->assertNotSame('fixture-original-token', session()->token());
        $this->getJson('/api/staff/session')->assertOk();
        config(['staff.access_enabled' => false]);
        $this->postJson('/api/staff/logout')->assertNoContent();
        $this->assertGuest('web');
    }

    public function test_nonstaff_credentials_and_permission_injection_do_not_grant_staff_login(): void
    {
        $this->user();
        $credentials = ['email' => 'fixture@example.test', 'password' => 'fixture-password-only'];
        $this->postJson('/api/staff/login', $credentials)->assertUnprocessable();
        $this->postJson('/api/staff/login', [...$credentials, 'is_staff' => true])->assertUnprocessable();
        $this->assertGuest('web');
        $this->assertFalse(User::first()->is_staff);
        $user = new User(['name' => 'Default', 'email' => 'default@example.test', 'password' => 'fixture-only', 'is_staff' => true]);
        $user->save();
        $this->assertFalse($user->fresh()->is_staff);
        $this->assertArrayNotHasKey('is_staff', $user->fresh()->toArray());
    }

    public function test_login_is_rate_limited_and_forged_cross_site_requests_need_a_csrf_token(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/staff/login', ['email' => 'absent@example.test', 'password' => 'fixture-only'])->assertUnprocessable();
        }
        $this->postJson('/api/staff/login', ['email' => 'absent@example.test', 'password' => 'fixture-only'])->assertStatus(429);
        $this->app->bind(PreventRequestForgery::class, fn ($app) => new class($app, $app['encrypter']) extends PreventRequestForgery
        {
            protected function runningUnitTests(): bool
            {
                return false;
            }
        });
        $this->postJson('/api/staff/login', ['email' => 'other@example.test', 'password' => 'fixture-only'], ['Sec-Fetch-Site' => 'cross-site'])->assertStatus(419);
        $this->withSession(['_token' => 'matching-fixture-token'])->postJson('/api/staff/login',
            ['email' => 'other@example.test', 'password' => 'fixture-only'], ['X-CSRF-TOKEN' => 'matching-fixture-token'])->assertUnprocessable();
    }

    public function test_permission_revocation_takes_effect_and_no_registration_or_order_write_route_exists(): void
    {
        $user = $this->user(true);
        $this->actingAs($user);
        $this->getJson('/api/staff/orders')->assertOk()->assertJsonCount(0, 'data');
        $user->is_staff = false;
        $user->save();
        $this->getJson('/api/staff/orders')->assertForbidden();
        $this->postJson('/api/staff/orders', [])->assertStatus(405);
        $this->postJson('/api/staff/register', [])->assertNotFound();
        $this->postJson('/api/staff/logout')->assertNoContent();
    }

    public function test_unexpected_staff_errors_are_redacted_even_with_debug_enabled(): void
    {
        $this->actingAs($this->user(true));
        config(['app.debug' => true]);
        Schema::drop('order_items');
        $order = new Order;
        $order->order_reference = 'HARU-'.Str::ulid();
        $order->idempotency_key = (string) Str::uuid();
        $order->request_fingerprint = hash('sha256', 'fixture');
        $order->status = 'pending';
        $order->currency = 'PHP';
        $order->subtotal_centavos = 0;
        $order->save();
        $this->getJson('/api/staff/orders')->assertStatus(500)->assertExactJson(['message' => 'The staff request could not be completed.']);
    }

    public function test_csrf_cookie_bootstrap_and_logout_protection_work_without_issuing_api_tokens(): void
    {
        $csrf = $this->getJson('/sanctum/csrf-cookie')->assertNoContent();
        $csrf->assertCookie('XSRF-TOKEN');
        $this->assertFalse($csrf->getCookie('XSRF-TOKEN')->isHttpOnly());
        $this->actingAs($this->user(true));
        $this->app->bind(PreventRequestForgery::class, fn ($app) => new class($app, $app['encrypter']) extends PreventRequestForgery
        {
            protected function runningUnitTests(): bool
            {
                return false;
            }
        });
        $this->postJson('/api/staff/logout')->assertStatus(419);
        $this->assertAuthenticated('web');
        $this->withSession(['_token' => 'logout-fixture-token'])->postJson('/api/staff/logout', [], ['X-CSRF-TOKEN' => 'logout-fixture-token'])->assertNoContent();
        $this->assertGuest('web');
    }

    public function test_additive_permission_migration_compiles_with_default_deny_without_running_it(): void
    {
        $before = User::create(['name' => 'Default', 'email' => 'default@example.test', 'password' => 'fixture-only']);
        $this->assertFalse($before->fresh()->is_staff);
        $sql = DB::connection()->pretend(fn () => (require database_path('migrations/2026_11_17_140000_add_is_staff_to_users_table.php'))->up());
        $this->assertCount(1, $sql);
        $this->assertStringContainsString('is_staff', $sql[0]['query']);
        $this->assertMatchesRegularExpression('/default [\'\"]?0/', $sql[0]['query']);
        $this->assertFalse($before->fresh()->is_staff);
        $this->postJson('/api/staff/login', ['email' => ['invalid'], 'password' => 'fixture-only'])->assertUnprocessable();
    }
}
