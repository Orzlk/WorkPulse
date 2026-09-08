export interface ShortcutWindow {
  isMinimized: () => boolean
  isVisible: () => boolean
  restore: () => void
  show: () => void
  focus: () => void
}

export function showWindowForShortcut(window: ShortcutWindow): void {
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
