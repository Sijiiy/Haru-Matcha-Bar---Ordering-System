<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\Product;
use App\Models\ProductVariant;
use Database\Seeders\HaruCatalogSeeder;
use RuntimeException;
use Tests\CatalogTestCase;

class HaruCatalogSeederTest extends CatalogTestCase
{
    public function test_read_only_preview_does_not_create_records(): void
    {
        $plan = (new HaruCatalogSeeder)->preview();
        $this->assertSame(['categories' => 3, 'products' => 18, 'variants' => 31], $plan['insert_counts']);
        $this->assertSame([], $plan['conflicts']);
        $this->assertSame([], $plan['updates']);
        $this->assertSame(0, Category::count());
        $this->assertSame(0, Product::count());
        $this->assertSame(0, ProductVariant::count());
    }

    public function test_catalog_can_be_seeded_twice_without_duplicates_or_changes(): void
    {
        $seeder = new HaruCatalogSeeder;
        $seeder->run();
        $before = [Category::all()->toArray(), Product::all()->toArray(), ProductVariant::all()->toArray()];
        $seeder->run();

        $this->assertSame(3, Category::count());
        $this->assertSame(18, Product::count());
        $this->assertSame(31, ProductVariant::count());
        $this->assertSame($before, [Category::all()->toArray(), Product::all()->toArray(), ProductVariant::all()->toArray()]);
        $this->assertSame(['categories' => 0, 'products' => 0, 'variants' => 0], $seeder->preview()['insert_counts']);
    }

    public function test_seeded_public_menu_preserves_the_complete_confirmed_catalog(): void
    {
        (new HaruCatalogSeeder)->run();
        $response = $this->getJson('/api/menu')->assertOk()->assertJsonCount(3, 'data');

        foreach (HaruCatalogSeeder::catalog() as $categoryOrder => $expectedCategory) {
            $category = $response->json("data.{$categoryOrder}");
            $this->assertSame($expectedCategory['name'], $category['name']);
            $this->assertSame($expectedCategory['slug'], $category['slug']);
            $this->assertCount(count($expectedCategory['products']), $category['products']);

            foreach ($expectedCategory['products'] as $productOrder => $expectedProduct) {
                $product = $category['products'][$productOrder];
                $this->assertSame($expectedProduct['name'], $product['name']);
                $this->assertSame($expectedProduct['slug'], $product['slug']);
                $this->assertSame($expectedProduct['description'], $product['description']);
                $this->assertNull($product['image_path']);
                $this->assertCount(count($expectedProduct['variants']), $product['variants']);

                foreach ($expectedProduct['variants'] as $variantOrder => $expectedVariant) {
                    $variant = $product['variants'][$variantOrder];
                    $this->assertSame($expectedVariant['name'], $variant['name']);
                    $this->assertSame($expectedVariant['price_centavos'], $variant['price_centavos']);
                    $this->assertIsInt($variant['price_centavos']);
                    $this->assertIsInt($variant['id']);
                }
            }
        }

        foreach (['hojicha', 'sea-salt-cream-hojicha', 'cereal-crunch-hojicha'] as $slug) {
            $product = Product::where('slug', $slug)->firstOrFail();
            $this->assertSame(HaruCatalogSeeder::SINGLE_PRICE_NAME, $product->variants->sole()->name);
        }
    }

    public function test_a_price_conflict_aborts_before_inserting_missing_records(): void
    {
        $seeder = new HaruCatalogSeeder;
        $seeder->run();
        $variant = Product::where('slug', 'volume-i')->firstOrFail()->variants()->where('name', '12 oz')->firstOrFail();
        $variant->update(['price_centavos' => 1]);
        Product::where('slug', 'espresso')->firstOrFail()->variants()->delete();
        Product::where('slug', 'espresso')->delete();

        $this->assertNotEmpty($seeder->preview()['conflicts']);
        try {
            $seeder->run();
            $this->fail('Expected the conflicting catalog to be rejected.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('price_centavos differs', $error->getMessage());
        }
        $this->assertSame(17, Product::count());
        $this->assertSame(1, $variant->fresh()->price_centavos);
    }

    public function test_unrelated_records_and_existing_image_metadata_are_preserved(): void
    {
        $unrelated = Category::create(['name' => 'Archived menu', 'slug' => 'archived-menu', 'is_active' => false]);
        $seeder = new HaruCatalogSeeder;
        $seeder->run();
        $product = Product::where('slug', 'volume-i')->firstOrFail();
        $product->update(['image_path' => '/approved/volume-i.png']);
        $seeder->run();
        $this->assertFalse($unrelated->fresh()->is_active);
        $this->assertSame(4, Category::count());
        $this->assertSame('/approved/volume-i.png', $product->fresh()->image_path);
    }

    public function test_same_name_under_a_different_slug_requires_review(): void
    {
        Category::create(['name' => 'Matcha', 'slug' => 'old-matcha']);
        $seeder = new HaruCatalogSeeder;
        $this->assertStringContainsString('old-matcha', implode('\n', $seeder->preview()['conflicts']));
        $this->expectException(RuntimeException::class);
        $seeder->run();
    }

    public function test_inactive_records_and_unexpected_variants_are_not_silently_changed(): void
    {
        $seeder = new HaruCatalogSeeder;
        $seeder->run();
        $product = Product::where('slug', 'hojicha')->firstOrFail();
        $product->update(['is_active' => false]);
        $product->variants()->create(['name' => 'Unconfirmed', 'price_centavos' => 1]);
        $conflicts = implode('\n', $seeder->preview()['conflicts']);
        $this->assertStringContainsString('is_active differs', $conflicts);
        $this->assertStringContainsString('Unconfirmed', $conflicts);
        $this->expectException(RuntimeException::class);
        $seeder->run();
    }
}
