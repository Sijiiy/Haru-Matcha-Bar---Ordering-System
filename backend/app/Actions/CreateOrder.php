<?php

namespace App\Actions;

use App\Models\Category;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\ProductVariant;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class CreateOrder
{
    // Operational safety ceiling, not a pricing adjustment: PHP 100,000.
    public const MAX_SUBTOTAL_CENTAVOS = 10000000;

    /** @param array<int, array{variant_id: int, quantity: int}> $items Validated, sorted, merged request items. */
    public function handle(string $key, array $items): Order
    {
        if (config('orders.creation_enabled') !== true) {
            throw new HttpException(503);
        }

        $fingerprint = hash('sha256', json_encode($items, JSON_THROW_ON_ERROR));
        if ($existing = $this->existingOrder($key)) {
            return $this->replay($existing, $fingerprint);
        }

        for ($attempt = 0; $attempt < 3; $attempt++) {
            try {
                return DB::transaction(function () use ($key, $items, $fingerprint): Order {
                    // Lock each catalog level in deterministic ID order. Prices,
                    // names and availability remain stable until this commit.
                    $variants = ProductVariant::query()->whereIn('id', array_column($items, 'variant_id'))
                        ->orderBy('id')->lockForUpdate()->get()->keyBy('id');
                    $products = Product::query()->whereIn('id', $variants->pluck('product_id'))
                        ->orderBy('id')->lockForUpdate()->get()->keyBy('id');
                    $categories = Category::query()->whereIn('id', $products->pluck('category_id'))
                        ->orderBy('id')->lockForUpdate()->get()->keyBy('id');

                    // A competing request may have committed while we waited
                    // for its catalog locks. Replay its snapshots before current
                    // availability/pricing can incorrectly reject that retry.
                    if ($existing = $this->existingOrder($key)) {
                        return $this->replay($existing, $fingerprint);
                    }

                    $lines = [];
                    $subtotal = 0;
                    foreach ($items as $item) {
                        $variant = $variants->get($item['variant_id']);
                        $product = $variant ? $products->get($variant->product_id) : null;
                        $category = $product ? $categories->get($product->category_id) : null;
                        if (! $variant?->is_active || ! $product?->is_active || ! $category?->is_active) {
                            throw ValidationException::withMessages(['items' => 'One or more selected drinks are unavailable. Please review the menu.']);
                        }

                        $price = $variant->price_centavos;
                        // Check before multiplication/addition, keeping arithmetic integer-only.
                        if ($price < 0 || $price > intdiv(self::MAX_SUBTOTAL_CENTAVOS, $item['quantity'])) {
                            throw ValidationException::withMessages(['items' => 'The order exceeds the supported amount.']);
                        }
                        $lineTotal = $price * $item['quantity'];
                        if ($lineTotal > self::MAX_SUBTOTAL_CENTAVOS - $subtotal) {
                            throw ValidationException::withMessages(['items' => 'The order exceeds the supported amount.']);
                        }
                        $subtotal += $lineTotal;

                        $line = new OrderItem;
                        $line->product_id = $product->id;
                        $line->product_variant_id = $variant->id;
                        $line->product_name_snapshot = $product->name;
                        $line->variant_name_snapshot = $variant->name === '__single_price__' ? null : $variant->name;
                        $line->unit_price_centavos = $price;
                        $line->quantity = $item['quantity'];
                        $line->line_total_centavos = $lineTotal;
                        $lines[] = $line;
                    }

                    $order = new Order;
                    $order->order_reference = 'HARU-'.Str::ulid();
                    $order->idempotency_key = $key;
                    $order->request_fingerprint = $fingerprint;
                    $order->status = Order::STATUS_PENDING;
                    $order->currency = Order::CURRENCY;
                    $order->subtotal_centavos = $subtotal;
                    $order->save();
                    $order->items()->saveMany($lines);

                    return $order->load('items');
                }, 3);
            } catch (UniqueConstraintViolationException $exception) {
                // PostgreSQL aborts a transaction after a unique violation. Only
                // read the winning row after the transaction has rolled back.
                if ($existing = $this->existingOrder($key)) {
                    return $this->replay($existing, $fingerprint);
                }
                // A reference collision gets a new reference on the next attempt.
                if ($attempt === 2) {
                    throw $exception;
                }
            }
        }

        throw new HttpException(500);
    }

    private function existingOrder(string $key): ?Order
    {
        return Order::query()->useWritePdo()->where('idempotency_key', $key)->first();
    }

    private function replay(Order $order, string $fingerprint): Order
    {
        if (! hash_equals($order->request_fingerprint, $fingerprint)) {
            throw new HttpException(409);
        }

        return $order->load(['items' => fn ($query) => $query->useWritePdo()]);
    }
}
