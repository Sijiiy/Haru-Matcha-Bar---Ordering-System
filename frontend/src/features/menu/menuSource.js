// Only public configuration belongs here. Vite embeds VITE_* in browser code.
export function menuSourceConfig(env = {}) {
  const source = env.VITE_MENU_SOURCE || 'api'
  if (!['api', 'mock'].includes(source)) {
    throw new Error('VITE_MENU_SOURCE must be api or mock.')
  }

  const baseUrl = (env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
  if (baseUrl && !/^https?:\/\//.test(baseUrl)) {
    throw new Error('VITE_API_BASE_URL must be a public HTTP(S) URL.')
  }
  if (baseUrl) {
    const parsed = new URL(baseUrl)
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('VITE_API_BASE_URL must not contain credentials, queries, or fragments.')
    }
  }

  return { source, menuUrl: `${baseUrl}/api/menu` }
}
