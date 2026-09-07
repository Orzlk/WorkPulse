import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'

export interface OverlayRegistration {
  id: string
  priority: number
  dirty?: boolean
  requestClose: () => void | boolean | Promise<void | boolean>
}

export interface OverlayStackApi {
  register: (overlay: OverlayRegistration) => () => void
  unregister: (id: string) => void
  closeTopOverlay: () => boolean
}

export function createOverlayStack(): OverlayStackApi {
  const overlays = new Map<string, OverlayRegistration & { order: number }>()
  let order = 0
  const top = (): (OverlayRegistration & { order: number }) | undefined => {
    let current: (OverlayRegistration & { order: number }) | undefined
    overlays.forEach((entry) => {
      if (!current || entry.priority > current.priority || (entry.priority === current.priority && entry.order > current.order)) {
        current = entry
      }
    })
    return current
  }

  return {
    register: (overlay) => {
      overlays.set(overlay.id, { ...overlay, order: order++ })
      return () => overlays.delete(overlay.id)
    },
    unregister: (id) => { overlays.delete(id) },
    closeTopOverlay: () => {
      const overlay = top()
      if (!overlay) return false
      const result = overlay.requestClose()
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        void (result as Promise<void | boolean>).then((closed) => {
          if (closed !== false && overlays.get(overlay.id)?.order === overlay.order) overlays.delete(overlay.id)
        })
      } else if (result !== false && overlays.get(overlay.id)?.order === overlay.order) {
        overlays.delete(overlay.id)
      }
      return true
    }
  }
}

const OverlayStackContext = createContext<OverlayStackApi | null>(null)

export function OverlayStackProvider({ children }: { children: ReactNode }): JSX.Element {
  const stackRef = useRef<OverlayStackApi | null>(null)
  if (!stackRef.current) stackRef.current = createOverlayStack()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (!stackRef.current?.closeTopOverlay()) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  return <OverlayStackContext.Provider value={stackRef.current}>{children}</OverlayStackContext.Provider>
}

export function useOverlayStack(): OverlayStackApi {
  const value = useContext(OverlayStackContext)
  if (!value) throw new Error('useOverlayStack must be used inside OverlayStackProvider')
  return value
}
