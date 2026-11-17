import { useState, useSyncExternalStore } from 'react'
import { orderSubmissionEnabled, postOrder } from './orderApi.js'
import { createOrderSession } from './orderSession.js'
import { createOrderRecoveryStore } from './orderRecovery.js'
import { publicApiUrl } from '../../utils/apiUrl.js'

export function useOrderSubmission(onConfirmed) {
  const [enabled] = useState(() => orderSubmissionEnabled(import.meta.env))
  const [session] = useState(() => {
    let scope = null
    try { scope = publicApiUrl('orders', import.meta.env) } catch { /* Fail closed without breaking menu browsing. */ }
    return createOrderSession({
      enabled, send: (attempt) => postOrder(attempt), onConfirmed,
      recovery: createOrderRecoveryStore({ scope }),
    })
  })
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  return { state, session, enabled }
}
