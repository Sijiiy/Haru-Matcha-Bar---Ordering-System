import { useEffect, useState } from 'react'
import Modal from '../../components/ui/Modal.jsx'
import { cartSnapshotKey, cartSubtotal, lineSubtotal } from '../cart/cartState.js'
import { formatPeso } from '../../utils/currency.js'
import OrderLines from './OrderLines.jsx'
import OrderConfirmation from './OrderConfirmation.jsx'
import './orders.css'

function OrderReviewModal({ lines, submission, onBackToCart, onClose }) {
  const { state, session, enabled } = submission
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!state.retryAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [state.retryAt])

  const changed = Boolean(state.attempt && cartSnapshotKey(lines) !== state.attempt.cartKey)
  const reviewLines = state.attempt?.lines || lines
  const items = reviewLines.map((line) => ({ ...line, line_total_centavos: lineSubtotal(line) }))
  const waiting = state.phase === 'submitting'
  const seconds = Math.max(0, Math.ceil((state.retryAt - now) / 1000))
  const conflict = state.error?.kind === 'conflict'
  const canUpdateReview = changed && state.phase === 'error' && !state.recoveryIssue && !state.uncertain && !conflict
  const subtotal = state.attempt?.estimatedSubtotal ?? cartSubtotal(lines)
  const successful = state.phase === 'success'

  return (
    <Modal
      titleId={successful ? 'order-confirmation-title' : 'order-review-title'}
      className="cart-modal order-review-modal"
      returnFocusSelector=".order-entry__button"
      onClose={onClose}
    >
      {successful ? (
        <OrderConfirmation
          order={state.result}
          attempt={state.attempt}
          hasEditedCart={lines.length > 0}
          recoveryIssue={state.recoveryIssue}
          onClose={onClose}
          onReturnToMenu={() => { if (session.acknowledgeConfirmation()) onClose() }}
        />
      ) : (
        <>
          <header className="cart-modal__header">
            <div>
              <p className="state-eyebrow">Review your order</p>
              <h2 id="order-review-title">One last look.</h2>
            </div>
            <button className="modal-close" type="button" onClick={onClose} aria-label="Close order review">×</button>
          </header>
          <div className="order-review__body" aria-busy={waiting}>
            <p className="order-review-note">Check your drinks and quantities. Prices here are estimates; Haru will confirm the subtotal when the order is recorded.</p>
            {state.recovered && !state.recoveryIssue ? (
              <div className="order-message order-message--warning" role="alert">
                <p><strong>Earlier submission recovered after refresh.</strong> No order was sent automatically.</p>
                <p>{state.uncertain ? 'It may already have been received. Retry only the saved submission below, or ask a Haru team member if it is not yours.' : 'Review the saved submission below before retrying or changing your selections.'}</p>
                <p>The saved drinks are separate from your current cart. Do not start another order until this submission is resolved.</p>
              </div>
            ) : null}
            {state.recoveryIssue ? <div className="order-message order-message--warning" role="alert"><p>{state.recoveryIssue.message}</p></div> : null}
            {changed ? (
              <div className="order-message order-message--warning" role="alert">
                <p><strong>Your cart has changed.</strong> This list keeps the earlier submission.</p>
                <p>{state.uncertain || waiting
                  ? 'That order may already have been received. Sending another could duplicate drinks.'
                  : 'Review the edited cart before starting a different submission.'}</p>
                {canUpdateReview ? (
                  <button className="review-secondary" type="button" onClick={() => session.reviewUpdatedCart(lines)}>Review edited cart</button>
                ) : <p>Resolve the earlier submission before starting a new one.</p>}
              </div>
            ) : null}
            {state.error ? (
              <div className="order-message order-message--warning" role="alert">
                <p>{state.error.message}</p>
                {state.uncertain ? <p>Clearing the cart does not cancel the earlier submission. Resolve it before starting another order.</p> : null}
                {seconds > 0 ? <p>Retry available in {seconds} {seconds === 1 ? 'second' : 'seconds'}.</p> : null}
              </div>
            ) : null}
            {!enabled ? <div className="order-message"><p>Sending orders is not available on this kiosk yet. You can still review your drinks.</p></div> : null}
            {items.length > 0 ? <OrderLines items={items} /> : !state.recoveryIssue ? <p className="order-review-note">Add a drink from the menu before sending an order.</p> : null}
            {waiting ? <p className="order-progress" role="status">Sending your order… You can return to this review at any time.</p> : null}
          </div>
          <footer className="cart-modal__footer">
            <div className="cart-subtotal" aria-live="polite"><span>Estimated subtotal</span><strong>{formatPeso(subtotal)}</strong></div>
            <p>Sending an order does not verify payment or confirm barista acceptance.</p>
            <div className="review-actions">
              <button className="review-secondary" type="button" onClick={onBackToCart}>Back to cart</button>
              <button
                className="order-button"
                type="button"
                disabled={!enabled || waiting || items.length === 0 || seconds > 0 || conflict || Boolean(state.recoveryIssue)}
                onClick={() => { void session.submit(lines) }}
              >{waiting ? 'Sending…' : state.recoveryIssue ? 'Sending blocked' : state.attempt ? 'Retry same submission' : 'Send order'}</button>
            </div>
          </footer>
        </>
      )}
    </Modal>
  )
}

export default OrderReviewModal
