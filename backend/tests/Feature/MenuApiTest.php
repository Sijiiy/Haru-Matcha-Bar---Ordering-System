<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Product;
use App\Models\ProductVariant;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Tests\TestCase;

class MenuApiTest extends TestCase
{
    private int $sequence = 0;

    protected function setUp(): void
    {
        parent::setUp();

        if (config('database.default') !== 'sqlite' || config('database.connections.sqlite.database') !== ':memory:') {
            throw new RuntimeException('Menu API tests must use the isolated in-memory SQLite database.');
        }

        $this->createCatalogTables();
    }

    public function test_menu_endpoint_returns_successfully(): void
    {
        $this->getJson('/api/menu')
            ->assertOk()
            ->assertExactJson(['data' => []]);
    }

    public function test_active_catalog_records_are_returned(): void
    {
        [$category, $product, $variant] = $this->createCatalogItem();

        $this->getJson('/api/menu')
            ->assertOk()
            ->assertJsonPath('data.0.id', $category->id)
            ->assertJsonPath('data.0.products.0.id', $product->id)
            ->assertJsonPath('data.0.products.0.variants.0.id', $variant->id)
            ->assertJsonPath('data.0.products.0.variants.0.price_centavos', 15000);
    }

    public function test_inactive_categories_are_excluded(): void
    {
        [$activeCategory] = $this->createCatalogItem();
        $this->createCatalogItem(['is_active' => false]);

        $this->getJson('/api/menu')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $activeCategory->id);
    }

    public function test_inactive_products_are_excluded(): void
    {
        $category = $this->createCategory();
        $activeProduct = $this->createProduct($category);
        $this->createVariant($activeProduct);
        $inactiveProduct = $this->createProduct($category, ['is_active' => false]);
        $this->createVariant($inactiveProduct);

        $this->getJson('/api/menu')
            ->assertOk()
            ->assertJsonCount(1, 'data.0.products')
            ->assertJsonPath('data.0.products.0.id', $activeProduct->id);
    }

    public function test_inactive_variants_are_excluded(): void
    {
        $category = $this->createCategory();
        $product = $this->createProduct($category);
        $activeVariant = $this->createVariant($product);
        $this->createVariant($product, ['is_active' => false]);

        $this->getJson('/api/menu')
            ->assertOk()
            ->assertJsonCount(1, 'data.0.products.0.variants')
            ->assertJsonPath('data.0.products.0.variants.0.id', $activeVariant->id);
    }

    public function test_catalog_records_are_returned_in_sort_order_then_id_order(): void
    {
        $laterCategory = $this->createCategory(['sort_order' => 20]);
        $laterCategoryProduct = $this->createProduct($laterCategory);
        $this->createVariant($laterCategoryProduct);

        $firstCategory = $this->createCategory(['sort_order' => 10]);

        $secondCategory = $this->createCategory(['sort_order' => 10]);
        $secondCategoryProduct = $this->createProduct($secondCategory);
        $this->createVariant($secondCategoryProduct);

        $productLast = $this->createProduct($firstCategory, ['sort_order' => 20]);
        $this->createVariant($productLast);
        $productFirst = $this->createProduct($firstCategory, ['sort_order' => 10]);
        $variantLast = $this->createVariant($productFirst, ['sort_order' => 20]);
        $variantFirst = $this->createVariant($productFirst, ['sort_order' => 10]);
        $variantSecond = $this->createVariant($productFirst, ['sort_order' => 10]);
        $productSecond = $this->createProduct($firstCategory, ['sort_order' => 10]);
        $this->createVariant($productSecond);

        $response = $this->getJson('/api/menu')->assertOk();

        $categories = collect($response->json('data'));
        $this->assertSame(
            [$firstCategory->id, $secondCategory->id, $laterCategory->id],
            $categories->pluck('id')->all(),
        );

        $products = collect($categories->firstWhere('id', $firstCategory->id)['products']);
        $this->assertSame(
            [$productFirst->id, $productSecond->id, $productLast->id],
            $products->pluck('id')->all(),
        );

        $variants = collect($products->firstWhere('id', $productFirst->id)['variants']);
        $this->assertSame(
            [$variantFirst->id, $variantSecond->id, $variantLast->id],
            $variants->pluck('id')->all(),
        );
    }

    public function test_menu_endpoint_is_public(): void
    {
        $this->getJson('/api/menu')
            ->assertOk()
            ->assertHeaderMissing('www-authenticate');
    }

    public function test_response_contains_only_the_intended_public_fields(): void
    {
        [$category, $product, $variant] = $this->createCatalogItem(
            ['name' => 'Matcha', 'slug' => 'matcha', 'description' => 'Stone-ground matcha drinks.'],
            [
                'name' => 'Classic Matcha Latte',
                'slug' => 'classic-matcha-latte',
                'description' => 'Matcha with milk.',
                'image_path' => 'menu/classic-matcha-latte.jpg',
            ],
            ['name' => '12 oz', 'price_centavos' => 15000],
        );

        $this->getJson('/api/menu')
            ->assertOk()
            ->assertExactJson([
                'data' => [
                    [
                        'id' => $category->id,
                        'name' => 'Matcha',
                        'slug' => 'matcha',
                        'description' => 'Stone-ground matcha drinks.',
                        'products' => [
                            [
                                'id' => $product->id,
                                'name' => 'Classic Matcha Latte',
                                'slug' => 'classic-matcha-latte',
                                'description' => 'Matcha with milk.',
                                'image_path' => 'menu/classic-matcha-latte.jpg',
                                'variants' => [
                                    [
                                        'id' => $variant->id,
                                        'name' => '12 oz',
                                        'price_centavos' => 15000,
                                    ],
                                ],
                            ],
                        ],
                    ],
                ],
            ]);
    }

    public function test_categories_and_products_without_active_variants_are_excluded(): void
    {
        [$orderableCategory] = $this->createCatalogItem();
        $emptyCategory = $this->createCategory();
        $productWithoutActiveVariants = $this->createProduct($emptyCategory);
        $this->createVariant($productWithoutActiveVariants, ['is_active' => false]);

        $this->getJson('/api/menu')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $orderableCategory->id);
    }

    /**
     * @param  array<string, mixed>  $categoryAttributes
     * @param  array<string, mixed>  $productAttributes
     * @param  array<string, mixed>  $variantAttributes
     * @return array{Category, Product, ProductVariant}
     */
    private function createCatalogItem(
        array $categoryAttributes = [],
        array $productAttributes = [],
        array $variantAttributes = [],
    ): array {
        $category = $this->createCategory($categoryAttributes);
        $product = $this->createProduct($category, $productAttributes);
        $variant = $this->createVariant($product, $variantAttributes);

        return [$category, $product, $variant];
    }

    /** @param array<string, mixed> $attributes */
    private function createCategory(array $attributes = []): Category
    {
        $sequence = ++$this->sequence;

        return Category::query()->create(array_merge([
            'name' => "Category {$sequence}",
            'slug' => "category-{$sequence}",
            'description' => null,
            'sort_order' => 0,
            'is_active' => true,
        ], $attributes));
    }

    /** @param array<string, mixed> $attributes */
    private function createProduct(Category $category, array $attributes = []): Product
    {
        $sequence = ++$this->sequence;

        return Product::query()->create(array_merge([
            'category_id' => $category->id,
            'name' => "Product {$sequence}",
            'slug' => "product-{$sequence}",
            'description' => null,
            'image_path' => null,
            'sort_order' => 0,
            'is_active' => true,
        ], $attributes));
    }

    /** @param array<string, mixed> $attributes */
    private function createVariant(Product $product, array $attributes = []): ProductVariant
    {
        $sequence = ++$this->sequence;

        return ProductVariant::query()->create(array_merge([
            'product_id' => $product->id,
            'name' => "Variant {$sequence}",
            'price_centavos' => 15000,
            'sort_order' => 0,
            'is_active' => true,
        ], $attributes));
    }

    private function createCatalogTables(): void
    {
        Schema::create('categories', function (Blueprint $table) {
            $table->id();
            $table->string('name', 100);
            $table->string('slug', 100)->unique();
            $table->text('description')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->foreignId('category_id')->constrained()->restrictOnDelete();
            $table->string('name', 100);
            $table->string('slug', 120)->unique();
            $table->text('description')->nullable();
            $table->string('image_path', 500)->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['category_id', 'is_active', 'sort_order']);
        });

        Schema::create('product_variants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->restrictOnDelete();
            $table->string('name', 50);
            $table->unsignedInteger('price_centavos');
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['product_id', 'name']);
            $table->index(['product_id', 'is_active', 'sort_order']);
        });
    }
}
