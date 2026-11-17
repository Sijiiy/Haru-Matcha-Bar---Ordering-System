<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\StaffOrderResource;
use App\Models\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class StaffOrderController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = $request->validate([
            'page' => ['sometimes', 'integer', 'min:1', 'max:10000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:25'],
        ]);
        $orders = Order::query()->where('status', Order::STATUS_PENDING)
            ->with('items')->orderBy('created_at')->orderBy('id')
            ->paginate((int) ($query['per_page'] ?? 12));

        return StaffOrderResource::collection($orders->getCollection())->additional(['meta' => [
            'current_page' => $orders->currentPage(),
            'last_page' => $orders->lastPage(),
            'per_page' => $orders->perPage(),
            'total' => $orders->total(),
        ]])->response();
    }

    public function show(string $reference): StaffOrderResource
    {
        // Resolve references only inside this authorized controller, never by
        // implicit route binding before the staff Gate can reject a request.
        return new StaffOrderResource(Order::query()->where('status', Order::STATUS_PENDING)
            ->where('order_reference', $reference)->with('items')->firstOrFail());
    }
}
