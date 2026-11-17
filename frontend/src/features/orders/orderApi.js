import { publicApiUrl } from '../../utils/apiUrl.js'

const messages = {
  disabled: 'Sending orders is not available on this kiosk yet. You can still review your drinks.',
  conflict: 'This submission conflicts with an existing order. Please ask a Haru team member before starting another order.',
  rejected: 'We could not accept one or more selections. Please review the menu and quantities.',
  limited: 'Too many attempts. Please wait before retrying this submission.',
  unavailable: 'Ordering is temporarily unavailable. Your drinks are still in your cart.',
  uncertain: 'We could not confirm the result. Your order may already have been received. Retry this same submission to check safely.',
}

export class OrderApiError extends Error {
  constructor(kind, { status = null, retryAfterMs = 0 } = {}) {
    super(messages[kind] || messages.uncertain)
    this.name = 'OrderApiError'
    this.kind = kind
    this.status = status
    this.uncertain = kind === 'uncertain' || kind === 'conflict'
    this.retryAfterMs = retryAfterMs
  }
}

export function orderSubmissionEnabled(env = {}) {
  // Non-secret UI gate. Backend authorization/feature guard stays authoritative.
  // Mock menu IDs/prices must never be submitted to the real order endpoint.
  return env.VITE_ORDER_SUBMISSION_ENABLED === 'true'
    && (env.VITE_MENU_SOURCE || 'api') === 'api'
}

function invalidResponse() {
  throw new OrderApiError('uncertain')
}

export function normalizeOrderResponse(payload, requestItems) {
  const data = payload?.data
  if (!data || Array.isArray(data) || typeof data !== 'object'
    || typeof data.order_reference !== 'string' || !data.order_reference.trim() || data.order_reference.length > 32
    || data.status !== 'pending' || data.currency !== 'PHP'
    || !Number.isSafeInteger(data.subtotal_centavos) || data.subtotal_centavos < 0
    || !Array.isArray(data.items) || data.items.length === 0 || data.items.length !== requestItems.length) invalidResponse()
  const expected = new Map(requestItems.map((item) => [item.variant_id, item.quantity]))
  const seen = new Set()
  let subtotal = 0
  const items = data.items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || !Number.isSafeInteger(item.product_id) || item.product_id < 1
      || !Number.isSafeInteger(item.variant_id) || item.variant_id < 1 || seen.has(item.variant_id)
      || typeof item.product_name !== 'string' || !item.product_name.trim()
      || (item.variant_name !== null && typeof item.variant_name !== 'string')
      || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 20
      || expected.get(item.variant_id) !== item.quantity
      || !Number.isSafeInteger(item.unit_price_centavos) || item.unit_price_centavos < 0
      || !Number.isSafeInteger(item.line_total_centavos) || item.line_total_centavos < 0
      || !Number.isSafeInteger(item.unit_price_centavos * item.quantity)
      || item.line_total_centavos !== item.unit_price_centavos * item.quantity) invalidResponse()
    seen.add(item.variant_id)
    subtotal += item.line_total_centavos
    if (!Number.isSafeInteger(subtotal)) invalidResponse()
    return Object.freeze({
      product_id: item.product_id, variant_id: item.variant_id,
      product_name: item.product_name, variant_name: item.variant_name,
      unit_price_centavos: item.unit_price_centavos, quantity: item.quantity,
      line_total_centavos: item.line_total_centavos,
    })
  })
  if (subtotal !== data.subtotal_centavos) invalidResponse()
  return Object.freeze({ order_reference: data.order_reference, status: data.status,
    currency: data.currency, subtotal_centavos: data.subtotal_centavos, items: Object.freeze(items) })
}

function retryDelay(value) {
  if (!value) return 60000
  const milliseconds = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now()
  return Number.isFinite(milliseconds) ? Math.max(1000, Math.min(milliseconds, 86400000)) : 60000
}

export async function postOrder(attempt, { env = import.meta.env, fetcher = fetch, timeoutMs = 20000 } = {}) {
  if (!orderSubmissionEnabled(env)) throw new OrderApiError('disabled')
  let url
  try { url = publicApiUrl('orders', env) } catch { throw new OrderApiError('disabled') }
  const controller = new AbortController()
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new OrderApiError('uncertain'))
    }, timeoutMs)
  })
  try {
    const operation = (async () => {
      const response = await fetcher(url, {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: attempt.body, signal: controller.signal,
      })
      if (response.status === 409) throw new OrderApiError('conflict', { status: 409 })
      if (response.status === 422 || response.status === 400 || response.status === 413 || response.status === 415) {
        throw new OrderApiError('rejected', { status: response.status })
      }
      if (response.status === 429) throw new OrderApiError('limited', { status: 429, retryAfterMs: retryDelay(response.headers.get('Retry-After')) })
      if (response.status === 503) throw new OrderApiError('unavailable', { status: 503 })
      if (response.status !== 200 && response.status !== 201) throw new OrderApiError('uncertain', { status: response.status })
      return normalizeOrderResponse(await response.json(), attempt.payload.items)
    })()
    return await Promise.race([operation, deadline])
  } catch (error) {
    throw error instanceof OrderApiError ? error : new OrderApiError('uncertain')
  } finally {
    clearTimeout(timer)
  }
}
