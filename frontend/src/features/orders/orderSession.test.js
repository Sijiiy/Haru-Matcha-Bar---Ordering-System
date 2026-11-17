import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cartReducer, cartSubtotal } from '../cart/cartState.js'
import { OrderApiError, postOrder } from './orderApi.js'
import { createOrderSession as createSession } from './orderSession.js'
import { createOrderRecoveryStore } from './orderRecovery.js'
import { enabledOrderEnv, fixtureCart, fixtureKey, fixtureStorage, jsonResponse, nextFixtureKey, responseFixture } from './orderTestFixtures.js'

function createOrderSession(options) {
  return createSession({ ...options, recovery: createOrderRecoveryStore({ storage: fixtureStorage(), now: options?.now }) })
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

test('default-off and empty-cart sessions make no request and allocate no UUID', async () => {
  let calls = 0
  let keys = 0
  const options = { makeKey: () => { keys++; return fixtureKey }, send: () => { calls++ } }
  const disabled = createOrderSession(options)
  await disabled.submit(fixtureCart())
  assert.equal(disabled.getSnapshot().error.kind, 'disabled')
  const enabled = createOrderSession({ ...options, enabled: true })
  await enabled.submit([])
  assert.equal(enabled.getSnapshot().error.kind, 'invalid')
  assert.equal(calls, 0)
  assert.equal(keys, 0)
})

test('single-item submission prevents duplicate taps and clears the cart only after confirmed success', async () => {
  let cart = fixtureCart()
  const pending = deferred()
  let calls = 0
  let confirmations = 0
  const session = createOrderSession({
    enabled: true, makeKey: () => fixtureKey,
    send: async (attempt) => { calls++; await pending.promise; return responseFixture(attempt).data },
    onConfirmed: (_, attempt) => { confirmations++; cart = cartReducer(cart, { type: 'order-confirmed', submittedLines: attempt.lines }) },
  })
  const first = session.submit(cart)
  const second = session.submit(cart)
  assert.strictEqual(first, second)
  assert.equal(session.getSnapshot().phase, 'submitting')
  assert.equal(cartSubtotal(cart), 44000)
  await Promise.resolve()
  assert.equal(calls, 1)
  pending.resolve()
  const result = await first
  assert.equal(result.subtotal_centavos, 44000)
  assert.equal(session.getSnapshot().phase, 'success')
  assert.deepEqual(cart, [])
  assert.equal(confirmations, 1)
  await session.submit(fixtureCart())
  assert.equal(calls, 1)
})

test('uncertain retry retains its UUID and byte-identical payload across modal subscriptions and cart changes', async () => {
  let cart = fixtureCart()
  let keys = 0
  const bodies = []
  const session = createOrderSession({
    enabled: true, makeKey: () => { keys++; return fixtureKey },
    send: (attempt) => postOrder(attempt, {
      env: enabledOrderEnv,
      fetcher: async (_, options) => {
        bodies.push(options.body)
        if (bodies.length === 1) throw new TypeError('network timeout')
        return jsonResponse(responseFixture(attempt), 200)
      },
    }),
    onConfirmed: (_, attempt) => { cart = cartReducer(cart, { type: 'order-confirmed', submittedLines: attempt.lines }) },
  })
  const before = structuredClone(cart)
  const unsubscribe = session.subscribe(() => {})
  await session.submit(cart)
  assert.deepEqual(cart, before)
  const originalAttempt = session.getSnapshot().attempt
  assert.equal(session.getSnapshot().uncertain, true)
  unsubscribe()
  const reopen = session.subscribe(() => {})
  assert.strictEqual(session.getSnapshot().attempt, originalAttempt)
  cart = cartReducer(cart, { type: 'quantity', key: cart[0].key, quantity: 3 })
  assert.equal(session.reviewUpdatedCart(cart), false)
  await session.submit(cart)
  reopen()
  assert.equal(keys, 1)
  assert.equal(bodies.length, 2)
  assert.equal(bodies[0], bodies[1])
  assert.equal(JSON.parse(bodies[1]).items[0].quantity, 2)
  assert.equal(cart[0].quantity, 3)
  assert.equal(session.getSnapshot().result.subtotal_centavos, 44000)
})

test('clearing the visible cart cannot erase an uncertain attempt', async () => {
  const session = createOrderSession({ enabled: true, makeKey: () => fixtureKey, send: async () => { throw new OrderApiError('uncertain') } })
  const cart = fixtureCart()
  await session.submit(cart)
  const attempt = session.getSnapshot().attempt
  const cleared = cartReducer(cart, { type: 'clear', confirmed: true })
  assert.equal(session.reviewUpdatedCart(cleared), false)
  await session.submit(cleared)
  assert.strictEqual(session.getSnapshot().attempt, attempt)
  assert.equal(attempt.payload.items[0].quantity, 2)
})

test('all required HTTP errors preserve the cart and the original attempt', async () => {
  for (const status of [409, 422, 429, 503, 500]) {
    let cart = fixtureCart({ multiple: true })
    const before = structuredClone(cart)
    const session = createOrderSession({ enabled: true, makeKey: () => fixtureKey,
      send: (attempt) => postOrder(attempt, { env: enabledOrderEnv, fetcher: async () => jsonResponse({}, status) }),
      onConfirmed: () => { cart = [] },
    })
    await session.submit(cart)
    assert.equal(session.getSnapshot().phase, 'error')
    assert.equal(session.getSnapshot().attempt.payload.idempotency_key, fixtureKey)
    assert.deepEqual(cart, before)
  }
})

test('a definitive rejection permits explicit review of edited contents with a new UUID', async () => {
  let keys = 0
  const requests = []
  const session = createOrderSession({ enabled: true,
    makeKey: () => [fixtureKey, nextFixtureKey][keys++],
    send: async (attempt) => { requests.push(attempt.body); throw new OrderApiError('rejected', { status: 422 }) },
  })
  let cart = fixtureCart()
  await session.submit(cart)
  cart = cartReducer(cart, { type: 'quantity', key: cart[0].key, quantity: 3 })
  assert.equal(session.reviewUpdatedCart(cart), true)
  await session.submit(cart)
  assert.notEqual(requests[0], requests[1])
  assert.equal(JSON.parse(requests[1]).idempotency_key, nextFixtureKey)
})

test('conflict requires staff help and cannot silently generate a new key', async () => {
  let calls = 0
  let keys = 0
  const session = createOrderSession({ enabled: true, makeKey: () => { keys++; return fixtureKey },
    send: async () => { calls++; throw new OrderApiError('conflict', { status: 409 }) },
  })
  await session.submit(fixtureCart())
  assert.equal(session.reviewUpdatedCart([]), false)
  assert.equal(session.acknowledgeConfirmation(), false)
  await session.submit(fixtureCart())
  assert.equal(calls, 1)
  assert.equal(keys, 1)
  assert.equal(session.getSnapshot().uncertain, true)
})

test('a later 422 or 503 cannot erase uncertainty from an earlier network/server failure', async () => {
  for (const subsequent of ['rejected', 'unavailable']) {
    let calls = 0
    const session = createOrderSession({ enabled: true, makeKey: () => fixtureKey,
      send: async () => { calls++; throw new OrderApiError(calls === 1 ? 'uncertain' : subsequent) },
    })
    await session.submit(fixtureCart())
    await session.submit(fixtureCart())
    assert.equal(session.getSnapshot().uncertain, true)
    assert.equal(session.reviewUpdatedCart([]), false)
  }
})

test('429 cooldown prevents early retries and then reuses the exact attempt', async () => {
  let clock = 1000
  let calls = 0
  const bodies = []
  const session = createOrderSession({ enabled: true, now: () => clock, makeKey: () => fixtureKey,
    send: async (attempt) => { bodies.push(attempt.body); calls++; throw new OrderApiError('limited', { retryAfterMs: 2000 }) },
  })
  await session.submit(fixtureCart())
  await session.submit(fixtureCart())
  assert.equal(calls, 1)
  clock += 2000
  await session.submit(fixtureCart())
  assert.equal(calls, 2)
  assert.equal(bodies[0], bodies[1])
})

test('a new confirmed customer intent receives a new key only after confirmation acknowledgement', async () => {
  let keys = 0
  const session = createOrderSession({ enabled: true,
    makeKey: () => [fixtureKey, nextFixtureKey][keys++],
    send: async (attempt) => responseFixture(attempt).data,
  })
  await session.submit(fixtureCart())
  await session.submit(fixtureCart())
  assert.equal(keys, 1)
  assert.equal(session.acknowledgeConfirmation(), true)
  await session.submit(fixtureCart())
  assert.equal(keys, 2)
  assert.equal(session.getSnapshot().attempt.payload.idempotency_key, nextFixtureKey)
})
