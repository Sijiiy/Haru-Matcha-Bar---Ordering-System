import { useState } from 'react'
import Modal from '../../components/ui/Modal.jsx'
import QuantitySelector from '../../components/ui/QuantitySelector.jsx'
import { formatPeso } from '../../utils/currency.js'
import { lineSubtotal, MAX_QUANTITY } from './cartState.js'
import ProductImage from '../menu/ProductImage.jsx'
import { getProductImage } from '../menu/productImages.js'
import ClearOrderDialog from './ClearOrderDialog.jsx'

function CartModal({ lines, itemCount, subtotal, dispatch, onClose }) {
  const [confirmClear, setConfirmClear] = useState(false)

  return (
    <Modal titleId="cart-title" onClose={onClose} className="cart-modal">
      <header className="cart-modal__header">
        <div>
          <p className="state-eyebrow">A cup, or a few</p>
          <h2 id="cart-title">Your order <span>({itemCount})</span></h2>
        </div>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close order review">
          <span aria-hidden="true">×</span>
        </button>
      </header>
      {lines.length === 0 ? (
        <div className="cart-empty" role="status">
          <p className="brand-wordmark" aria-hidden="true">haru.</p>
          <h3>Your order starts with a cup.</h3>
          <p>Browse the menu and add something you love.</p>
          <button className="order-button" type="button" onClick={onClose}>Browse menu</button>
        </div>
      ) : (
        <>
          <ul className="cart-lines">
            {lines.map((line) => (
              <li className="cart-line" key={line.key}>
                <div className="cart-line__summary">
                  <div className="cart-line__thumbnail">
                    <ProductImage
                      src={getProductImage({
                        slug: line.product_slug,
                        image_path: line.product_image_path,
                      }, line.variant_name)}
                      productName={line.product_name}
                    />
                  </div>
                  <div className="cart-line__description">
                    <h3>{line.product_name}</h3>
                    {line.variant_name ? <p>{line.variant_name}</p> : null}
                    <p>{formatPeso(line.unit_price_centavos)} each</p>
                  </div>
                </div>
                <div className="cart-line__controls">
                  <QuantitySelector
                    label={`Quantity for ${line.product_name}${line.variant_name ? ` ${line.variant_name}` : ''}`}
                    quantity={line.quantity}
                    max={MAX_QUANTITY}
                    onChange={(quantity) => dispatch({ type: 'quantity', key: line.key, quantity })}
                  />
                  <strong>{formatPeso(lineSubtotal(line))}</strong>
                  <button
                    className="remove-line"
                    type="button"
                    aria-label={`Remove ${line.product_name}${line.variant_name ? ` ${line.variant_name}` : ''}`}
                    onClick={(event) => {
                      // The focused remove button is about to leave the DOM.
                      event.currentTarget.closest('dialog').querySelector('.modal-close').focus()
                      dispatch({ type: 'remove', key: line.key })
                    }}
                  >Remove</button>
                </div>
              </li>
            ))}
          </ul>
          <footer className="cart-modal__footer">
            <div className="cart-subtotal" aria-live="polite"><span>Subtotal</span><strong>{formatPeso(subtotal)}</strong></div>
            <p className="cart-footer-note">
              <span>Your items are saved here while you browse.</span>
              <button className="clear-order-action" type="button" onClick={() => setConfirmClear(true)}>
                Clear order
              </button>
            </p>
            <button className="order-button" type="button" onClick={onClose}>Continue browsing <span aria-hidden="true">↗</span></button>
          </footer>
        </>
      )}
      {confirmClear ? (
        <ClearOrderDialog
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            dispatch({ type: 'clear', confirmed: true })
            setConfirmClear(false)
          }}
        />
      ) : null}
    </Modal>
  )
}

export default CartModal
