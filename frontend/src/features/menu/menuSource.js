import { publicApiUrl } from '../../utils/apiUrl.js'

// Only public configuration belongs here. Vite embeds VITE_* in browser code.
export function menuSourceConfig(env = {}) {
  const source = env.VITE_MENU_SOURCE || 'api'
  if (!['api', 'mock'].includes(source)) {
    throw new Error('VITE_MENU_SOURCE must be api or mock.')
  }

  return { source, menuUrl: publicApiUrl('menu', env) }
}
