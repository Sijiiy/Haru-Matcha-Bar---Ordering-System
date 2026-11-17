import { formatPeso } from '../../utils/currency.js'

function OrderLines({ items }) {
  return (
    <ul className="review-lines">
      {items.map((item) => (
        <li className="review-line" key={item.variant_id}>
          <div>
            <h3>{item.product_name}</h3>
            {item.variant_name ? <p>{item.variant_name}</p> : null}
            <p>{formatPeso(item.unit_price_centavos)} each <span aria-hidden="true">·</span> Quantity {item.quantity}</p>
          </div>
          <strong>{formatPeso(item.line_total_centavos)}</strong>
        </li>
      ))}
    </ul>
  )
}

export default OrderLines
