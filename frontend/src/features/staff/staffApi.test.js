import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStaffApi, normalizeStaffOrder, normalizeStaffPage, StaffApiError } from './staffApi.js'
import { createStaffDemoApi } from './staffDemo.js'
import { createStaffClient } from './staffSource.js'
import { isStaffPath } from '../../utils/appPath.js'
import { staffTime } from './staffTime.js'

const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
async function fixture() {
  const api = createStaffDemoApi()
  await api.login()
  const page = await api.list(1)
  return { data: page.orders, meta: page.meta }
}

test('staff routing is separate from the kiosk and demo is explicit with no HTTP capability', async () => {
  assert.equal(isStaffPath('/'), false)
  assert.equal(isStaffPath('/staff'), true)
  assert.equal(isStaffPath('/staff/'), true)
  assert.equal(isStaffPath('/staffing'), false)
  assert.equal(createStaffClient().demo, false)
  assert.equal(createStaffClient({ VITE_STAFF_DEMO: 'false' }).demo, false)
  let calls = 0
  const demo = createStaffClient({ VITE_STAFF_DEMO: 'true' }, { fetcher: () => { calls++ } })
  assert.equal(await demo.session(), null)
  await demo.login()
  const page = await demo.list(1)
  assert.equal(page.orders.length, 12)
  assert.equal((await demo.list(2)).orders.length, 3)
  assert.deepEqual(await demo.detail(page.orders[0].order_reference), page.orders[0])
  normalizeStaffPage({ data: page.orders, meta: page.meta }, 1)
  await demo.logout()
  assert.equal(await demo.session(), null)
  assert.equal(calls, 0)
})

test('login uses same-origin cookies and the Sanctum CSRF handshake without browser token storage', async () => {
  const requests = []
  const api = createStaffApi({ cookies: () => 'other=1; XSRF-TOKEN=encrypted%2Bcookie%3D',
    fetcher: async (url, options) => {
      requests.push({ url, options })
      return url === '/sanctum/csrf-cookie' ? new Response(null, { status: 204 }) : json({ data: { name: 'Fixture team', secret: 'omit' } })
    },
  })
  assert.deepEqual(await api.login('fixture@example.test', 'fixture-only'), { name: 'Fixture team' })
  assert.equal(requests[0].url, '/sanctum/csrf-cookie')
  assert.equal(requests[1].url, '/api/staff/login')
  assert.equal(requests[1].options.method, 'POST')
  assert.deepEqual(JSON.parse(requests[1].options.body), { email: 'fixture@example.test', password: 'fixture-only' })
  assert.equal(requests[1].options.headers['X-XSRF-TOKEN'], 'encrypted+cookie=')
  for (const { options } of requests) {
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.cache, 'no-store')
    assert.equal(options.headers.Authorization, undefined)
  }
})

test('missing or corrupt CSRF cookie prevents credential submission', async () => {
  for (const cookies of ['', 'XSRF-TOKEN=%invalid']) {
    let posts = 0
    const api = createStaffApi({ cookies: () => cookies, fetcher: async (_, options) => { if (options.method === 'POST') posts++; return new Response(null, { status: 204 }) } })
    await assert.rejects(api.login('fixture@example.test', 'fixture'), error => error.status === 419)
    assert.equal(posts, 0)
  }
})

test('list and detail whitelist the actual snapshot contract and numeric pagination, ignoring server URLs', async () => {
  const page = await fixture()
  page.data[0].idempotency_key = 'omit-private-field'
  page.data[0].items[0].product_id = 123
  page.links = { next: 'https://untrusted.example.test/' }
  const api = createStaffApi({ fetcher: async url => {
    if (url.includes('?')) { assert.equal(url, '/api/staff/orders?page=1&per_page=12'); return json(page) }
    assert.equal(url, `/api/staff/orders/${page.data[0].order_reference}`)
    return json({ data: page.data[0] })
  } })
  const listed = await api.list(1)
  assert.equal(listed.orders.length, 12)
  assert.ok(!JSON.stringify(listed).includes('idempotency'))
  assert.ok(!JSON.stringify(listed).includes('product_id'))
  assert.equal(listed.links, undefined)
  assert.deepEqual(await api.detail(listed.orders[0].order_reference), listed.orders[0])
  assert.equal(listed.orders[0].subtotal_centavos, 44000)
  await assert.rejects(api.detail('../orders'), error => error.status === 404)
  await assert.rejects(api.list(10001), error => error.status === 422)
})

