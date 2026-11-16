<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class OrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'order_reference' => $this->order_reference,
            'status' => $this->status,
            'currency' => $this->currency,
            'subtotal_centavos' => $this->subtotal_centavos,
            'items' => OrderItemResource::collection($this->whenLoaded('items')),
        ];
    }
}
