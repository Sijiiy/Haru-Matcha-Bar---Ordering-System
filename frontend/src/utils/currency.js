const pesoFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

export function formatPeso(priceCentavos) {
  if (!Number.isInteger(priceCentavos) || priceCentavos < 0) {
    return ''
  }

  return pesoFormatter.format(priceCentavos / 100)
}
