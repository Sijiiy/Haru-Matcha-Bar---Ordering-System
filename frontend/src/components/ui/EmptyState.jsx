function EmptyState() {
  return (
    <section className="menu-state menu-state--message" aria-live="polite">
      <div className="state-mark" aria-hidden="true">
        <span />
      </div>
      <p className="state-eyebrow">A quiet moment</p>
      <h2>Our menu is resting.</h2>
      <p>
        There are no drinks available to browse right now. Please check again
        shortly.
      </p>
    </section>
  )
}

export default EmptyState
