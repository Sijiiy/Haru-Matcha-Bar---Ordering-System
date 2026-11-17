<?php

namespace App\Providers;

use App\Models\User;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('order-creation', fn (Request $request) => Limit::perMinute(30)
            ->by(hash('sha256', (string) $request->ip())));

        Gate::define('view-staff-orders', fn (User $user) => $user->is_staff === true);

        RateLimiter::for('staff-login', function (Request $request): array {
            $email = $request->input('email');

            return [
                Limit::perMinute(20)->by('staff-ip:'.hash('sha256', (string) $request->ip())),
                Limit::perMinute(5)->by('staff-login:'.hash('sha256', $request->ip().'|'.(is_string($email) ? mb_strtolower($email) : 'invalid-email'))),
            ];
        });
        RateLimiter::for('staff-read', fn (Request $request) => Limit::perMinute(60)
            ->by('staff:'.hash('sha256', $request->ip().'|'.$request->user('web')?->getAuthIdentifier())));
    }
}
