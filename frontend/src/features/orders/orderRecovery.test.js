import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cartReducer } from '../cart/cartState.js'
import { OrderApiError, postOrder } from './orderApi.js'
import { createOrderSession } from './orderSession.js'
import { createOrderRecoveryStore, ORDER_RECOVERY_KEY, ORDER_RECOVERY_MAX_AGE_MS } from './orderRecovery.js'
import { enabledOrderEnv, fixtureCart, fixtureKey, fixtureStorage, jsonResponse, nextFixtureKey, responseFixture } from './orderTestFixtures.js'

const startedAt = 1800000000000
function open(storage, { now = () => startedAt, scope = '/api/orders', ...options } = {}) {
  return createOrderSession({ enabled: true, makeKey: () => fixtureKey,
    send: async () => { throw new OrderApiError('uncertain') },
    now, recovery: createOrderRecoveryStore({ storage, scope, now }), ...options,
  })
}
const read = (storage) => JSON.parse(storage.getItem(ORDER_RECOVERY_KEY))

test('refresh during an in-flight request restores the persisted attempt without automatically sending', async () => {
  const storage = fixtureStorage()
  let firstCalls = 0
  const first = open(storage, { send: async (attempt) => {
    firstCalls++
    assert.equal(read(storage).body, attempt.body)
    assert.equal(read(storage).outcome, 'pending')
    return new Promise(() => {})
  } })
  void first.submit(fixtureCart({ multiple: true }))
  const body = first.getSnapshot().attempt.body
  assert.equal(read(storage).body, body) // Synchronous persistence before fetch.
  await Promise.resolve()
  assert.equal(firstCalls, 1)
  let calls = 0
  let keys = 0
  const refreshed = open(storage, { send: () => { calls++ }, makeKey: () => { keys++; return nextFixtureKey } })
  await Promise.resolve()
  assert.equal(calls, 0)
  assert.equal(keys, 0)
  assert.equal(refreshed.getSnapshot().recovered, true)
  assert.equal(refreshed.getSnapshot().uncertain, true)
  assert.equal(refreshed.getSnapshot().attempt.body, body)
  assert.equal(refreshed.getSnapshot().phase, 'error')
})

for (const status of [200, 201]) {
  test(`explicit retry after refresh uses the same UUID/items and clears recovery on confirmed ${status}`, async () => {
    const storage = fixtureStorage()
    const before = open(storage)
    await before.submit(fixtureCart({ multiple: true }))
    const original = read(storage).body
    let finish
    const pending = new Promise((resolve) => { finish = resolve })
    let requests = 0
    const after = open(storage, { makeKey: () => { throw new Error('Must not allocate a new UUID') },
      send: (attempt) => postOrder(attempt, { env: enabledOrderEnv, fetcher: async (_, options) => {
        requests++
        assert.equal(options.body, original)
        assert.deepEqual(JSON.parse(options.body), JSON.parse(original))
        await pending
        return jsonResponse(responseFixture(attempt), status)
      } }),
    })
    assert.equal(requests, 0)
    const first = after.submit([])
    const duplicate = after.submit(fixtureCart())
    assert.strictEqual(first, duplicate)
    await Promise.resolve()
    assert.equal(requests, 1)
    finish()
    await first
    assert.equal(after.getSnapshot().phase, 'success')
    assert.equal(storage.getItem(ORDER_RECOVERY_KEY), null)
    await after.submit(fixtureCart())
    assert.equal(requests, 1)
    assert.equal(open(storage).getSnapshot().phase, 'idle')
  })
}

test('editing or clearing the cart after refresh never overwrites the unresolved request', async () => {
  const storage = fixtureStorage()
  const cart = fixtureCart()
  await open(storage).submit(cart)
  const original = read(storage).body
  const after = open(storage)
  const edited = cartReducer(cart, { type: 'quantity', key: cart[0].key, quantity: 7 })
  assert.equal(after.reviewUpdatedCart(edited), false)
  await after.submit(edited)
  assert.equal(read(storage).body, original)
  await after.submit([])
  assert.equal(read(storage).body, original)
  assert.equal(after.getSnapshot().attempt.lines[0].quantity, 2)
  assert.equal(edited[0].quantity, 7)
})

test('missing storage entry is idle and initialization performs no writes', () => {
  const storage = fixtureStorage()
  storage.setItem = () => { throw new Error('No initialization writes permitted') }
  storage.removeItem = () => { throw new Error('No initialization deletes permitted') }
  const session = open(storage)
  assert.equal(session.getSnapshot().phase, 'idle')
  assert.equal(session.getSnapshot().recovered, false)
  assert.equal(session.getSnapshot().recoveryIssue, null)
})

test('unavailable storage blocks sending without allocating an idempotency key', async () => {
  let keys = 0
  let calls = 0
  const session = open({ getItem() { throw new Error('Restricted storage') } }, {
    makeKey: () => { keys++; return fixtureKey }, send: () => { calls++ },
  })
  await session.submit(fixtureCart())
  assert.equal(session.getSnapshot().recoveryIssue.kind, 'unavailable')
  assert.equal(keys, 0)
  assert.equal(calls, 0)
})

