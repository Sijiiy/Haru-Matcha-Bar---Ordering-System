import { useState } from 'react'
import Modal from '../../components/ui/Modal.jsx'
import QuantitySelector from '../../components/ui/QuantitySelector.jsx'
import { cartLineKey, MAX_QUANTITY } from '../cart/cartState.js'
import { formatPeso } from '../../utils/currency.js'
import ProductImage from './ProductImage.jsx'
import VariantSelector from './VariantSelector.jsx'
import { getProductImage } from './productImages.js'

function ProductDetailsModal({ product, category, lines, onAdd, onClose }) {
  const defaultVariant =
    (category === 'coffee' && product.variants.find((v) => v.name === 'Iced')) ||
    product.variants[0]
  const [selectedId, setSelectedId] = useState(defaultVariant.id)
  const [quantity, setQuantity] = useState(1)
  const variant = product.variants.find((option) => option.id === selectedId)
  const existingQuantity = lines.find(
    (line) => line.key === cartLineKey(product.slug, variant.id),
  )?.quantity || 0
  const remaining = MAX_QUANTITY - existingQuantity

  const handleVariantChange = (id) => {
    setSelectedId(id)
    setQuantity(1)
  }

  return (
    <Modal titleId="product-title" onClose={onClose} className="product-modal">
      <button className="modal-close" type="button" onClick={onClose} aria-label="Close product details">
        <span aria-hidden="true">×</span>
      </button>
      <div className="product-modal__layout">
        <div className="product-modal__image">
          <ProductImage
            src={getProductImage(product, variant.name)}
            productName={product.name}
            category={category}
            loading="eager"
          />
        </div>
        <div className="product-modal__details">
          <p className="state-eyebrow">{category}</p>
          <h2 id="product-title">{product.name}</h2>
          {product.description ? <p className="product-modal__description">{product.description}</p> : null}
          <VariantSelector variants={product.variants} selectedId={selectedId} onChange={handleVariantChange} />
          <div className="product-modal__quantity">
            <span>Quantity</span>
            <QuantitySelector quantity={quantity} onChange={setQuantity} max={Math.max(1, remaining)} />
          </div>
          <p className="quantity-note" role="status">
            {remaining === 0
              ? `You already have ${MAX_QUANTITY} of this option in your order.`
              : `Up to ${MAX_QUANTITY} per option${existingQuantity ? ` · ${existingQuantity} already in your order` : ''}.`}
          </p>
          <div className="product-modal__total" aria-live="polite">
            <div><span>Line total</span><small>{formatPeso(variant.price_centavos)} × {quantity}</small></div>
            <strong>{formatPeso(variant.price_centavos * quantity)}</strong>
          </div>
          <button
            className="order-button"
            type="button"
            disabled={remaining === 0 || quantity > remaining}
            onClick={() => onAdd(product, variant, quantity)}
          >
            Add to Order <span aria-hidden="true">↗</span>
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default ProductDetailsModal
