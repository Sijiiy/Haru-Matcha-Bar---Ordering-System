import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { mockMenuResponse } from './mockMenu.js'
import { normalizeMenu } from './normalizeMenu.js'
import { menuSourceConfig } from './menuSource.js'
import { getMenu } from './menuApi.js'
import { cartReducer, cartSubtotal } from '../cart/cartState.js'

function apiFixture() {
  const payload = structuredClone(mockMenuResponse)
  for (const category of payload.data) {
    category.id += 100
    for (const product of category.products) {
      product.id += 1000
      delete product.section
      for (const variant of product.variants) variant.id += 10000
    }
  }
  return payload
}

test('API mode is default and deployment URL is public configuration', () => {
  assert.deepEqual(menuSourceConfig(), { source: 'api', menuUrl: '/api/menu' })
  assert.deepEqual(menuSourceConfig({ VITE_API_BASE_URL: 'https://api.example.test/' }), {
    source: 'api', menuUrl: 'https://api.example.test/api/menu',
  })
  assert.throws(() => menuSourceConfig({ VITE_MENU_SOURCE: 'automatic' }))
  assert.throws(() => menuSourceConfig({ VITE_API_BASE_URL: 'https://user:secret@example.test' }))
})

test('API mode fetches the configured URL and retains actual API identities and order', async () => {
  const fixture = apiFixture()
  const categories = await getMenu({
    env: { VITE_API_BASE_URL: 'https://api.example.test' },
    fetcher: async (url, options) => {
      assert.equal(url, 'https://api.example.test/api/menu')
      assert.equal(options.headers.Accept, 'application/json')
      return new Response(JSON.stringify(fixture))
    },
  })
  assert.deepEqual(categories.map((c) => c.id), [101, 102, 103])
  const product = categories[0].products[0]
  assert.equal(product.id, 1001)
  assert.equal(product.variants[0].id, 10001)
  assert.equal(product.variants[0].price_centavos, 22000)
  assert.equal(categories[0].products[0].section, 'Volume Series')
  assert.equal(categories[0].products[3].section, 'Signature Matcha')
  assert.equal(categories[0].products[6].section, 'Creamy Matcha')
  assert.equal(categories[1].products[0].variants[0].name, null)
})

test('cart stores API IDs and correctly combines only matching variants', () => {
  const product = normalizeMenu(apiFixture())[0].products[0]
  let lines = []
  for (const [variant, quantity] of [[product.variants[0], 2], [product.variants[1], 1], [product.variants[0], 1]]) {
    lines = cartReducer(lines, { type: 'add', product, variant, quantity })
  }
  assert.equal(lines.length, 2)
  assert.equal(lines[0].product_id, 1001)
  assert.equal(lines[0].variant_id, 10001)
  assert.equal(lines[0].quantity, 3)
  assert.equal(cartSubtotal(lines), 97000)
})

test('explicit mock mode never calls the API', async () => {
  const categories = await getMenu({
    env: { VITE_MENU_SOURCE: 'mock' },
    fetcher: () => { throw new Error('Mock mode must not fetch') },
  })
  assert.equal(categories.flatMap((c) => c.products).length, 18)
})

test('network/HTTP/JSON/schema failures reject without falling back to mocks', async () => {
  const failures = [
    async () => { throw new TypeError('Network unavailable') },
    async () => new Response('Unavailable', { status: 503 }),
    async () => new Response('not JSON'),
    async () => new Response(JSON.stringify({ unexpected: [] })),
  ]
  for (const fetcher of failures) await assert.rejects(getMenu({ env: {}, fetcher }))
})

test('empty API catalog stays empty and unknown products retain a fallback section', () => {
  assert.deepEqual(normalizeMenu({ data: [] }), [])
  const payload = apiFixture()
  payload.data[0].products[0].slug = 'future-approved-drink'
  assert.equal(normalizeMenu(payload)[0].products[0].section, 'Matcha')
  payload.data[0].products[0].slug = '__proto__'
  delete payload.data[0].products[0].image_path
  const unknown = normalizeMenu(payload)[0].products[0]
  assert.equal(unknown.section, 'Matcha')
  assert.equal(unknown.image_path, null)
})

test('invalid nested responses, duplicate identities and non-integer prices are rejected', () => {
  const mutations = [
    (p) => { p.data[0].products = null },
    (p) => { p.data[0].products[0].variants = [] },
    (p) => { p.data[0].products[0].variants[0].price_centavos = '22000' },
    (p) => { p.data[0].products[0].variants[0].price_centavos = 22000.5 },
    (p) => { p.data[0].products[0].variants[0].price_centavos = -1 },
    (p) => { p.data[0].products[0].variants[0].id = null },
    (p) => { p.data[0].products[1].id = p.data[0].products[0].id },
  ]
  for (const mutate of mutations) {
    const payload = apiFixture()
    mutate(payload)
    assert.throws(() => normalizeMenu(payload))
  }
})

test('backend seed snapshot exactly matches confirmed mock names/descriptions/variants/prices', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../../../backend/database/data/haru-catalog.json', import.meta.url), 'utf8'))
  const expected = {
    data: mockMenuResponse.data.map(({ name, slug, description, products }) => ({
      name, slug, description,
      products: products.map(({ name, slug, description, variants }) => ({
        name, slug, description,
        variants: variants.map(({ name, price_centavos }) => ({ name, price_centavos })),
      })),
    })),
  }
  assert.deepEqual(fixture, expected)
  assert.equal(fixture.data.flatMap((c) => c.products).length, 18)
  assert.equal(fixture.data.flatMap((c) => c.products.flatMap((p) => p.variants)).length, 31)
})
