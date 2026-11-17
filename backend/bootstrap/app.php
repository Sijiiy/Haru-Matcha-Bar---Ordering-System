<?php

use App\Http\Middleware\EnsureOrderCreationEnabled;
use App\Http\Middleware\EnsureStaffAccessEnabled;
use App\Http\Middleware\NoStoreStaffResponses;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Session\TokenMismatchException;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Disabled requests must stop before the limiter can touch its cache.
        $middleware->prependToPriorityList(ThrottleRequests::class, EnsureOrderCreationEnabled::class);
        $middleware->prependToPriorityList(StartSession::class, EnsureStaffAccessEnabled::class);
        $middleware->prependToPriorityList(EnsureStaffAccessEnabled::class, NoStoreStaffResponses::class);
        $middleware->redirectGuestsTo('/staff');
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        // Order failures must never reveal SQL, connection details or traces,
        // including during local development with debug enabled.
        $exceptions->render(function (Throwable $exception, Request $request) {
            if ($request->is('api/staff', 'api/staff/*')) {
                $status = match (true) {
                    $exception instanceof AuthenticationException => 401,
                    $exception instanceof AuthorizationException => 403,
                    $exception instanceof ModelNotFoundException => 404,
                    $exception instanceof TokenMismatchException => 419,
                    $exception instanceof ValidationException => 422,
                    $exception instanceof HttpExceptionInterface => $exception->getStatusCode(),
                    default => 500,
                };
                $message = match ($status) {
                    401 => 'Please sign in to the staff area.',
                    403 => 'Staff access is required.',
                    404 => 'The order was not found.',
                    419 => 'Your session security token expired. Please try signing in again.',
                    422 => 'Please check your credentials or request.',
                    429 => 'Too many requests. Please wait before retrying.',
                    503 => 'Staff access is not available.',
                    default => 'The staff request could not be completed.',
                };
                $headers = ['Cache-Control' => 'no-store, private', 'Pragma' => 'no-cache'];
                if ($exception instanceof HttpExceptionInterface) {
                    $headers += array_intersect_key($exception->getHeaders(), array_flip(['Retry-After']));
                }

                return response()->json(['message' => $message], $status, $headers);
            }

            if (! $request->is('api/orders')) {
                return null;
            }

            if ($exception instanceof ValidationException) {
                return response()->json([
                    'message' => 'Please review the selected drinks and quantities.',
                    'errors' => $exception->errors(),
                ], 422);
            }

            $status = $exception instanceof HttpExceptionInterface ? $exception->getStatusCode() : 500;
            $message = match ($status) {
                400 => 'Send a valid JSON object.',
                409 => 'This idempotency key was already used for a different order. Use a new key for a new order.',
                413 => 'The order request is too large.',
                415 => 'Send the order as application/json.',
                429 => 'Too many order attempts. Please wait before retrying.',
                503 => 'Order creation is not available.',
                default => 'We could not create your order. Please retry using the same idempotency key.',
            };
            $headers = $exception instanceof HttpExceptionInterface
                ? array_intersect_key($exception->getHeaders(), array_flip(['Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Allow']))
                : [];

            return response()->json(['message' => $message], $status, $headers);
        });
    })->create();
