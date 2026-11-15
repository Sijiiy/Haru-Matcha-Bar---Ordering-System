import { normalizeMenu } from './normalizeMenu.js'
import { menuSourceConfig } from './menuSource.js'

export async function getMenuFromApi({ signal, url = '/api/menu', fetcher = fetch } = {}) {
  // The timeout also covers stalled response bodies. Parent cancellation stays
  // an AbortError; a timeout remains a visible, retryable load failure.
  const timeout = AbortSignal.timeout(15000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetcher(url, {
    headers: { Accept: 'application/json' },
    signal: requestSignal,
  })
  if (!response.ok) throw new Error('The menu could not be loaded.')
  return normalizeMenu(await response.json())
}

export async function getMenu({ signal, env = import.meta.env, fetcher = fetch } = {}) {
  const { source, menuUrl } = menuSourceConfig(env)
  if (source === 'mock') {
    // Mock catalog is loaded only when explicitly selected. API errors never
    // enter this path, and mock prices are not bundled into the API entry chunk.
    const { mockMenuResponse } = await import('./mockMenu.js')
    signal?.throwIfAborted()
    return normalizeMenu(structuredClone(mockMenuResponse))
  }
  return getMenuFromApi({ signal, url: menuUrl, fetcher })
}
