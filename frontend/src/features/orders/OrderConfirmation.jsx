import { useEffect, useRef } from 'react'
import { formatPeso } from '../../utils/currency.js'
import OrderLines from './OrderLines.jsx'

function OrderConfirmation({ order, attempt, hasEditedCart, recoveryIssue, onClose, onReturnToMenu }) {
  const heading = useRef(null)
  useEffect(() => { heading.current?.focus() }, [])

  return (
    <>
      <header className="cart-modal__header">
        <div>
          <p className="state-eyebrow">Order recorded</p>
          <h2 id="order-confirmation-title" ref={heading} tabIndex={-1}>Thank you, see you at the bar.</h2>
        </div>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close order confirmation">×</button>
      </header>
      <div className="order-review__body">
        <p className="order-reference-label">Your order reference</p>
        <p className="order-reference">{order.order_reference}</p>
        <p className="order-status">Status: <strong>{order.status}</strong></p>
        <div className="order-message">
          <p><strong>Payment has not been verified.</strong> Barista acceptance is pending.</p>
          <p>This confirms that your order was recorded. Please keep your reference handy.</p>
        </div>
        {recoveryIssue ? <div className="order-message order-message--warning" role="alert"><p>{recoveryIssue.message}</p></div> : null}
        {hasEditedCart ? (
          <div className="order-message order-message--warning" role="alert">
            <p>Your edited cart has been kept. It may include drinks from this confirmed order.</p>
            <p>Check it carefully before sending another order to avoid duplicates.</p>
          </div>
        ) : null}
        {order.subtotal_centavos !== attempt.estimatedSubtotal ? (
          <p className="order-review-note">The confirmed subtotal differs from the earlier estimate. The confirmed prices are shown below.</p>
        ) : null}
        <OrderLines items={order.items} />
      </div>
      <footer className="cart-modal__footer">
        <div className="cart-subtotal"><span>Confirmed subtotal</span><strong>{formatPeso(order.subtotal_centavos)}</strong></div>
        <p>These items and prices were confirmed by Haru.</p>
        <button className="order-button" type="button" onClick={onReturnToMenu}>
          {hasEditedCart ? 'Reviewed — keep edited cart and return to menu' : 'Return to menu'}
        </button>
      </footer>
    </>
  )
}

export default OrderConfirmation
