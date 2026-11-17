import { useEffect, useRef } from 'react'

function Modal({ children, titleId, descriptionId, role = 'dialog', onClose, className = '', returnFocusSelector }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    const dialog = dialogRef.current
    const trigger = document.activeElement
    const parentDialog = dialog.parentElement?.closest('dialog')
    const previousOverflow = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'

    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus({ preventScroll: true })
      } else if (parentDialog?.open) {
        // Clearing the cart removes the confirmation trigger from the DOM.
        parentDialog.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
      } else if (returnFocusSelector) {
        document.querySelector(returnFocusSelector)?.focus({ preventScroll: true })
      }
    }
  }, [returnFocusSelector])

  return (
    <dialog
      className={`haru-modal ${className}`}
      ref={dialogRef}
      role={role}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={(event) => {
        // A nested confirmation owns its own keyboard and focus handling.
        if (event.target.closest('dialog') !== event.currentTarget) return
        if (event.key === 'Escape') {
          // Handle dismissal here so one Escape cannot cancel two native
          // dialogs when the confirmation unmounts during the key press.
          event.preventDefault()
          event.stopPropagation()
          onClose()
          return
        }
        if (event.key !== 'Tab') return
        const dialog = event.currentTarget
        const controls = [...dialog.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]',
        )].filter((element) => element.getClientRects().length > 0)
        const first = controls[0]
        const last = controls[controls.length - 1]

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
      onKeyUp={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      {children}
    </dialog>
  )
}

export default Modal
