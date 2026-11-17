import assert from 'node:assert/strict'
import { test } from 'node:test'
import { StaffApiError } from './staffApi.js'
import { createStaffDemoApi } from './staffDemo.js'
import { createStaffSession } from './staffSession.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('session check, login, pending cards, details, pagination, refresh and logout use the selected adapter', async () => {
  const session = createStaffSession(createStaffDemoApi())
  assert.equal(session.getSnapshot().auth, 'checking')
  await session.start()
  assert.equal(session.getSnapshot().auth, 'guest')
  await session.login('', '')
  assert.equal(session.getSnapshot().auth, 'staff')
  assert.equal(session.getSnapshot().orders.length, 12)
  assert.equal(session.getSnapshot().orders[0].status, 'pending')
  const reference = session.getSnapshot().orders[0].order_reference
  await session.openDetail(reference)
  assert.equal(session.getSnapshot().detail.subtotal_centavos, 44000)
  session.closeDetail()
  assert.equal(session.getSnapshot().reference, null)
  await session.loadPage(2)
  assert.equal(session.getSnapshot().orders.length, 3)
  assert.equal(session.getSnapshot().meta.current_page, 2)
  await session.loadPage(2)
  await session.logout()
  assert.equal(session.getSnapshot().auth, 'guest')
  assert.deepEqual(session.getSnapshot().orders, [])
  assert.equal(session.getSnapshot().detail, null)
})

test('login shows busy/error states, prevents duplicate sign-in and never keeps credentials in session state', async () => {
  const wait = deferred()
  let calls = 0
  const session = createStaffSession({ demo: false, session: async () => null,
    login: async () => { calls++; await wait.promise; throw new StaffApiError(422) },
  })
  await session.start()
  const first = session.login('fixture@example.test', 'fixture-secret')
  await session.login('fixture@example.test', 'fixture-secret')
  assert.equal(session.getSnapshot().signingIn, true)
  assert.equal(calls, 1)
  assert.ok(!JSON.stringify(session.getSnapshot()).includes('fixture-secret'))
  wait.resolve()
  await first
  assert.equal(session.getSnapshot().auth, 'guest')
  assert.equal(session.getSnapshot().authError.status, 422)
})

test('dashboard loading and empty data stay distinct from errors', async () => {
  const wait = deferred()
  const session = createStaffSession({ demo: false, session: async () => ({ name: 'Fixture' }), list: () => wait.promise })
  const loading = session.start()
  await Promise.resolve()
  assert.equal(session.getSnapshot().listStatus, 'loading')
  wait.resolve({ orders: [], meta: { current_page: 1, last_page: 1, per_page: 12, total: 0 } })
  await loading
  assert.equal(session.getSnapshot().listStatus, 'success')
  assert.deepEqual(session.getSnapshot().orders, [])
})

for (const status of [401, 403, 429, 500, 503, 0]) {
  test(`staff session HTTP/network ${status} errors cannot reveal prior order data`, async () => {
    const session = createStaffSession({ demo: false, session: async () => { throw new StaffApiError(status) } })
    await session.start()
    assert.equal(session.getSnapshot().auth, status === 401 ? 'guest' : status === 403 ? 'forbidden' : 'error')
    assert.deepEqual(session.getSnapshot().orders, [])
    assert.equal(session.getSnapshot().user, null)
  })
}

test('a revoked/expired session clears cards and details immediately', async () => {
  for (const status of [401, 403]) {
    const demo = createStaffDemoApi()
    await demo.login()
    let fail = false
    const session = createStaffSession({ ...demo, detail: async reference => {
      if (fail) throw new StaffApiError(status)
      return demo.detail(reference)
    } })
    await session.start()
    const reference = session.getSnapshot().orders[0].order_reference
    await session.openDetail(reference)
    fail = true
    await session.openDetail(reference)
    assert.equal(session.getSnapshot().detail, null)
    assert.equal(session.getSnapshot().reference, null)
    assert.deepEqual(session.getSnapshot().orders, [])
    assert.equal(session.getSnapshot().auth, status === 401 ? 'guest' : 'forbidden')
  }
})

test('failed refresh/detail can be retried without fake orders or stale modal content', async () => {
  const demo = createStaffDemoApi()
  await demo.login()
  let failing = true
  const session = createStaffSession({ ...demo, list: async page => {
    if (failing) throw new StaffApiError(500)
    return demo.list(page)
  }, detail: async () => { throw new StaffApiError(404) } })
  await session.start()
  assert.equal(session.getSnapshot().listStatus, 'error')
  assert.deepEqual(session.getSnapshot().orders, [])
  failing = false
  await session.loadPage(1)
  assert.equal(session.getSnapshot().orders.length, 12)
  await session.openDetail(session.getSnapshot().orders[0].order_reference)
  assert.equal(session.getSnapshot().detailStatus, 'error')
  assert.equal(session.getSnapshot().detail, null)
})

test('late page responses and closed detail requests cannot replace newer navigation', async () => {
  const demo = createStaffDemoApi()
  await demo.login()
  const old = deferred(), detail = deferred()
  const session = createStaffSession({ ...demo, list: page => page === 1 ? old.promise : demo.list(page), detail: () => detail.promise })
  const start = session.start()
  await Promise.resolve()
  await session.loadPage(2)
  old.resolve(await demo.list(1))
  await start
  assert.equal(session.getSnapshot().meta.current_page, 2)
  const reference = session.getSnapshot().orders[0].order_reference
  const opened = session.openDetail(reference)
  session.closeDetail()
  detail.resolve(await demo.detail(reference))
  await opened
  assert.equal(session.getSnapshot().detail, null)
  assert.equal(session.getSnapshot().reference, null)
})

test('logout clears order data before HTTP finishes and reports failure without claiming sign-out', async () => {
  const demo = createStaffDemoApi()
  await demo.login()
  const wait = deferred()
  const session = createStaffSession({ ...demo, logout: async () => { await wait.promise; throw new StaffApiError() } })
  await session.start()
  const logout = session.logout()
  assert.deepEqual(session.getSnapshot().orders, [])
  assert.equal(session.getSnapshot().user, null)
  wait.resolve()
  await logout
  assert.equal(session.getSnapshot().auth, 'logout-error')
})

test('an unavailable staff feature still permits explicit logout without exposing orders', async () => {
  let logouts = 0
  const session = createStaffSession({ demo: false, session: async () => { throw new StaffApiError(503) }, logout: async () => { logouts++ } })
  await session.start()
  assert.equal(session.getSnapshot().auth, 'error')
  await session.logout()
  assert.equal(logouts, 1)
  assert.equal(session.getSnapshot().auth, 'guest')
  assert.deepEqual(session.getSnapshot().orders, [])
})
