import { recoveryLines, restoreOrderAttempt } from './orderRequest.js'

export const ORDER_RECOVERY_KEY = 'haru.order-recovery.v1'
export const ORDER_RECOVERY_MAX_AGE_MS = 30 * 60 * 1000
const MAX_RECORD_LENGTH = 65536
const outcomes = new Set(['pending', 'uncertain', 'conflict', 'rejected', 'limited', 'unavailable'])

const messages = {
  unavailable: 'This kiosk cannot safely save or read order recovery. Sending is blocked. Please ask a Haru team member; an earlier order may already exist.',
  invalid: 'Saved order recovery could not be verified. Do not start another order on this kiosk. Please ask a Haru team member to check for an earlier order.',
  expired: 'The earlier submission is too old for customer retry. It may already have been received. Please ask a Haru team member to resolve it before starting another order.',
  changed: 'Another unresolved submission or a different menu connection was found. Sending is blocked. Please ask a Haru team member to check the earlier order.',
  cleanup: 'Your order is confirmed, but this kiosk could not clear its recovery record. Please ask a Haru team member before starting another order.',
}

export class OrderRecoveryError extends Error {
  constructor(kind = 'unavailable') {
    super(messages[kind] || messages.unavailable)
    this.name = 'OrderRecoveryError'
    this.kind = kind
  }
}

// Reads on construction/load only; no storage probe writes or automatic POSTs.
// scope is the public order endpoint, preventing replay against another API.
export function createOrderRecoveryStore({ storage, scope = '/api/orders', now = Date.now } = {}) {
  const browserStorage = () => storage ?? globalThis.window.sessionStorage
  const read = () => {
    try { return browserStorage().getItem(ORDER_RECOVERY_KEY) } catch { throw new OrderRecoveryError() }
  }
  const decode = (raw) => {
    try {
      if (typeof raw !== 'string' || raw.length > MAX_RECORD_LENGTH) throw new Error()
      const record = JSON.parse(raw)
      if (!record || record.version !== 1 || typeof record.scope !== 'string'
        || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0 || record.createdAt > now()
        || !outcomes.has(record.outcome) || typeof record.uncertain !== 'boolean'
        || !Number.isSafeInteger(record.retryAt) || record.retryAt < 0
        || record.retryAt > record.createdAt + ORDER_RECOVERY_MAX_AGE_MS + 86400000
        || (['pending', 'uncertain', 'conflict'].includes(record.outcome) && !record.uncertain)) throw new Error()
      const attempt = restoreOrderAttempt(record.body, record.lines)
      return { ...record, attempt }
    } catch { throw new OrderRecoveryError('invalid') }
  }
  const load = () => {
    if (typeof scope !== 'string' || !scope) throw new OrderRecoveryError('changed')
    const raw = read()
    if (raw === null) return null
    const record = decode(raw)
    if (record.scope !== scope) throw new OrderRecoveryError('changed')
    if (now() - record.createdAt >= ORDER_RECOVERY_MAX_AGE_MS) throw new OrderRecoveryError('expired')
    return record
  }
  return {
    load,
    save(attempt, { createdAt, outcome, uncertain, retryAt = 0 }) {
      // Never overwrite a different or unreadable unresolved submission.
      const existing = load()
      if (existing && (existing.body !== attempt.body || existing.createdAt !== createdAt)) throw new OrderRecoveryError('changed')
      if (now() - createdAt >= ORDER_RECOVERY_MAX_AGE_MS) throw new OrderRecoveryError('expired')
      let raw
      try {
        raw = JSON.stringify({ version: 1, scope, createdAt, body: attempt.body,
          lines: recoveryLines(attempt.lines), outcome, uncertain, retryAt })
        decode(raw)
      } catch { throw new OrderRecoveryError('invalid') }
      try {
        browserStorage().setItem(ORDER_RECOVERY_KEY, raw)
        if (read() !== raw) throw new Error()
      } catch { throw new OrderRecoveryError() }
    },
    clear(attempt) {
      const raw = read()
      if (raw === null) return
      const existing = decode(raw)
      if (existing.scope !== scope || existing.body !== attempt.body) throw new OrderRecoveryError('changed')
      try {
        browserStorage().removeItem(ORDER_RECOVERY_KEY)
        if (read() !== null) throw new Error()
      } catch { throw new OrderRecoveryError() }
    },
  }
}
