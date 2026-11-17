import { mockMenuResponse } from '../menu/mockMenu.js'
import { StaffApiError } from './staffApi.js'

// Explicit visual preview only. This adapter has no HTTP capability and cannot
// authenticate against Laravel. Every screen is marked DEMO by StaffPage.
export function createStaffDemoApi() {
  let signedIn = false
  const product = mockMenuResponse.data.flatMap(category => category.products).find(item => item.slug === 'volume-i')
  const variant = product.variants.find(item => item.name === '12 oz')
  const orders = Array.from({ length: 15 }, (_, index) => ({
    order_reference: `HARU-01ARZ3NDEKTSV4RRFFQ69G5F${String(index).padStart(2, '0')}`,
    created_at: new Date(Date.UTC(2026, 10, 17, 4, index)).toISOString(),
    status: 'pending', currency: 'PHP', subtotal_centavos: variant.price_centavos * 2,
    items: [{ product_name: product.name, variant_name: variant.name, quantity: 2,
      unit_price_centavos: variant.price_centavos, line_total_centavos: variant.price_centavos * 2 }],
  }))
  const requireDemo = () => { if (!signedIn) throw new StaffApiError(401) }
  return {
    demo: true,
    session: async () => signedIn ? { name: 'Demo team' } : null,
    login: async () => { signedIn = true; return { name: 'Demo team' } },
    logout: async () => { signedIn = false },
    list: async (page = 1) => {
      requireDemo()
      return structuredClone({ orders: orders.slice((page - 1) * 12, page * 12),
        meta: { current_page: page, last_page: 2, per_page: 12, total: orders.length } })
    },
    detail: async reference => {
      requireDemo()
      const order = orders.find(item => item.order_reference === reference)
      if (!order) throw new StaffApiError(404)
      return structuredClone(order)
    },
  }
}
