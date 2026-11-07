import ProductCard from './ProductCard.jsx'

function ProductGrid({ products, category }) {
  return (
    <div className="product-grid">
      {products.map((product) => (
        <ProductCard product={product} category={category} key={product.id} />
      ))}
    </div>
  )
}

export default ProductGrid
