import { cartSnapshotKey } from '../cart/cartState.js'
import { OrderApiError } from './orderApi.js'
import { createOrderAttempt, secureOrderKey } from './orderRequest.js'
import { createOrderRecoveryStore, OrderRecoveryError } from './orderRecovery.js'

const initialState = () => Object.freeze({ phase: 'idle', attempt: null, result: null, error: null, uncertain: false, retryAt: 0,
  recovered: false, recoveryIssue: null, createdAt: 0 })

// One session per MenuPage. Only unresolved requests survive a same-tab refresh.
export function createOrderSession({ enabled = false, send, makeKey = secureOrderKey, onConfirmed = () => {}, now = Date.now,
  recovery = createOrderRecoveryStore({ now }) } = {}) {
  let state = initialState()
  try {
    const saved = recovery.load()
    if (saved) {
      const kind = saved.outcome === 'pending' ? 'uncertain' : saved.outcome
      state = Object.freeze({ ...state, phase: 'error', attempt: saved.attempt, recovered: true,
        createdAt: saved.createdAt, uncertain: saved.uncertain, retryAt: saved.retryAt, error: new OrderApiError(kind) })
    }
  } catch (error) {
    state = Object.freeze({ ...state, recovered: true, recoveryIssue: error instanceof OrderRecoveryError ? error : new OrderRecoveryError() })
  }
  let inFlight = null
  const listeners = new Set()
  const update = (next) => {
    state = Object.freeze(next)
    listeners.forEach((listener) => listener())
  }

  const session = {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    submit(lines) {
      if (inFlight || state.phase === 'submitting') return inFlight || Promise.resolve(null)
      if (state.phase === 'success') return Promise.resolve(state.result)
      if (state.recoveryIssue || state.error?.kind === 'conflict' || now() < state.retryAt) return Promise.resolve(null)
      if (!enabled) {
        update({ ...state, phase: 'error', error: new OrderApiError('disabled') })
        return Promise.resolve(null)
      }
      let attempt = state.attempt
      if (!attempt) {
        try { attempt = createOrderAttempt(lines, makeKey) } catch (error) {
          update({ ...state, phase: 'error', error: { kind: 'invalid', message: error.message } })
          return Promise.resolve(null)
        }
      }
      const wasUncertain = state.uncertain
      const createdAt = state.attempt ? state.createdAt : now()
      try {
        // Synchronous durable write/readback completes BEFORE send is scheduled.
        recovery.save(attempt, { createdAt, outcome: 'pending', uncertain: true })
      } catch (error) {
        update({ ...state, attempt, createdAt, recoveryIssue: error instanceof OrderRecoveryError ? error : new OrderRecoveryError() })
        return Promise.resolve(null)
      }
      update({ ...state, phase: 'submitting', attempt, createdAt, error: null, retryAt: 0 })
      inFlight = Promise.resolve().then(() => send(attempt)).then((result) => {
        let recoveryIssue = null
        try { recovery.clear(attempt) } catch { recoveryIssue = new OrderRecoveryError('cleanup') }
        update({ ...state, phase: 'success', result, error: null, retryAt: 0, recoveryIssue })
        onConfirmed(result, attempt)
        return result
      }, (failure) => {
        const error = failure instanceof OrderApiError ? failure : new OrderApiError('uncertain')
        const uncertain = wasUncertain || error.uncertain
        const retryAt = error.retryAfterMs ? now() + error.retryAfterMs : 0
        let recoveryIssue = null
        try { recovery.save(attempt, { createdAt, outcome: error.kind, uncertain, retryAt }) } catch (issue) {
          recoveryIssue = issue instanceof OrderRecoveryError ? issue : new OrderRecoveryError()
        }
        update({ ...state, phase: 'error', error, uncertain, retryAt, recoveryIssue })
        return null
      }).finally(() => { inFlight = null })
      return inFlight
    },
    reviewUpdatedCart(lines) {
      if (state.phase !== 'error' || state.recoveryIssue || state.uncertain || state.error?.kind === 'conflict' || inFlight) return false
      if (!state.attempt || cartSnapshotKey(lines) !== state.attempt.cartKey) {
        try { if (state.attempt) recovery.clear(state.attempt) } catch (error) {
          update({ ...state, recoveryIssue: error instanceof OrderRecoveryError ? error : new OrderRecoveryError() })
          return false
        }
        update(initialState())
        return true
      }
      return false
    },
    acknowledgeConfirmation() {
      if (state.phase !== 'success' || inFlight) return false
      try { recovery.clear(state.attempt) } catch {
        update({ ...state, recoveryIssue: new OrderRecoveryError('cleanup') })
        return false
      }
      update(initialState())
      return true
    },
  }
  return session
}
