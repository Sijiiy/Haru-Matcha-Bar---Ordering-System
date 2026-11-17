<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureStaffAccessEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        if (config('staff.access_enabled') !== true) {
            return response()->json(['message' => 'Staff access is not available.'], 503);
        }

        return $next($request);
    }
}
