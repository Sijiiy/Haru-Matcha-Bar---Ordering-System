import { useReducer } from 'react'
import { cartItemCount, cartReducer, cartSubtotal } from './cartState.js'

export function useCart() {
  const [lines, dispatch] = useReducer(cartReducer, [])

  return {
    lines,
    dispatch,
    itemCount: cartItemCount(lines),
    subtotal: cartSubtotal(lines),
  }
}
