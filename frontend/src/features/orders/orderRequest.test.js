import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cartReducer, cartSubtotal } from '../cart/cartState.js'
import { createOrderAttempt, orderItems, secureOrderKey } from './orderRequest.js'
import { fixtureCart, fixtureKey } from './orderTestFixtures.js'

test('request contains only a UUID and actual fixture database variant IDs/quantities', () => {
  const lines = fixtureCart({ multiple: true })
  const attempt = createOrderAttempt(lines, () => fixtureKey)
  assert.deepEqual(JSON.parse(attempt.body), {
    idempotency_key: fixtureKey,
    items: lines.map((line) => ({ variant_id: line.variant_id, quantity: line.quantity })),
  })
  assert.equal(attempt.payload.items[0].variant_id, lines[0].variant_id)
  assert.ok(attempt.payload.items[0].variant_id > 10000)
  assert.equal(attempt.estimatedSubtotal, 75000)
  for (const field of ['price', 'subtotal', 'status', 'payment', 'product_name', 'product_id']) {
    assert.ok(!attempt.body.includes(field))
  }
})

test('attempt freezes the exact payload and display snapshot independently of later cart edits', () => {
  const lines = fixtureCart()
  const attempt = createOrderAttempt(lines, () => fixtureKey)
  const body = attempt.body
  lines[0].quantity = 6
  lines[0].unit_price_centavos = 1
  assert.equal(attempt.body, body)
  assert.equal(attempt.lines[0].quantity, 2)
  assert.equal(attempt.lines[0].unit_price_centavos, 22000)
  assert.ok(Object.isFrozen(attempt.payload.items[0]))
  assert.throws(() => { attempt.payload.items[0].quantity = 5 }, TypeError)
})

test('normalization sorts and merges duplicate variant IDs with aggregate limits', () => {
  const lines = fixtureCart({ multiple: true })
  assert.deepEqual(orderItems([lines[1], { ...lines[0], quantity: 1 }, lines[0]]), [
    { variant_id: lines[0].variant_id, quantity: 3 },
    { variant_id: lines[1].variant_id, quantity: 1 },
  ])
  assert.throws(() => orderItems([{ ...lines[0], quantity: 20 }, lines[0]]))
})

test('empty/invalid/excessive orders fail before allocating a key', () => {
  let allocations = 0
  const makeKey = () => { allocations++; return fixtureKey }
  assert.throws(() => createOrderAttempt([], makeKey))
  for (const quantity of [0, -1, 21, 1.5, '2', NaN]) {
    assert.throws(() => createOrderAttempt([{ ...fixtureCart()[0], quantity }], makeKey))
  }
  for (const variant_id of [0, -1, '10001', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createOrderAttempt([{ ...fixtureCart()[0], variant_id }], makeKey))
  }
  assert.throws(() => createOrderAttempt(Array.from({ length: 6 }, (_, index) => ({ ...fixtureCart()[0], variant_id: index + 1, quantity: 20 })), makeKey))
  assert.throws(() => createOrderAttempt(Array.from({ length: 51 }, () => ({ ...fixtureCart()[0], quantity: 1 })), makeKey))
  assert.equal(allocations, 0)
})

test('cryptographic UUIDs are v4 and distinct', () => {
  const first = secureOrderKey()
  const second = secureOrderKey()
  assert.match(first, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i)
  assert.notEqual(first, second)
})

test('successful settlement clears only an unchanged cart and preserves subsequent edits', () => {
  const lines = fixtureCart()
  const attempt = createOrderAttempt(lines, () => fixtureKey)
  assert.deepEqual(cartReducer(lines, { type: 'order-confirmed', submittedLines: attempt.lines }), [])
  const edited = cartReducer(lines, { type: 'quantity', key: lines[0].key, quantity: 3 })
  assert.strictEqual(cartReducer(edited, { type: 'order-confirmed', submittedLines: attempt.lines }), edited)
  assert.equal(cartSubtotal(edited), 66000)
  assert.strictEqual(cartReducer(lines, { type: 'order-confirmed' }), lines)
})
