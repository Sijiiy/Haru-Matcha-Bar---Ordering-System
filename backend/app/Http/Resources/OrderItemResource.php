<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class OrderItemResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'product_id' => $this->product_id,
            'variant_id' => $this->product_variant_id,
            'product_name' => $this->product_name_snapshot,
            'variant_name' => $this->variant_name_snapshot,
            'unit_price_centavos' => $this->unit_price_centavos,
            'quantity' => $this->quantity,
            'line_total_centavos' => $this->line_total_centavos,
        ];
    }
}
