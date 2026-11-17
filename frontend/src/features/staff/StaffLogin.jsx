function StaffLogin({ state, session }) {
  return (
    <section className="staff-login" aria-labelledby="staff-login-title">
      <p className="state-eyebrow">For the Haru team</p>
      <h2 id="staff-login-title">Welcome back.</h2>
      <p>Sign in to view orders received from the kiosk.</p>
      {state.authError && state.authError.status !== 401 ? <p className="staff-message" role="alert">{state.authError.message}</p> : null}
      {state.demo ? <button className="staff-button" disabled={state.signingIn} onClick={() => { void session.login('', '') }}>Open demo dashboard</button> : (
        <form onSubmit={event => {
          event.preventDefault()
          const form = event.currentTarget
          const data = new FormData(form)
          const email = String(data.get('email') || '').trim()
          const password = String(data.get('password') || '')
          form.elements.password.value = ''
          void session.login(email, password)
        }}>
          <label htmlFor="staff-email">Email address</label>
          <input id="staff-email" name="email" type="email" autoComplete="username" maxLength={255} required disabled={state.signingIn} />
          <label htmlFor="staff-password">Password</label>
          <input id="staff-password" name="password" type="password" autoComplete="current-password" maxLength={1024} required disabled={state.signingIn} />
          <button className="staff-button" disabled={state.signingIn} type="submit">{state.signingIn ? 'Signing in…' : 'Sign in'}</button>
        </form>
      )}
      <p className="staff-small">Staff access is granted by Haru. There is no public registration.</p>
    </section>
  )
}
export default StaffLogin
