<?php

namespace App\Http\Resources;

use App\Models\OrderItem;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class StaffOrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'order_reference' => $this->order_reference,
            'created_at' => $this->created_at->toISOString(),
            'status' => $this->status,
            'currency' => $this->currency,
            'subtotal_centavos' => $this->subtotal_centavos,
            'items' => $this->whenLoaded('items', fn () => $this->items->map(fn (OrderItem $item) => [
                'product_name' => $item->product_name_snapshot,
                'variant_name' => $item->variant_name_snapshot,
                'unit_price_centavos' => $item->unit_price_centavos,
                'quantity' => $item->quantity,
                'line_total_centavos' => $item->line_total_centavos,
            ])),
        ];
    }
}
