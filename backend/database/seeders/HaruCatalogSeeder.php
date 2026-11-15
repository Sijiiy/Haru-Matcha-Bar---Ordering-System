<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\Product;
use App\Models\ProductVariant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Seeder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class HaruCatalogSeeder extends Seeder
{
    // Storage identifier only: the menu resource renders this name as null.
    public const SINGLE_PRICE_NAME = '__single_price__';

    public static function catalog(): array
    {
        return json_decode(
            file_get_contents(__DIR__.'/../data/haru-catalog.json'),
            true,
            512,
            JSON_THROW_ON_ERROR,
        )['data'];
    }

    /** Read-only plan. No models are saved or updated here. */
    public function preview(): array
    {
        $categories = Category::all();
        $products = Product::with(['category', 'variants'])->get();
        $conflicts = [];
        $inserts = ['categories' => [], 'products' => [], 'variants' => []];

        foreach (self::catalog() as $categoryOrder => $categoryData) {
            $category = $this->matchRecord($categories, $categoryData, 'Category', $conflicts);
            $categoryFields = $this->categoryFields($categoryData, $categoryOrder);
            if ($category) {
                $this->compare($category, $categoryFields, "Category {$categoryData['slug']}", $conflicts);
            } else {
                $inserts['categories'][] = $categoryFields;
            }

            foreach ($categoryData['products'] as $productOrder => $productData) {
                $product = $this->matchRecord($products, $productData, 'Product', $conflicts);
                $productFields = $this->productFields($productData, $productOrder);
                if ($product) {
                    $this->compare($product, $productFields, "Product {$productData['slug']}", $conflicts);
                    if ($product->category?->slug !== $categoryData['slug']) {
                        $conflicts[] = "Product {$productData['slug']}: category differs from {$categoryData['slug']}";
                    }
                } else {
                    $inserts['products'][] = ['category_slug' => $categoryData['slug']] + $productFields;
                }

                $expectedNames = [];
                foreach ($productData['variants'] as $variantOrder => $variantData) {
                    $fields = $this->variantFields($variantData, $variantOrder);
                    $expectedNames[] = $fields['name'];
                    $variant = $product?->variants->firstWhere('name', $fields['name']);
                    if ($variant) {
                        $this->compare($variant, $fields, "Variant {$productData['slug']}/{$fields['name']}", $conflicts);
                    } else {
                        $inserts['variants'][] = ['product_slug' => $productData['slug']] + $fields;
                    }
                }

                foreach ($product?->variants ?? [] as $variant) {
                    if (! in_array($variant->name, $expectedNames, true)) {
                        $conflicts[] = "Product {$productData['slug']}: existing variant {$variant->name} is not in the confirmed catalog";
                    }
                }
            }
        }

        return [
            'existing_counts' => [
                'categories' => $categories->count(),
                'products' => $products->count(),
                'variants' => ProductVariant::count(),
            ],
            'insert_counts' => array_map(count(...), $inserts),
            'inserts' => $inserts,
            'updates' => [],
            'conflicts' => $conflicts,
        ];
    }

    public function run(): void
    {
        DB::transaction(function () {
            // On PostgreSQL, serialize cooperating catalog seed runs and ensure
            // ordinary catalog edits cannot race the conflict check and inserts.
            if (DB::connection()->getDriverName() === 'pgsql') {
                DB::statement('LOCK TABLE categories, products, product_variants IN SHARE ROW EXCLUSIVE MODE');
            }

            $plan = $this->preview();
            if ($plan['conflicts'] !== []) {
                throw new RuntimeException("Catalog conflicts; nothing was changed:\n".implode("\n", $plan['conflicts']));
            }

            foreach (self::catalog() as $categoryOrder => $categoryData) {
                $category = Category::firstOrCreate(
                    ['slug' => $categoryData['slug']],
                    $this->categoryFields($categoryData, $categoryOrder),
                );
                foreach ($categoryData['products'] as $productOrder => $productData) {
                    $product = Product::firstOrCreate(
                        ['slug' => $productData['slug']],
                        ['category_id' => $category->id, 'image_path' => null] + $this->productFields($productData, $productOrder),
                    );
                    foreach ($productData['variants'] as $variantOrder => $variantData) {
                        $fields = $this->variantFields($variantData, $variantOrder);
                        ProductVariant::firstOrCreate(
                            ['product_id' => $product->id, 'name' => $fields['name']],
                            $fields,
                        );
                    }
                }
            }
        });
    }

    private function categoryFields(array $data, int $order): array
    {
        return [
            'name' => $data['name'], 'slug' => $data['slug'],
            'description' => $data['description'], 'sort_order' => $order, 'is_active' => true,
        ];
    }

    private function productFields(array $data, int $order): array
    {
        return $this->categoryFields($data, $order);
    }

    private function variantFields(array $data, int $order): array
    {
        return [
            'name' => $data['name'] ?? self::SINGLE_PRICE_NAME,
            'price_centavos' => $data['price_centavos'],
            'sort_order' => $order, 'is_active' => true,
        ];
    }

    private function matchRecord(Collection $records, array $data, string $type, array &$conflicts): ?Model
    {
        $match = $records->firstWhere('slug', $data['slug']);
        $lookalike = $records->first(fn ($record) => $record->slug !== $data['slug'] && (
            mb_strtolower($record->slug) === mb_strtolower($data['slug']) ||
            mb_strtolower($record->name) === mb_strtolower($data['name'])
        ));
        if ($lookalike) {
            $conflicts[] = "{$type} {$data['slug']}: same name or case-insensitive slug exists as {$lookalike->slug}";
        }

        return $match;
    }

    private function compare(Model $model, array $expected, string $label, array &$conflicts): void
    {
        foreach ($expected as $field => $value) {
            if ($model->getAttribute($field) !== $value) {
                $conflicts[] = "{$label}: {$field} differs (existing ".json_encode($model->getAttribute($field)).', expected '.json_encode($value).')';
            }
        }
    }
}
