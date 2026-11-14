import { formatPeso } from '../../utils/currency.js'
import { getProductImage } from './productImages.js'
import ProductImage from './ProductImage.jsx'

function ProductCard({ product, category, onSelect }) {
  const imageSrc = getProductImage(product)
  const hasSingleUnlabelledPrice =
    product.variants.length === 1 && !product.variants[0].name

  return (
    <article className="product-card">
      <div className="product-card__media">
        <ProductImage
          key={imageSrc || 'fallback'}
          src={imageSrc}
          productName={product.name}
          category={category}
        />
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
      <button
        className="product-card__select"
        type="button"
        aria-label={`View ${product.name}`}
        aria-haspopup="dialog"
        onClick={() => onSelect(product, category)}
      />
    </article>
  )
}

export default ProductCard