test('quota errors and unsuccessful storage readback prevent the HTTP request', async () => {
  for (const setItem of [() => { throw new Error('Quota exceeded') }, () => {}]) {
    const storage = fixtureStorage()
    storage.setItem = setItem
    let calls = 0
    let keys = 0
    const session = open(storage, { send: () => { calls++ }, makeKey: () => { keys++; return fixtureKey } })
    await session.submit(fixtureCart())
    await session.submit(fixtureCart())
    assert.equal(session.getSnapshot().recoveryIssue.kind, 'unavailable')
    assert.equal(calls, 0)
    assert.equal(keys, 1)
  }
})

test('corrupt, oversized, altered-body and unsupported recovery records are retained and fail closed', async () => {
  const valid = fixtureStorage()
  await open(valid).submit(fixtureCart())
  const original = read(valid)
  const corrupt = ['{broken JSON', '', 'x'.repeat(65537), JSON.stringify(null)]
  for (const mutate of [
    (r) => { r.version = 99 },
    (r) => { r.body = r.body.replace(fixtureKey, 'not-a-uuid') },
    (r) => { r.body = r.body.replace('"quantity":2', '"quantity":3') },
    (r) => { r.body = JSON.stringify({ ...JSON.parse(r.body), price: 1 }) },
    (r) => { r.lines[0].quantity = -1 },
    (r) => { r.lines[0].product_name = {} },
    (r) => { r.lines[0].unit_price_centavos = Number.MAX_SAFE_INTEGER },
    (r) => { r.outcome = 'success' },
    (r) => { r.uncertain = false },
    (r) => { r.createdAt = startedAt + 1 },
    (r) => { r.retryAt = Infinity },
  ]) {
    const record = structuredClone(original)
    mutate(record)
    corrupt.push(JSON.stringify(record))
  }
  for (const raw of corrupt) {
    const storage = fixtureStorage()
    storage.setItem(ORDER_RECOVERY_KEY, raw)
    let calls = 0
    const session = open(storage, { send: () => { calls++ }, makeKey: () => { throw new Error('No fresh UUID') } })
    await session.submit(fixtureCart())
    assert.equal(calls, 0)
    assert.equal(session.getSnapshot().recoveryIssue.kind, 'invalid')
    assert.equal(storage.getItem(ORDER_RECOVERY_KEY), raw)
    assert.equal(session.reviewUpdatedCart(fixtureCart()), false)
  }
})

test('expiry is bounded from the original creation time and never silently clears or starts a new order', async () => {
  const storage = fixtureStorage()
  let clock = startedAt
  const session = open(storage, { now: () => clock })
  await session.submit(fixtureCart())
  clock += ORDER_RECOVERY_MAX_AGE_MS - 1
  await session.submit(fixtureCart())
  assert.equal(read(storage).createdAt, startedAt)
  clock++
  const saved = storage.getItem(ORDER_RECOVERY_KEY)
  let calls = 0
  const expired = open(storage, { now: () => clock, send: () => { calls++ } })
  assert.equal(expired.getSnapshot().recoveryIssue.kind, 'expired')
  await expired.submit(fixtureCart())
  await session.submit(fixtureCart()) // Also expires without a refresh.
  assert.equal(session.getSnapshot().recoveryIssue.kind, 'expired')
  assert.equal(calls, 0)
  assert.equal(storage.getItem(ORDER_RECOVERY_KEY), saved)
})

test('an API endpoint change blocks replay against a different database environment', async () => {
  const storage = fixtureStorage()
  await open(storage).submit(fixtureCart())
  const saved = storage.getItem(ORDER_RECOVERY_KEY)
  const changed = open(storage, { scope: 'https://another-api.example.test/api/orders' })
  assert.equal(changed.getSnapshot().recoveryIssue.kind, 'changed')
  await changed.submit(fixtureCart())
  assert.equal(storage.getItem(ORDER_RECOVERY_KEY), saved)
})

test('an already-open session cannot overwrite a different unresolved submission discovered before send', async () => {
  const storage = fixtureStorage()
  let calls = 0
  const idle = open(storage, { send: () => { calls++ } })
  await open(storage, { makeKey: () => nextFixtureKey }).submit(fixtureCart({ multiple: true }))
  const saved = storage.getItem(ORDER_RECOVERY_KEY)
  await idle.submit(fixtureCart())
  assert.equal(idle.getSnapshot().recoveryIssue.kind, 'changed')
  assert.equal(calls, 0)
  assert.equal(storage.getItem(ORDER_RECOVERY_KEY), saved)
})

