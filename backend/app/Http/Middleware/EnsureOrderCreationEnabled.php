<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureOrderCreationEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        if (config('orders.creation_enabled') !== true) {
            return response()->json(['message' => 'Order creation is not available.'], 503);
        }

        return $next($request);
    }
}
