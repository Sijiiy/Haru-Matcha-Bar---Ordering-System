<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class MenuProductVariantResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            // Internal identifier for a single-price item, never a size label.
            'name' => $this->name === '__single_price__' ? null : $this->name,
            'price_centavos' => $this->price_centavos,
        ];
    }
}