for (const status of [401, 403, 419, 422, 429, 500, 503]) {
  test(`HTTP ${status} is explicit and redacts server diagnostics without fake orders`, async () => {
    const api = createStaffApi({ fetcher: async () => json({ message: 'sensitive database trace' }, status) })
    await assert.rejects(api.list(), error => error instanceof StaffApiError && error.status === status && !error.message.includes('sensitive'))
  })
}

test('network errors and deadlines reject, including stalled response bodies', async () => {
  for (const fetcher of [async () => { throw Error('offline') }, async () => new Promise(() => {}), async () => ({ ok: true, json: () => new Promise(() => {}) })]) {
    await assert.rejects(createStaffApi({ fetcher, timeoutMs: 10 }).list(), error => error.status === 0)
  }
})

test('invalid JSON/shapes, prices, statuses, duplicate references and mismatched details are rejected', async () => {
  await assert.rejects(createStaffApi({ fetcher: async () => new Response('invalid JSON') }).list(), error => error.status === 500)
  for (const mutate of [
    order => { order.status = 'paid' }, order => { order.created_at = 'not a date' },
    order => { order.subtotal_centavos = 1 }, order => { order.items[0].quantity = -1 },
    order => { order.items[0].unit_price_centavos = 1.5 }, order => { order.items[0].line_total_centavos = 2 },
  ]) {
    const order = (await fixture()).data[0]
    mutate(order)
    assert.throws(() => normalizeStaffOrder(order), StaffApiError)
  }
  const page = await fixture()
  page.data[1] = page.data[0]
  assert.throws(() => normalizeStaffPage(page, 1), StaffApiError)
  const empty = normalizeStaffPage({ data: [], meta: { current_page: 1, last_page: 1, per_page: 12, total: 0 } }, 1)
  assert.deepEqual(empty.orders, [])
  const order = (await fixture()).data[0]
  const api = createStaffApi({ fetcher: async () => json({ data: order }) })
  await assert.rejects(api.detail('HARU-01ARZ3NDEKTSV4RRFFQ69G5FAV'), StaffApiError)
})

test('null single-price variants stay unlabelled and timestamps use Philippine time', async () => {
  const order = (await fixture()).data[0]
  order.items[0].variant_name = null
  assert.equal(normalizeStaffOrder(order).items[0].variant_name, null)
  assert.ok(staffTime('2026-11-17T04:00:00Z').includes('12:00'))
})

test('logout refreshes CSRF, posts without a password, and accepts an already expired session', async () => {
  const requests = []
  const api = createStaffApi({ cookies: () => 'XSRF-TOKEN=fixture', fetcher: async (url, options) => {
    requests.push({ url, options })
    return url === '/sanctum/csrf-cookie' ? new Response(null, { status: 204 }) : json({}, 401)
  } })
  await api.logout()
  assert.equal(requests[1].url, '/api/staff/logout')
  assert.equal(requests[1].options.method, 'POST')
  assert.equal(requests[1].options.body, undefined)
})

test('an unexpected HTML success page cannot falsely confirm logout', async () => {
  const api = createStaffApi({ cookies: () => 'XSRF-TOKEN=fixture', fetcher: async url => url === '/sanctum/csrf-cookie'
    ? new Response(null, { status: 204 }) : new Response('<html>unrelated page</html>', { status: 200 }) })
  await assert.rejects(api.logout(), error => error.status === 500)
})
