const pesoFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  trailingZeroDisplay: 'stripIfInteger',
})

export function formatPeso(priceCentavos) {
  if (!Number.isInteger(priceCentavos) || priceCentavos < 0) {
    return ''
  }

  return pesoFormatter.format(priceCentavos / 100)
}
