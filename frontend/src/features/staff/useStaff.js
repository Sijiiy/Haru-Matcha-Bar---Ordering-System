import { useEffect, useState, useSyncExternalStore } from 'react'
import { createStaffClient } from './staffSource.js'
import { createStaffSession } from './staffSession.js'

export function useStaff() {
  const [session] = useState(() => createStaffSession(createStaffClient(import.meta.env)))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  useEffect(() => {
    void session.start()
    return () => session.cancel()
  }, [session])
  return { state, session }
}
