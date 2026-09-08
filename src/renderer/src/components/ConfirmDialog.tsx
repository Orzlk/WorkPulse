import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayStack } from './OverlayStack'

export interface ConfirmDialogProps {
  title: string
  message: ReactNode
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void | Promise<void>
}

interface ConfirmDialogControllerOptions {
  onConfirm: () => void | Promise<void>
  onCancel: () => void | Promise<void>
  onPendingChange?: (pending: boolean) => void
}

export interface ConfirmDialogController {
  isPending: () => boolean
  confirm: () => Promise<boolean>
  cancel: () => Promise<boolean>
  keyDown: (key: string) => Promise<boolean>
  backdropPointerDown: (isBackdrop: boolean) => Promise<boolean>
}

export function createConfirmDialogController({ onConfirm, onCancel, onPendingChange }: ConfirmDialogControllerOptions): ConfirmDialogController {
  let pending = false

  const cancel = async (): Promise<boolean> => {
    if (pending) return false
    await onCancel()
    return true
  }

  return {
    isPending: () => pending,
    confirm: async () => {
      if (pending) return false
      pending = true
      onPendingChange?.(true)
      try {
        await onConfirm()
        return true
      } finally {
        pending = false
        onPendingChange?.(false)
      }
    },
    cancel,
    keyDown: async (key) => key === 'Escape' ? cancel() : false,
    backdropPointerDown: async (isBackdrop) => isBackdrop ? cancel() : false
  }
}

export function ConfirmDialog({ title, message, confirmLabel, cancelLabel, danger = false, onConfirm, onCancel }: ConfirmDialogProps): JSX.Element {
  const [pending, setPending] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const callbacksRef = useRef({ onConfirm, onCancel })
  const controllerRef = useRef<ConfirmDialogController | null>(null)
  const overlayStack = useOverlayStack()

  callbacksRef.current = { onConfirm, onCancel }
  if (!controllerRef.current) {
    controllerRef.current = createConfirmDialogController({
      onConfirm: () => callbacksRef.current.onConfirm(),
      onCancel: () => callbacksRef.current.onCancel(),
      onPendingChange: setPending
    })
  }
  const controller = controllerRef.current

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelButtonRef.current?.focus()
    return () => {
      if (previousFocusRef.current && document.contains(previousFocusRef.current)) previousFocusRef.current.focus()
    }
  }, [])

  useEffect(() => overlayStack.register({
    id: 'confirm-dialog',
    priority: 300,
    requestClose: () => controller.cancel()
  }), [controller, overlayStack])

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])
    if (focusable.length === 0) return
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement)
    if ((!event.shiftKey && currentIndex === focusable.length - 1) || (event.shiftKey && currentIndex <= 0)) {
      event.preventDefault()
      focusable[event.shiftKey ? focusable.length - 1 : 0].focus()
    }
  }

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    void controller.backdropPointerDown(event.target === event.currentTarget)
  }

  const content = (
    <div className="hallmark-app portal-root ui-modal-overlay" role="presentation" onMouseDown={handleBackdropMouseDown}>
      <div ref={dialogRef} className="ui-modal ui-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message" tabIndex={-1} onKeyDown={handleDialogKeyDown} onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="confirm-dialog-title">{title}</h2>
        <div id="confirm-dialog-message" className="ui-confirm-dialog__message">{message}</div>
        <div className="ui-confirm-dialog__actions">
          <button ref={cancelButtonRef} type="button" className="ui-button ui-button--ghost" disabled={pending} onClick={() => void controller.cancel()}>{cancelLabel}</button>
          <button type="button" className={`ui-button ${danger ? 'ui-button--danger' : 'ui-button--primary'}`} disabled={pending} aria-busy={pending} onClick={() => void controller.confirm()}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}
