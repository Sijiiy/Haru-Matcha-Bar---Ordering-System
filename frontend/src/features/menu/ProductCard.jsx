import { formatPeso } from '../../utils/currency.js'

function ProductArtwork({ category, productName }) {
  return (
    <div className="product-art" data-category={category} aria-hidden="true">
      <span className="product-art__wordmark">haru.</span>
      <span className="product-art__orb product-art__orb--large" />
      <span className="product-art__orb product-art__orb--small" />
      <span className="product-art__line" />
      <p>{productName}</p>
    </div>
  )
}

function ProductCard({ product, category }) {
  const hasSingleUnlabelledPrice =
    product.variants.length === 1 && !product.variants[0].name

  return (
    <article className="product-card">
      <div className="product-card__media">
        {product.image_path ? (
          <img src={product.image_path} alt={product.name} />
        ) : (
          <ProductArtwork category={category} productName={product.name} />
        )}
      </div>

      <div className="product-card__body">
        <div className="product-card__heading">
          <p className="product-card__category">{category}</p>
          <h3>{product.name}</h3>
          {product.description ? <p>{product.description}</p> : null}
        </div>

        <ul
          className="variant-list"
          data-single-price={hasSingleUnlabelledPrice}
          aria-label={`${product.name} prices`}
        >
          {product.variants.map((variant) => (
            <li key={variant.id}>
              {variant.name ? (
                <span className="variant-list__name">{variant.name}</span>
              ) : null}
              <span className="variant-list__price">
                {formatPeso(variant.price_centavos)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}

export default ProductCard
