import ProductCard from './ProductCard.jsx'

function ProductGrid({ products, category, onSelect }) {
  return (
    <div className="product-grid">
      {products.map((product) => (
        <ProductCard product={product} category={category} onSelect={onSelect} key={product.id} />
      ))}
    </div>
  )
}

export default ProductGrid
