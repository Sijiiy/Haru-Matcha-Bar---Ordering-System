import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mockMenuResponse } from '../menu/mockMenu.js'
import {
  cartItemCount,
  cartLineKey,
  cartReducer,
  cartSubtotal,
  lineSubtotal,
  MAX_QUANTITY,
} from './cartState.js'

const volumeI = mockMenuResponse.data[0].products.find((p) => p.slug === 'volume-i')
const small = volumeI.variants.find((v) => v.name === '12 oz')
const large = volumeI.variants.find((v) => v.name === '16 oz (5g)')
const add = (lines, variant = small, quantity = 1) =>
  cartReducer(lines, { type: 'add', product: volumeI, variant, quantity })

test('two Volume I 12 oz drinks have a 44000-centavo subtotal', () => {
  const lines = add([], small, 2)
  assert.equal(cartSubtotal(lines), 44000)
  assert.equal(cartItemCount(lines), 2)
  assert.equal(lines[0].product_id, volumeI.id)
  assert.equal(lines[0].variant_id, small.id)
  assert.equal(lines[0].unit_price_centavos, 22000)
})

test('different variants stay separate and matching variants combine', () => {
  let lines = add([], small, 2)
  lines = add(lines, large)
  lines = add(lines, small)
  assert.equal(lines.length, 2)
  assert.equal(lines.find((l) => l.variant_id === small.id).quantity, 3)
  assert.equal(lines.find((l) => l.variant_id === large.id).quantity, 1)
  assert.equal(cartSubtotal(lines), 97000)
  assert.equal(cartItemCount(lines), 4)
})

test('quantity updates and removal recalculate the subtotal without mutating prior state', () => {
  const initial = add([], small, 2)
  const key = cartLineKey(volumeI.slug, small.id)
  const updated = cartReducer(initial, { type: 'quantity', key, quantity: 3 })
  assert.equal(initial[0].quantity, 2)
  assert.equal(lineSubtotal(updated[0]), 66000)
  const empty = cartReducer(updated, { type: 'remove', key })
  assert.deepEqual(empty, [])
  assert.equal(cartSubtotal(empty), 0)
  assert.equal(cartItemCount(empty), 0)
})

test('repeat additions and direct quantity changes enforce the same upper bound', () => {
  const lines = add([], small, MAX_QUANTITY)
  assert.equal(lines[0].quantity, MAX_QUANTITY)
  assert.strictEqual(add(lines), lines)
  assert.strictEqual(
    cartReducer(lines, { type: 'quantity', key: lines[0].key, quantity: MAX_QUANTITY + 1 }),
    lines,
  )
})

test('invalid quantities cannot enter or alter the cart', () => {
  const lines = add([])
  for (const quantity of [0, -1, 1.5, NaN, Infinity, MAX_QUANTITY + 1]) {
    assert.strictEqual(add(lines, small, quantity), lines)
    assert.strictEqual(cartReducer(lines, { type: 'quantity', key: lines[0].key, quantity }), lines)
  }
})

test('a variant outside the selected product and invalid prices are rejected', () => {
  const lines = []
  assert.strictEqual(add(lines, { ...small, id: -1 }), lines)
  assert.strictEqual(add(lines, { ...small, price_centavos: -1 }), lines)
  assert.strictEqual(add(lines, { ...small, price_centavos: 1.5 }), lines)
})

test('image metadata is retained without changing cart identity, merging or pricing', () => {
  const product = { ...volumeI, image_path: '/approved/volume-i.png' }
  let lines = cartReducer([], { type: 'add', product, variant: small, quantity: 1 })
  assert.equal(lines[0].product_image_path, product.image_path)
  assert.equal(lines[0].key, cartLineKey(volumeI.slug, small.id))
  lines = cartReducer(lines, { type: 'add', product, variant: small, quantity: 1 })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].quantity, 2)
  assert.equal(lines[0].product_image_path, product.image_path)
  assert.equal(lines[0].variant_id, small.id)
  assert.equal(cartSubtotal(lines), 44000)
  assert.equal(add([])[0].product_image_path, null)
})

test('cancelled or unconfirmed clearing preserves every cart line and total', () => {
  const lines = add(add([], small, 2), large, 3)
  const snapshot = structuredClone(lines)
  assert.strictEqual(cartReducer(lines, { type: 'clear', confirmed: false }), lines)
  assert.strictEqual(cartReducer(lines, { type: 'clear' }), lines)
  assert.deepEqual(lines, snapshot)
  assert.equal(cartItemCount(lines), 5)
  assert.equal(cartSubtotal(lines), 137000)
})

test('confirmed clearing removes all lines and resets count and subtotal', () => {
  const lines = add(add([], small, MAX_QUANTITY), large, 2)
  const cleared = cartReducer(lines, { type: 'clear', confirmed: true })
  assert.deepEqual(cleared, [])
  assert.equal(cartItemCount(cleared), 0)
  assert.equal(cartSubtotal(cleared), 0)
  assert.equal(lines.length, 2)
  assert.equal(lines[0].quantity, MAX_QUANTITY)
})

test('clearing an empty cart is safe and a new order can start after clearing', () => {
  const cleared = cartReducer(add([], small, MAX_QUANTITY), { type: 'clear', confirmed: true })
  assert.deepEqual(cartReducer([], { type: 'clear', confirmed: true }), [])
  const restarted = add(cleared, small, 1)
  assert.equal(restarted.length, 1)
  assert.equal(restarted[0].quantity, 1)
  assert.equal(cartSubtotal(restarted), 22000)
})
