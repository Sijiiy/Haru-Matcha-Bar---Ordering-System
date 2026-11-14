import { formatPeso } from '../../utils/currency.js'

function VariantSelector({ variants, selectedId, onChange }) {
  if (variants.length === 1) {
    const variant = variants[0]
    return (
      <p className="single-variant">
        {variant.name ? <span>{variant.name}</span> : null}
        <strong>{formatPeso(variant.price_centavos)}</strong>
      </p>
    )
  }

  return (
    <fieldset className="variant-selector">
      <legend>Choose your option</legend>
      <div className="variant-selector__options">
        {variants.map((variant) => (
          <label className="variant-option" key={variant.id}>
            <input
              type="radio"
              name="product-variant"
              value={variant.id}
              checked={selectedId === variant.id}
              onChange={() => onChange(variant.id)}
            />
            <span>{variant.name}</span>
            <strong>{formatPeso(variant.price_centavos)}</strong>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export default VariantSelector
