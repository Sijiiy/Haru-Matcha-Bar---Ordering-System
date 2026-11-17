const messages = {
  401: 'Please sign in to the staff area.',
  403: 'This account does not have staff access.',
  404: 'This order could not be found. Refresh the order list.',
  419: 'Your session security token expired. Please try signing in again.',
  422: 'Please check your email and password or request.',
  429: 'Too many requests. Please wait before retrying.',
  503: 'Staff access is not available yet.',
}

export class StaffApiError extends Error {
  constructor(status = 0) {
    super(messages[status] || (status === 0 ? 'Could not reach Haru. Check the connection and retry.' : 'The staff request could not be completed. Please retry.'))
    this.name = 'StaffApiError'
    this.status = status
  }
}
const invalid = () => { throw new StaffApiError(500) }
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const integer = (v, min = 0) => Number.isSafeInteger(v) && v >= min
export const staffReference = value => typeof value === 'string' && /^HARU-[0-9A-HJKMNP-TV-Z]{26}$/.test(value)

export function normalizeStaffOrder(data) {
  if (!data || !staffReference(data.order_reference) || data.status !== 'pending' || data.currency !== 'PHP'
    || !text(data.created_at, 40) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(data.created_at) || !Number.isFinite(Date.parse(data.created_at))
    || !integer(data.subtotal_centavos) || !Array.isArray(data.items) || !data.items.length || data.items.length > 50) invalid()
  let subtotal = 0
  const items = data.items.map(item => {
    if (!item || !text(item.product_name, 100) || (item.variant_name !== null && !text(item.variant_name, 50))
      || !integer(item.quantity, 1) || item.quantity > 20 || !integer(item.unit_price_centavos) || !integer(item.line_total_centavos)
      || !Number.isSafeInteger(item.unit_price_centavos * item.quantity)
      || item.line_total_centavos !== item.unit_price_centavos * item.quantity) invalid()
    subtotal += item.line_total_centavos
    if (!Number.isSafeInteger(subtotal)) invalid()
    return { product_name: item.product_name, variant_name: item.variant_name,
      quantity: item.quantity, unit_price_centavos: item.unit_price_centavos, line_total_centavos: item.line_total_centavos }
  })
  if (subtotal !== data.subtotal_centavos) invalid()
  return { order_reference: data.order_reference, created_at: data.created_at, status: data.status,
    currency: data.currency, subtotal_centavos: data.subtotal_centavos, items }
}

export function normalizeStaffPage(payload, page) {
  const meta = payload?.meta
  if (!meta || !Array.isArray(payload.data) || !integer(meta.current_page, 1) || meta.current_page !== page
    || !integer(meta.per_page, 1) || meta.per_page > 25 || !integer(meta.total)
    || meta.last_page !== Math.max(1, Math.ceil(meta.total / meta.per_page))
    || payload.data.length > meta.per_page) invalid()
  const orders = payload.data.map(normalizeStaffOrder)
  if (new Set(orders.map(order => order.order_reference)).size !== orders.length) invalid()
  return { orders, meta: { current_page: meta.current_page, last_page: meta.last_page, per_page: meta.per_page, total: meta.total } }
}

// Staff is deliberately same-origin: cookies/credentials never follow a public
// kiosk API-base override. /api and /sanctum use the existing Laravel proxy.
export function createStaffApi({ fetcher = fetch, cookies = () => document.cookie, timeoutMs = 15000 } = {}) {
  async function request(url, { method = 'GET', body, csrf = false, empty = false } = {}) {
    const controller = new AbortController()
    let timer
    const headers = { Accept: 'application/json' }
    if (body) headers['Content-Type'] = 'application/json'
    if (csrf) {
      const match = cookies().split(';').map(value => value.trim()).find(value => value.startsWith('XSRF-TOKEN='))
      if (!match) throw new StaffApiError(419)
      try { headers['X-XSRF-TOKEN'] = decodeURIComponent(match.slice('XSRF-TOKEN='.length)) } catch { throw new StaffApiError(419) }
    }
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new StaffApiError()) }, timeoutMs)
    })
    try {
      const operation = (async () => {
        const response = await fetcher(url, { method, headers, body: body ? JSON.stringify(body) : undefined,
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new StaffApiError(response.status)
        if (empty) {
          if (response.status !== 204) throw new StaffApiError(500)
          return null
        }
        try { return await response.json() } catch { throw new StaffApiError(500) }
      })()
      return await Promise.race([operation, deadline])
    } catch (error) {
      throw error instanceof StaffApiError ? error : new StaffApiError()
    } finally { clearTimeout(timer) }
  }
  const csrf = () => request('/sanctum/csrf-cookie', { empty: true })
  const identity = payload => {
    if (!text(payload?.data?.name, 255)) invalid()
    return { name: payload.data.name }
  }
  return {
    demo: false,
    session: async () => identity(await request('/api/staff/session')),
    async login(email, password) {
      await csrf()
      return identity(await request('/api/staff/login', { method: 'POST', body: { email, password }, csrf: true }))
    },
    async logout() {
      await csrf()
      try { await request('/api/staff/logout', { method: 'POST', csrf: true, empty: true }) } catch (error) {
        if (error.status !== 401) throw error
      }
    },
    async list(page = 1) {
      if (!integer(page, 1) || page > 10000) throw new StaffApiError(422)
      return normalizeStaffPage(await request(`/api/staff/orders?page=${page}&per_page=12`), page)
    },
    async detail(reference) {
      if (!staffReference(reference)) throw new StaffApiError(404)
      const order = normalizeStaffOrder((await request(`/api/staff/orders/${encodeURIComponent(reference)}`))?.data)
      if (order.order_reference !== reference) invalid()
      return order
    },
  }
}
