import { formatPeso } from '../../utils/currency.js'
import { useStaff } from './useStaff.js'
import StaffLogin from './StaffLogin.jsx'
import StaffOrderDetails from './StaffOrderDetails.jsx'
import { staffTime } from './staffTime.js'
import './staff.css'

function StaffPage() {
  const { state, session } = useStaff()
  const page = state.meta?.current_page || 1
  return (
    <div className="staff-shell">
      {state.demo ? <div className="staff-demo" role="status">DEMO · Fixture orders only · No live staff access</div> : null}
      <header className="staff-header">
        <a className="brand-wordmark" href="/" aria-label="Haru kiosk menu">haru.</a>
        <span>Staff workspace</span>
        {state.auth === 'staff' ? <div><span>{state.user.name}</span><button className="staff-button staff-button--secondary" onClick={() => { void session.logout() }}>Sign out</button></div> : null}
      </header>
      <main className="staff-main">
        <div className="staff-intro"><p className="state-eyebrow">Haru Slow Bar</p><h1 tabIndex={-1}>Orders, at a glance.</h1><p>A read-only view of drinks received from the kiosk.</p></div>
        {state.auth === 'checking' ? <div className="staff-state" role="status"><span className="brand-wordmark" aria-hidden="true">haru.</span><h2>{state.signingOut ? 'Signing out…' : 'Opening the staff area…'}</h2></div> : null}
        {state.auth === 'guest' ? <StaffLogin state={state} session={session} /> : null}
        {['forbidden', 'error', 'logout-error'].includes(state.auth) ? (
          <section className="staff-state" role="alert">
            <h2>{state.auth === 'forbidden' ? 'Staff access required.' : state.auth === 'logout-error' ? 'Sign-out could not be confirmed.' : 'Staff area unavailable.'}</h2>
            <p>{state.authError?.message}</p>
            <button className="staff-button" onClick={() => { void (state.auth === 'forbidden' || state.auth === 'logout-error' ? session.logout() : session.start()) }}>{state.auth === 'forbidden' ? 'Sign out of this account' : state.auth === 'logout-error' ? 'Retry sign out' : 'Retry'}</button>
            {state.auth === 'error' ? <p><button className="staff-button staff-button--secondary" onClick={() => { void session.logout() }}>Sign out</button></p> : null}
          </section>
        ) : null}
        {state.auth === 'staff' ? <>
          <div className="staff-toolbar"><div><h2>Pending orders</h2><p>Oldest first · Times shown in Philippine time</p></div><button className="staff-button staff-button--secondary" disabled={state.listStatus === 'loading'} onClick={() => { void session.loadPage(page) }}>Refresh orders</button></div>
          <p className="staff-notice">Payment is not yet verified. Pending means recorded; barista acceptance has not been confirmed.</p>
          {state.listStatus === 'loading' ? <div className="staff-state" role="status"><h3>Loading orders…</h3><p>Checking the latest kiosk orders.</p></div> : null}
          {state.listError ? <div className="staff-state" role="alert"><h3>Could not load orders.</h3><p>{state.listError.message}</p><button className="staff-button" onClick={() => { void session.loadPage(page) }}>Retry orders</button></div> : null}
          {state.listStatus === 'success' && !state.orders.length ? <div className="staff-state"><span className="brand-wordmark" aria-hidden="true">haru.</span><h3>No pending orders here.</h3><p>New kiosk orders will appear when you refresh.</p></div> : null}
          <div className="staff-orders">{state.orders.map(order => (
            <article className="staff-order" key={order.order_reference}>
              <div className="staff-order__top"><span className="staff-status">Pending</span><time dateTime={order.created_at}>{staffTime(order.created_at)}</time></div>
              <h3>{order.order_reference}</h3>
              <ul>{order.items.slice(0, 3).map((item, index) => <li key={index}><strong>{item.quantity} × {item.product_name}</strong>{item.variant_name ? <span>{item.variant_name}</span> : null}</li>)}</ul>
              {order.items.length > 3 ? <p className="staff-small">{order.items.length - 3} more selections in details</p> : null}
              <div className="staff-order__subtotal"><span>Official subtotal</span><strong>{formatPeso(order.subtotal_centavos)}</strong></div>
              <button className="staff-button staff-button--secondary" onClick={() => { void session.openDetail(order.order_reference) }} aria-label={`View order ${order.order_reference}`}>View details</button>
            </article>
          ))}</div>
          {state.listStatus === 'success' && state.meta ? <nav className="staff-pagination" aria-label="Order pages">
            <button className="staff-button staff-button--secondary" disabled={page <= 1} onClick={() => { void session.loadPage(page - 1) }}>Previous</button>
            <p aria-live="polite">Page {page} of {state.meta.last_page} · {state.meta.total} orders</p>
            <button className="staff-button staff-button--secondary" disabled={page >= state.meta.last_page || page >= 10000} onClick={() => { void session.loadPage(page + 1) }}>Next</button>
          </nav> : null}
        </> : null}
      </main>
      <footer className="staff-footer">haru. · Staff viewing only · No payment or order-status controls</footer>
      {state.reference ? <StaffOrderDetails state={state} session={session} /> : null}
    </div>
  )
}
export default StaffPage
