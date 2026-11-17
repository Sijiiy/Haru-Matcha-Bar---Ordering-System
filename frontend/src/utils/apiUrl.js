// Public browser configuration only; credentials never belong in VITE_* values.
export function publicApiUrl(path, env = {}) {
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
  return `${baseUrl}/api/${path}`
}
