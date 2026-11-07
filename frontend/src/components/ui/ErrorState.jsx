function ErrorState({ onRetry }) {
  return (
    <section className="menu-state menu-state--message" role="alert">
      <div className="state-mark state-mark--error" aria-hidden="true">
        <span />
      </div>
      <p className="state-eyebrow">Something went wrong</p>
      <h2>We couldn&apos;t bring up the menu.</h2>
      <p>Please check the connection and try once more.</p>
      <button className="retry-button" type="button" onClick={onRetry}>
        Try again
        <span aria-hidden="true">↗</span>
      </button>
    </section>
  )
}

export default ErrorState
