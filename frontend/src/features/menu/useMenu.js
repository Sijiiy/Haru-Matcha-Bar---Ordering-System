import { useCallback, useEffect, useState } from 'react'
import { getMenu } from './menuApi.js'

const initialState = {
  status: 'loading',
  categories: [],
  error: null,
}

export function useMenu() {
  const [requestKey, setRequestKey] = useState(0)
  const [state, setState] = useState(initialState)

  useEffect(() => {
    const controller = new AbortController()

    getMenu({ signal: controller.signal })
      .then((categories) => {
        setState({ status: 'success', categories, error: null })
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setState({ status: 'error', categories: [], error })
        }
      })

    return () => controller.abort()
  }, [requestKey])

  const retry = useCallback(() => {
    setState(initialState)
    setRequestKey((currentKey) => currentKey + 1)
  }, [])

  return { ...state, retry }
}
