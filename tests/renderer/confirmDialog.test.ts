import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ConfirmDialog, createConfirmDialogController } from '../../src/renderer/src/components/ConfirmDialog'
import { OverlayStackProvider } from '../../src/renderer/src/components/OverlayStack'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('ConfirmDialog', () => {
  it('renders accessible dialog semantics and danger actions', () => {
    const html = renderToStaticMarkup(createElement(OverlayStackProvider, null, createElement(ConfirmDialog, {
      title: 'Delete task',
      message: 'This can be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
      onConfirm: () => undefined,
      onCancel: () => undefined
    })))

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-labelledby="confirm-dialog-title"')
    expect(html).toContain('ui-button--danger')
    expect(html).toContain('Delete task')
    expect(html).toContain('This can be undone.')
  })

  it('routes cancel, Escape, and backdrop dismissal through the same cancel behavior', async () => {
    const onCancel = vi.fn()
    const controller = createConfirmDialogController({ onConfirm: vi.fn(), onCancel })

    expect(await controller.cancel()).toBe(true)
    expect(await controller.keyDown('Escape')).toBe(true)
    expect(await controller.backdropPointerDown(true)).toBe(true)
    expect(await controller.backdropPointerDown(false)).toBe(false)
    expect(onCancel).toHaveBeenCalledTimes(3)
  })

  it('locks confirm and dismissal while an asynchronous confirmation is pending', async () => {
    const pending = deferred()
    const onConfirm = vi.fn(() => pending.promise)
    const onCancel = vi.fn()
    const controller = createConfirmDialogController({ onConfirm, onCancel })

    const first = controller.confirm()
    expect(controller.isPending()).toBe(true)

    await controller.confirm()
    expect(await controller.cancel()).toBe(false)
    expect(await controller.keyDown('Escape')).toBe(false)
    expect(await controller.backdropPointerDown(true)).toBe(false)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()

    pending.resolve()
    await first
    expect(controller.isPending()).toBe(false)
  })
})
