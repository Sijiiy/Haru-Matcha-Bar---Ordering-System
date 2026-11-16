<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;
use JsonException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class StoreOrderRequest extends FormRequest
{
    public const MAX_LINES = 50;

    public const MAX_QUANTITY = 20;

    public const MAX_ITEMS = 100;

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        if (! $this->isJson()) {
            throw new HttpException(415);
        }

        if (strlen($this->getContent()) > 16384) {
            throw new HttpException(413);
        }

        try {
            $body = json_decode($this->getContent(), flags: JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new HttpException(400);
        }

        if (! is_object($body)) {
            throw new HttpException(400);
        }
    }

    public function rules(): array
    {
        return [
            'idempotency_key' => ['required', 'string', 'uuid', 'size:36'],
            'items' => ['required', 'array', 'list', 'min:1', 'max:'.self::MAX_LINES],
            'items.*' => ['required', 'array:variant_id,quantity'],
            'items.*.variant_id' => ['required', 'integer:strict', 'min:1', 'max:'.PHP_INT_MAX],
            'items.*.quantity' => ['required', 'integer:strict', 'min:1', 'max:'.self::MAX_QUANTITY],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if (array_diff(array_keys($this->json()->all()), ['idempotency_key', 'items']) || $this->query->count() > 0) {
                $validator->errors()->add('request', 'Only idempotency_key and items may be supplied in the JSON body.');
            }

            // JSON objects with numeric keys must not masquerade as an item list.
            $body = json_decode($this->getContent());
            if (isset($body->items) && ! is_array($body->items)) {
                $validator->errors()->add('items', 'Items must be a JSON array.');
            }

            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            $items = $this->normalizeItems($this->input('items'));
            if (max(array_column($items, 'quantity')) > self::MAX_QUANTITY) {
                $validator->errors()->add('items', 'The combined quantity for each variant must not exceed 20.');
            }
            if (array_sum(array_column($items, 'quantity')) > self::MAX_ITEMS) {
                $validator->errors()->add('items', 'An order must not contain more than 100 drinks.');
            }
        });
    }

    public function normalizedItems(): array
    {
        return $this->normalizeItems($this->validated('items'));
    }

    public function idempotencyKey(): string
    {
        return strtolower($this->validated('idempotency_key'));
    }

    private function normalizeItems(array $items): array
    {
        $quantities = [];
        foreach ($items as $item) {
            $id = $item['variant_id'];
            $quantities[$id] = ($quantities[$id] ?? 0) + $item['quantity'];
        }
        ksort($quantities, SORT_NUMERIC);

        $normalized = [];
        foreach ($quantities as $id => $quantity) {
            $normalized[] = ['variant_id' => $id, 'quantity' => $quantity];
        }

        return $normalized;
    }
}
