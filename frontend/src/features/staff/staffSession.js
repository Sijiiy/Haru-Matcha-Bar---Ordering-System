const emptyData = { orders: [], meta: null, listStatus: 'idle', listError: null,
  detail: null, reference: null, detailStatus: 'idle', detailError: null }
const messageError = error => error?.message ? error : new Error('The staff request could not be completed.')

export function createStaffSession(api) {
  let state = { ...emptyData, auth: 'checking', user: null, authError: null, signingIn: false, signingOut: false, demo: api.demo }
  const listeners = new Set()
  let epoch = 0, listRequest = 0, detailRequest = 0
  const update = patch => { state = { ...state, ...patch }; listeners.forEach(listener => listener()) }
  const denied = error => {
    if (![401, 403, 419].includes(error.status)) return false
    epoch++
    update({ ...emptyData, auth: error.status === 403 ? 'forbidden' : 'guest', user: null, authError: error, signingIn: false })
    return true
  }
  const session = {
    getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    cancel() { epoch++; listRequest++; detailRequest++ },
    async start() {
      const version = ++epoch
      update({ ...emptyData, auth: 'checking', user: null, authError: null })
      try {
        const user = await api.session()
        if (version !== epoch) return
        update({ auth: user ? 'staff' : 'guest', user })
        if (user) await session.loadPage(1)
      } catch (error) {
        if (version !== epoch) return
        if (!denied(error)) update({ auth: 'error', authError: messageError(error) })
      }
    },
    async login(email, password) {
      if (state.signingIn || state.signingOut) return
      const version = ++epoch
      update({ ...emptyData, signingIn: true, authError: null, user: null })
      try {
        const user = await api.login(email, password)
        if (version !== epoch) return
        update({ auth: 'staff', user, signingIn: false })
        await session.loadPage(1)
      } catch (error) {
        if (version !== epoch) return
        update({ auth: error.status === 403 ? 'forbidden' : 'guest', signingIn: false, authError: messageError(error) })
      }
    },
    async loadPage(page = 1) {
      if (state.auth !== 'staff' || state.signingOut) return
      const version = epoch, request = ++listRequest
      update({ orders: [], listStatus: 'loading', listError: null })
      try {
        const { orders, meta } = await api.list(page)
        if (version !== epoch || request !== listRequest) return
        update({ orders, meta, listStatus: 'success' })
      } catch (error) {
        if (version !== epoch || request !== listRequest) return
        if (!denied(error)) update({ listStatus: 'error', listError: messageError(error) })
      }
    },
    async openDetail(reference) {
      if (state.auth !== 'staff') return
      const version = epoch, request = ++detailRequest
      update({ reference, detail: null, detailStatus: 'loading', detailError: null })
      try {
        const detail = await api.detail(reference)
        if (version !== epoch || request !== detailRequest) return
        update({ detail, detailStatus: 'success' })
      } catch (error) {
        if (version !== epoch || request !== detailRequest) return
        if (!denied(error)) update({ detailStatus: 'error', detailError: messageError(error) })
      }
    },
    closeDetail() { detailRequest++; update({ detail: null, reference: null, detailStatus: 'idle', detailError: null }) },
    async logout() {
      if (state.signingOut) return
      const version = ++epoch
      update({ ...emptyData, user: null, auth: 'checking', signingOut: true, authError: null })
      try {
        await api.logout()
        if (version !== epoch) return
        update({ auth: 'guest', signingOut: false })
      } catch (error) {
        if (version !== epoch) return
        update({ auth: 'logout-error', signingOut: false, authError: messageError(error) })
      }
    },
  }
  return session
}
