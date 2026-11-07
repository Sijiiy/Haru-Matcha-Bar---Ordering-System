import { mockMenuResponse } from './mockMenu.js'

const MOCK_RESPONSE_DELAY = 420

function abortError() {
  return new DOMException('The request was cancelled.', 'AbortError')
}

async function getMockMenu({ signal } = {}) {
  await new Promise((resolve) => window.setTimeout(resolve, MOCK_RESPONSE_DELAY))

  if (signal?.aborted) {
    throw abortError()
  }

  return structuredClone(mockMenuResponse.data)
}

export async function getMenuFromApi({ signal } = {}) {
  const response = await fetch('/api/menu', {
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    throw new Error('The menu could not be loaded.')
  }

  const payload = await response.json()

  if (!Array.isArray(payload.data)) {
    throw new Error('The menu response was not in the expected format.')
  }

  return payload.data
}

// Frontend milestone 1 uses confirmed development mock data.
// Switch this boundary to getMenuFromApi when the production catalog is ready.
export function getMenu(options) {
  return getMockMenu(options)
}
