<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\MenuCategoryResource;
use App\Models\Category;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class MenuController extends Controller
{
    public function __invoke(): AnonymousResourceCollection
    {
        $categories = Category::query()
            ->where('is_active', true)
            ->whereHas('products', function (Builder $productQuery) {
                $productQuery
                    ->where('is_active', true)
                    ->whereHas('variants', function (Builder $variantQuery) {
                        $variantQuery->where('is_active', true);
                    });
            })
            ->with([
                'products' => function (HasMany $productQuery) {
                    $productQuery
                        ->where('is_active', true)
                        ->whereHas('variants', function (Builder $variantQuery) {
                            $variantQuery->where('is_active', true);
                        })
                        ->orderBy('sort_order')
                        ->orderBy('id')
                        ->with([
                            'variants' => function (HasMany $variantQuery) {
                                $variantQuery
                                    ->where('is_active', true)
                                    ->orderBy('sort_order')
                                    ->orderBy('id');
                            },
                        ]);
                },
            ])
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        return MenuCategoryResource::collection($categories);
    }
}
