const matchaSections = {
  'volume-i': 'Volume Series',
  'volume-ii': 'Volume Series',
  'volume-iii': 'Volume Series',
  rozu: 'Signature Matcha',
  kohaku: 'Signature Matcha',
  'koga-crunch': 'Signature Matcha',
  'banana-yume': 'Creamy Matcha',
  'shio-cream': 'Creamy Matcha',
  'kogane-cream': 'Creamy Matcha',
}

function invalid() {
  throw new Error('The menu response was not in the expected format.')
}

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
}

function id(value) {
  if (!Number.isSafeInteger(value) || value <= 0) invalid()
}

function text(value) {
  if (typeof value !== 'string' || !value.trim()) invalid()
}

function nullableText(value) {
  if (value !== null && typeof value !== 'string') invalid()
}

function unique(values) {
  if (new Set(values).size !== values.length) invalid()
}

// Adds presentation metadata only. API identities, ordering, names and integer
// prices pass through unchanged; malformed data is rejected, never replaced.
export function normalizeMenu(payload) {
  record(payload)
  if (!Array.isArray(payload.data)) invalid()

  const productIds = []
  const productSlugs = []
  const variantIds = []
  const categories = payload.data.map((category) => {
    record(category)
    id(category.id)
    text(category.name)
    text(category.slug)
    nullableText(category.description)
    if (!Array.isArray(category.products)) invalid()

    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      products: category.products.map((product) => {
        record(product)
        id(product.id)
        text(product.name)
        text(product.slug)
        nullableText(product.description)
        nullableText(product.image_path ?? null)
        if (!Array.isArray(product.variants) || product.variants.length === 0) invalid()
        productIds.push(product.id)
        productSlugs.push(product.slug)

        return {
          id: product.id,
          name: product.name,
          slug: product.slug,
          description: product.description,
          image_path: product.image_path ?? null,
          section: category.slug === 'matcha'
            ? (Object.hasOwn(matchaSections, product.slug) ? matchaSections[product.slug] : 'Matcha')
            : null,
          variants: product.variants.map((variant) => {
            record(variant)
            id(variant.id)
            nullableText(variant.name)
            if (!Number.isSafeInteger(variant.price_centavos) || variant.price_centavos < 0) invalid()
            variantIds.push(variant.id)
            return { id: variant.id, name: variant.name, price_centavos: variant.price_centavos }
          }),
        }
      }),
    }
  })

  unique(categories.map((category) => category.id))
  unique(categories.map((category) => category.slug))
  unique(productIds)
  unique(productSlugs)
  unique(variantIds)
  return categories
}
