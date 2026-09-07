import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { CheckCircle2, AlertCircle, X } from 'lucide-react'
import { useI18n } from '../stores/languageStore'

interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
  action?: { label: string; onClick: () => void }
  exiting?: boolean
}

interface ToastContextValue {
  success: (message: string) => void
  successWithAction: (message: string, actionLabel: string, onAction: () => void) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 0

export function ToastProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])
  const { t } = useI18n()

  const remove = useCallback((id: number) => {
    // Start exit animation
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t))
    // Remove after animation completes
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 250)
  }, [])

  const add = useCallback((message: string, type: 'success' | 'error', action?: Toast['action']) => {
    const id = nextId++
    setToasts((prev) => [...prev, { id, message, type, action }])
    setTimeout(() => remove(id), action ? 5000 : 2500)
  }, [remove])

  const success = useCallback((msg: string) => add(msg, 'success'), [add])
  const successWithAction = useCallback((msg: string, actionLabel: string, onAction: () => void) => add(msg, 'success', { label: actionLabel, onClick: onAction }), [add])
  const error = useCallback((msg: string) => add(msg, 'error'), [add])
  const value = useMemo<ToastContextValue>(() => ({ success, successWithAction, error }), [error, success, successWithAction])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast Container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={`toast-notification ${toast.exiting ? 'animate-toast-out' : 'animate-toast'} ${toast.type === 'success' ? 'toast-success' : 'toast-error'}`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="toast-icon toast-icon-success" />
            ) : (
              <AlertCircle className="toast-icon toast-icon-error" />
            )}
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => { toast.action?.onClick(); remove(toast.id) }}
                className="toast-action"
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => remove(toast.id)}
              className="toast-close"
              aria-label={t('workspace.closeToast')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
