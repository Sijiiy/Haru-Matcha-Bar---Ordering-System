import Modal from '../../components/ui/Modal.jsx'
import { formatPeso } from '../../utils/currency.js'
import { staffTime } from './staffTime.js'

function StaffOrderDetails({ state, session }) {
  const order = state.detail
  return (
    <Modal titleId="staff-detail-title" className="staff-detail" returnFocusSelector=".staff-shell h1" onClose={() => session.closeDetail()}>
      <header className="staff-detail__header">
        <div><p className="state-eyebrow">Order details</p><h2 id="staff-detail-title">{state.reference}</h2></div>
        <button type="button" className="staff-close" onClick={() => session.closeDetail()} aria-label="Close order details">×</button>
      </header>
      <div className="staff-detail__body">
        {state.detailStatus === 'loading' ? <p role="status">Loading the order…</p> : null}
        {state.detailError ? <div className="staff-message" role="alert"><p>{state.detailError.message}</p><button className="staff-button staff-button--secondary" onClick={() => { void session.openDetail(state.reference) }}>Retry details</button></div> : null}
        {order ? <>
          <p className="staff-order-time"><time dateTime={order.created_at}>{staffTime(order.created_at)}</time> · Philippine time</p>
          <span className="staff-status">Pending</span>
          <p className="staff-message">Payment has not been verified. Barista acceptance is pending.</p>
          <ul className="staff-detail__items">{order.items.map((item, index) => (
            <li key={index}>
              <div><h3>{item.product_name}</h3>{item.variant_name ? <p>{item.variant_name}</p> : null}<p>{formatPeso(item.unit_price_centavos)} each · Quantity {item.quantity}</p></div>
              <strong>{formatPeso(item.line_total_centavos)}</strong>
            </li>
          ))}</ul>
        </> : null}
      </div>
      <footer className="staff-detail__footer">{order ? <div><span>Official subtotal</span><strong>{formatPeso(order.subtotal_centavos)}</strong></div> : null}<button className="staff-button" onClick={() => session.closeDetail()}>Close details</button></footer>
    </Modal>
  )
}
export default StaffOrderDetails
