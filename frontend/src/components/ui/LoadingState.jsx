const skeletonItems = ['one', 'two', 'three', 'four', 'five', 'six']

function LoadingState() {
  return (
    <section className="menu-state menu-state--loading" aria-live="polite">
      <div className="loading-heading">
        <span className="loading-line loading-line--short" />
        <span className="loading-line loading-line--long" />
      </div>
      <p className="sr-only">Loading the Haru menu.</p>
      <div className="loading-grid" aria-hidden="true">
        {skeletonItems.map((item) => (
          <div className="loading-card" key={item}>
            <div className="loading-card__art" />
            <div className="loading-card__body">
              <span className="loading-line loading-line--name" />
              <span className="loading-line loading-line--description" />
              <span className="loading-line loading-line--price" />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default LoadingState
