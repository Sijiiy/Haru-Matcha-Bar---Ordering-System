// Imported by isolated tests only; never used as a runtime order source.
import { mockMenuResponse } from '../menu/mockMenu.js'
import { cartReducer } from '../cart/cartState.js'

export const fixtureKey = '20cc41e2-587c-4e3f-a1bc-df4a4c61ad20'
export const nextFixtureKey = '9f876caa-8c35-4b25-a915-eb02724e3b63'
export const enabledOrderEnv = { VITE_ORDER_SUBMISSION_ENABLED: 'true', VITE_MENU_SOURCE: 'api' }

export function fixtureCart({ multiple = false, hojicha = false } = {}) {
  const categories = structuredClone(mockMenuResponse.data)
  const product = categories.flatMap((category) => category.products).find((item) => item.slug === (hojicha ? 'hojicha' : 'volume-i'))
  product.id += 1000
  product.variants = product.variants.map((variant) => ({ ...variant, id: variant.id + 10000 }))
  let lines = cartReducer([], { type: 'add', product, variant: product.variants[0], quantity: 2 })
  if (multiple) lines = cartReducer(lines, { type: 'add', product, variant: product.variants[1], quantity: 1 })
  return lines
}

export function responseFixture(attempt, prices = {}) {
  const items = attempt.payload.items.map((item) => {
    const line = attempt.lines.find((entry) => entry.variant_id === item.variant_id)
    const price = prices[item.variant_id] ?? line.unit_price_centavos
    return {
      product_id: line.product_id, variant_id: item.variant_id,
      product_name: line.product_name, variant_name: line.variant_name,
      unit_price_centavos: price, quantity: item.quantity, line_total_centavos: price * item.quantity,
    }
  })
  return { data: {
    order_reference: 'HARU-01ARZ3NDEKTSV4RRFFQ69G5FAV', status: 'pending', currency: 'PHP',
    subtotal_centavos: items.reduce((sum, item) => sum + item.line_total_centavos, 0), items,
  } }
}

export const jsonResponse = (payload, status = 201, headers = {}) => new Response(JSON.stringify(payload), { status, headers })

export function fixtureStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)) },
    removeItem: (key) => { values.delete(key) },
  }
}
