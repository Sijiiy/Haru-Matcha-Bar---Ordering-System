import { cartLineKey, cartSnapshotKey, cartSubtotal, MAX_QUANTITY } from '../cart/cartState.js'

export function orderItems(lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('Add a drink before sending your order.')
  if (lines.length > 50) throw new Error('Please keep each order to 50 selections or fewer.')
  const quantities = new Map()
  for (const line of lines) {
    if (!Number.isSafeInteger(line.variant_id) || line.variant_id < 1
      || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY) {
      throw new Error('Please review the selected drinks and quantities.')
    }
    quantities.set(line.variant_id, (quantities.get(line.variant_id) || 0) + line.quantity)
  }
  const items = [...quantities].sort(([a], [b]) => a - b)
    .map(([variant_id, quantity]) => ({ variant_id, quantity }))
  if (items.some((item) => item.quantity > MAX_QUANTITY)) throw new Error('Up to 20 drinks per option can be sent in one order.')
  if (items.reduce((sum, item) => sum + item.quantity, 0) > 100) throw new Error('Up to 100 drinks can be sent in one order.')
  return items
}

export function secureOrderKey() {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('This kiosk cannot securely start an order. Please ask a Haru team member.')
  }
  return globalThis.crypto.randomUUID()
}

export function createOrderAttempt(lines, makeKey = secureOrderKey) {
  const items = orderItems(lines).map((item) => Object.freeze(item))
  const key = makeKey()
  if (typeof key !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(key)) {
    throw new Error('This kiosk could not securely start an order. Please ask a Haru team member.')
  }
  const payload = Object.freeze({ idempotency_key: key.toLowerCase(), items: Object.freeze(items) })
  return Object.freeze({
    payload,
    body: JSON.stringify(payload),
    lines: Object.freeze(lines.map((line) => Object.freeze({ ...line }))),
    cartKey: cartSnapshotKey(lines),
    estimatedSubtotal: cartSubtotal(lines),
  })
}

// Whitelist catalog display metadata only. Prices here remain estimates, never
// request fields. Images, arbitrary cart properties and customer data are omitted.
export function recoveryLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 50) throw new Error('Invalid recovery selection.')
  const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
  const seen = new Set()
  return lines.map((line) => {
    if (!line || !Number.isSafeInteger(line.product_id) || line.product_id < 1
      || !text(line.product_slug, 120) || !text(line.product_name, 100)
      || (line.variant_name !== null && !text(line.variant_name, 50))
      || !Number.isSafeInteger(line.unit_price_centavos) || line.unit_price_centavos < 0
      || !Number.isSafeInteger(line.unit_price_centavos * line.quantity)
      || seen.has(line.variant_id)) throw new Error('Invalid recovery selection.')
    seen.add(line.variant_id)
    return {
      key: cartLineKey(line.product_slug, line.variant_id),
      product_id: line.product_id, product_slug: line.product_slug, product_name: line.product_name,
      variant_id: line.variant_id, variant_name: line.variant_name,
      unit_price_centavos: line.unit_price_centavos, quantity: line.quantity,
    }
  })
}

export function restoreOrderAttempt(body, lines) {
  if (typeof body !== 'string' || body.length > 8000) throw new Error('Invalid recovery request.')
  const payload = JSON.parse(body)
  const attempt = createOrderAttempt(recoveryLines(lines), () => payload?.idempotency_key)
  // Only our original canonical, whitelisted request is recoverable. Rebuilding
  // the display snapshot must never change even one byte of the submitted body.
  if (attempt.body !== body || !Number.isSafeInteger(attempt.estimatedSubtotal)) throw new Error('Invalid recovery request.')
  return attempt
}
