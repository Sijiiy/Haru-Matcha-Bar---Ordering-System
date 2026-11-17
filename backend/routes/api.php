<?php

use App\Http\Controllers\Api\MenuController;
use App\Http\Controllers\Api\StaffOrderController;
use App\Http\Controllers\Api\StaffSessionController;
use App\Http\Controllers\Api\StoreOrderController;
use App\Http\Middleware\EnsureOrderCreationEnabled;
use App\Http\Middleware\EnsureStaffAccessEnabled;
use App\Http\Middleware\NoStoreStaffResponses;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/menu', MenuController::class);

Route::post('/orders', StoreOrderController::class)
    ->middleware([EnsureOrderCreationEnabled::class, 'throttle:order-creation']);

// Scope cookie sessions and CSRF middleware to staff; public kiosk APIs remain
// stateless. Session-only auth intentionally does not accept bearer tokens.
Route::prefix('staff')->middleware([NoStoreStaffResponses::class, 'web'])->group(function () {
    Route::post('/login', [StaffSessionController::class, 'store'])
        ->middleware([EnsureStaffAccessEnabled::class, 'throttle:staff-login']);

    // Revoked/non-staff sessions can always sign out, even after feature shutdown.
    Route::post('/logout', [StaffSessionController::class, 'destroy'])
        ->middleware(['auth:web', 'throttle:staff-read']);

    Route::middleware([EnsureStaffAccessEnabled::class, 'auth:web', 'can:view-staff-orders', 'throttle:staff-read'])
        ->group(function () {
            Route::get('/session', [StaffSessionController::class, 'show']);
            Route::get('/orders', [StaffOrderController::class, 'index']);
            Route::get('/orders/{reference}', [StaffOrderController::class, 'show'])
                ->where('reference', 'HARU-[0-9A-HJKMNP-TV-Z]{26}');
        });
});

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

Route::get('/health', function () {
    return response()->json([
        'status' => 'ok',
        'message' => 'Haru Matcha API is running',
    ]);
});
