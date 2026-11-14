function QuantitySelector({ quantity, onChange, max, label = 'Quantity' }) {
  return (
    <div className="quantity-selector" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`Decrease ${label.toLowerCase()}`}
        disabled={quantity <= 1}
        onClick={() => onChange(Math.max(1, quantity - 1))}
      >
        <span aria-hidden="true">−</span>
      </button>
      <output aria-label={label} aria-live="polite">{quantity}</output>
      <button
        type="button"
        aria-label={`Increase ${label.toLowerCase()}`}
        disabled={quantity >= max}
        onClick={() => onChange(Math.min(max, quantity + 1))}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  )
}

export default QuantitySelector
