import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatPeso } from '../../utils/currency.js'
import { normalizeOrderResponse, OrderApiError, orderSubmissionEnabled, postOrder } from './orderApi.js'
import { createOrderAttempt } from './orderRequest.js'
import { enabledOrderEnv, fixtureCart, fixtureKey, jsonResponse, responseFixture } from './orderTestFixtures.js'

const attempt = () => createOrderAttempt(fixtureCart({ multiple: true }), () => fixtureKey)

test('live submission defaults off and mock menu IDs cannot reach the order endpoint', async () => {
  assert.equal(orderSubmissionEnabled(), false)
  assert.equal(orderSubmissionEnabled({ VITE_ORDER_SUBMISSION_ENABLED: 'false' }), false)
  assert.equal(orderSubmissionEnabled({ VITE_ORDER_SUBMISSION_ENABLED: 'TRUE' }), false)
  assert.equal(orderSubmissionEnabled(enabledOrderEnv), true)
  let calls = 0
  for (const env of [{}, { ...enabledOrderEnv, VITE_MENU_SOURCE: 'mock' }]) {
    await assert.rejects(postOrder(attempt(), { env, fetcher: () => { calls++ } }), (error) => error.kind === 'disabled')
  }
  assert.equal(calls, 0)
})

for (const status of [201, 200]) {
  test(`${status} returns the authoritative order using the existing API URL convention`, async () => {
    const request = attempt()
    const backend = responseFixture(request, { [request.lines[0].variant_id]: 22125 })
    backend.data.request_fingerprint = 'not-public'
    const result = await postOrder(request, {
      env: { ...enabledOrderEnv, VITE_API_BASE_URL: 'https://api.example.test/' },
      fetcher: async (url, options) => {
        assert.equal(url, 'https://api.example.test/api/orders')
        assert.equal(options.method, 'POST')
        assert.deepEqual(options.headers, { Accept: 'application/json', 'Content-Type': 'application/json' })
        assert.equal(options.body, request.body)
        assert.deepEqual(Object.keys(JSON.parse(options.body)), ['idempotency_key', 'items'])
        for (const item of JSON.parse(options.body).items) assert.deepEqual(Object.keys(item), ['variant_id', 'quantity'])
        return jsonResponse(backend, status)
      },
    })
    assert.equal(result.subtotal_centavos, 75250)
    assert.notEqual(result.subtotal_centavos, request.estimatedSubtotal)
    assert.equal(formatPeso(result.subtotal_centavos), '₱752.50')
    assert.equal(result.status, 'pending')
    assert.equal(result.items[0].variant_id, request.payload.items[0].variant_id)
    assert.ok(!Object.hasOwn(result, 'request_fingerprint'))
  })
}

for (const [status, kind, uncertain] of [[409, 'conflict', true], [422, 'rejected', false], [429, 'limited', false], [503, 'unavailable', false], [500, 'uncertain', true], [502, 'uncertain', true]]) {
  test(`HTTP ${status} is handled without exposing raw server errors`, async () => {
    await assert.rejects(postOrder(attempt(), {
      env: enabledOrderEnv,
      fetcher: async () => jsonResponse({ message: 'sensitive internal trace' }, status, { 'Retry-After': '2' }),
    }), (error) => {
      assert.ok(error instanceof OrderApiError)
      assert.equal(error.kind, kind)
      assert.equal(error.uncertain, uncertain)
      assert.equal(error.status, status)
      assert.ok(!error.message.includes('sensitive'))
      if (status === 429) assert.equal(error.retryAfterMs, 2000)
      return true
    })
  })
}

test('network failure and a timeout keep the result uncertain, including stalled response bodies', async () => {
  let abortedSignal
  const fetchers = [
    async () => { throw new TypeError('offline') },
    async (_, options) => { abortedSignal = options.signal; return new Promise(() => {}) },
    async () => ({ status: 201, json: () => new Promise(() => {}) }),
  ]
  for (const fetcher of fetchers) {
    await assert.rejects(postOrder(attempt(), { env: enabledOrderEnv, fetcher, timeoutMs: 10 }), (error) => error.kind === 'uncertain')
  }
  assert.equal(abortedSignal.aborted, true)
})

test('invalid JSON and malformed/mismatched successful responses stay uncertain', async () => {
  const request = attempt()
  await assert.rejects(postOrder(request, {
    env: enabledOrderEnv, fetcher: async () => new Response('not JSON', { status: 201 }),
  }), (error) => error.kind === 'uncertain')
  const mutations = [
    (p) => { p.data.status = 'paid' },
    (p) => { p.data.currency = 'USD' },
    (p) => { p.data.items[0].variant_id = 999999 },
    (p) => { p.data.items[0].quantity = 10 },
    (p) => { p.data.subtotal_centavos = 1 },
    (p) => { p.data.items[0].unit_price_centavos = 1.5 },
    (p) => { p.data.items[0].line_total_centavos = -1 },
    (p) => { p.data.items[1].variant_id = p.data.items[0].variant_id },
    (p) => { p.data.items = [] },
  ]
  for (const mutate of mutations) {
    const payload = responseFixture(request)
    mutate(payload)
    assert.throws(() => normalizeOrderResponse(payload, request.payload.items), (error) => error.kind === 'uncertain')
  }
})

test('single-price Hojicha retains a null variant name from the backend', async () => {
  const request = createOrderAttempt(fixtureCart({ hojicha: true }), () => fixtureKey)
  const result = await postOrder(request, { env: enabledOrderEnv, fetcher: async () => jsonResponse(responseFixture(request)) })
  assert.equal(result.items[0].variant_name, null)
})

test('unsafe deployment URL is rejected locally before HTTP', async () => {
  let calls = 0
  await assert.rejects(postOrder(attempt(), {
    env: { ...enabledOrderEnv, VITE_API_BASE_URL: 'https://user:secret@example.test' },
    fetcher: async () => { calls++ },
  }), (error) => error.kind === 'disabled')
  assert.equal(calls, 0)
})
