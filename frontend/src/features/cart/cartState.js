export const MAX_QUANTITY = 20

export function cartLineKey(productSlug, variantId) {
  return `${productSlug}:${variantId}`
}

export function lineSubtotal(line) {
  return line.unit_price_centavos * line.quantity
}

export function cartSubtotal(lines) {
  return lines.reduce((sum, line) => sum + lineSubtotal(line), 0)
}

export function cartItemCount(lines) {
  return lines.reduce((sum, line) => sum + line.quantity, 0)
}

// A display snapshot is used only to protect edits during a pending request.
// It is never sent to Laravel or used for authoritative pricing.
export function cartSnapshotKey(lines) {
  return JSON.stringify(lines.map((line) => [
    line.key, line.product_id, line.product_slug, line.product_name,
    line.product_image_path ?? null, line.variant_id, line.variant_name,
    line.unit_price_centavos, line.quantity,
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}

function validQuantity(quantity) {
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY
}

export function cartReducer(lines, action) {
  switch (action.type) {
    case 'add': {
      const { product, variant, quantity } = action
      if (
        !validQuantity(quantity) ||
        !product.variants.some((option) => option.id === variant.id) ||
        !Number.isInteger(variant.price_centavos) ||
        variant.price_centavos < 0
      ) {
        return lines
      }

      const key = cartLineKey(product.slug, variant.id)
      const existing = lines.find((line) => line.key === key)
      if ((existing?.quantity || 0) + quantity > MAX_QUANTITY) return lines

      if (existing) {
        return lines.map((line) =>
          line.key === key ? { ...line, quantity: line.quantity + quantity } : line,
        )
      }

      return [
        ...lines,
        {
          key,
          product_id: product.id,
          product_slug: product.slug,
          product_name: product.name,
          product_image_path: product.image_path ?? null,
          variant_id: variant.id,
          variant_name: variant.name,
          unit_price_centavos: variant.price_centavos,
          quantity,
        },
      ]
    }
    case 'quantity':
      if (!validQuantity(action.quantity)) return lines
      return lines.map((line) =>
        line.key === action.key ? { ...line, quantity: action.quantity } : line,
      )
    case 'remove':
      return lines.filter((line) => line.key !== action.key)
    case 'clear':
      return action.confirmed === true ? [] : lines
    case 'order-confirmed':
      // A late response must never clear a cart the customer has since edited.
      return Array.isArray(action.submittedLines) && action.submittedLines.length > 0
        && cartSnapshotKey(lines) === cartSnapshotKey(action.submittedLines) ? [] : lines
    default:
      return lines
  }
}