test('rate-limit cooldown and conflict lock survive refresh', async () => {
  for (const kind of ['limited', 'conflict']) {
    const storage = fixtureStorage()
    const original = open(storage, { send: async () => { throw new OrderApiError(kind, { retryAfterMs: kind === 'limited' ? 2000 : 0 }) } })
    await original.submit(fixtureCart())
    let calls = 0
    const after = open(storage, { send: () => { calls++ } })
    await after.submit(fixtureCart())
    assert.equal(calls, 0)
    assert.equal(after.getSnapshot().error.kind, kind)
    assert.equal(after.getSnapshot().retryAt, kind === 'limited' ? startedAt + 2000 : 0)
  }
})

test('earlier uncertainty survives a later definitive error and another refresh', async () => {
  const storage = fixtureStorage()
  await open(storage).submit(fixtureCart())
  const second = open(storage, { send: async () => { throw new OrderApiError('rejected') } })
  await second.submit([])
  const third = open(storage)
  assert.equal(third.getSnapshot().uncertain, true)
  assert.equal(third.reviewUpdatedCart([]), false)
  assert.equal(read(storage).uncertain, true)
})

test('confirmed success with a storage cleanup failure remains confirmed and blocks a new order', async () => {
  const storage = fixtureStorage()
  const remove = storage.removeItem
  storage.removeItem = () => { throw new Error('Cleanup unavailable') }
  let cart = fixtureCart()
  const session = open(storage, { send: async (attempt) => responseFixture(attempt).data,
    onConfirmed: (_, attempt) => { cart = cartReducer(cart, { type: 'order-confirmed', submittedLines: attempt.lines }) },
  })
  await session.submit(cart)
  assert.equal(session.getSnapshot().phase, 'success')
  assert.equal(session.getSnapshot().recoveryIssue.kind, 'cleanup')
  assert.deepEqual(cart, [])
  assert.equal(session.acknowledgeConfirmation(), false)
  assert.equal(open(storage).getSnapshot().uncertain, true)
  storage.removeItem = remove
  assert.equal(session.acknowledgeConfirmation(), true)
  assert.equal(storage.getItem(ORDER_RECOVERY_KEY), null)
})

test('only explicit review of an edited, definitively rejected cart resolves its saved attempt', async () => {
  const storage = fixtureStorage()
  const cart = fixtureCart()
  await open(storage, { send: async () => { throw new OrderApiError('rejected') } }).submit(cart)
  assert.notEqual(storage.getItem(ORDER_RECOVERY_KEY), null)
  const recovered = open(storage)
  const edited = cartReducer(cart, { type: 'quantity', key: cart[0].key, quantity: 3 })
  assert.equal(recovered.getSnapshot().uncertain, false)
  assert.equal(recovered.reviewUpdatedCart(edited), true)
  assert.equal(storage.getItem(ORDER_RECOVERY_KEY), null)
  assert.equal(recovered.getSnapshot().phase, 'idle')
})

test('failed outcome persistence leaves the earlier pending record for conservative refresh recovery', async () => {
  const storage = fixtureStorage()
  const set = storage.setItem
  let writes = 0
  storage.setItem = (key, value) => { if (++writes > 1) throw new Error('Storage failed'); set(key, value) }
  const session = open(storage, { send: async () => { throw new OrderApiError('rejected') } })
  await session.submit(fixtureCart())
  assert.equal(session.getSnapshot().recoveryIssue.kind, 'unavailable')
  assert.equal(read(storage).outcome, 'pending')
  assert.equal(open(storage).getSnapshot().uncertain, true)
})

test('only whitelisted unresolved catalog metadata is saved, never arbitrary cart fields or completed orders', async () => {
  const storage = fixtureStorage()
  const cart = fixtureCart({ hojicha: true })
  cart[0].credentials = 'must-not-persist'
  cart[0].customer_email = 'must-not-persist'
  cart[0].payment_details = 'must-not-persist'
  cart[0].product_image_path = 'must-not-persist'
  await open(storage).submit(cart)
  const raw = storage.getItem(ORDER_RECOVERY_KEY)
  assert.ok(!raw.includes('must-not-persist'))
  assert.deepEqual(Object.keys(read(storage)), ['version', 'scope', 'createdAt', 'body', 'lines', 'outcome', 'uncertain', 'retryAt'])
  assert.equal(read(storage).lines[0].variant_name, null)
  const after = open(storage)
  assert.equal(after.getSnapshot().attempt.lines[0].variant_name, null)
  assert.equal(after.getSnapshot().attempt.payload.idempotency_key, fixtureKey)
})

test('restored attempts remain blocked when frontend submission is off', async () => {
  const storage = fixtureStorage()
  await open(storage).submit(fixtureCart())
  const raw = storage.getItem(ORDER_RECOVERY_KEY)
  let calls = 0
  const after = open(storage, { enabled: false, send: () => { calls++ } })
  await after.submit([])
  assert.equal(calls, 0)
  assert.equal(after.getSnapshot().attempt.payload.idempotency_key, fixtureKey)
  assert.equal(storage.getItem(ORDER_RECOVERY_KEY), raw)
})
