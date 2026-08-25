import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { resolveAttachmentPath, saveAttachment } from '../../src/main/attachments/attachmentStorage'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('attachment storage', () => {
  it('stores an image below the attachment root and returns a safe app URL', () => {
    const root = mkdtempSync(join(tmpdir(), 'workpulse-attachments-'))
    directories.push(root)
    const saved = saveAttachment(root, {
      fileName: '../diagram.png',
      mimeType: 'image/png',
      data: new Uint8Array([1, 2, 3, 4])
    })

    expect(saved.url).toMatch(/^workpulse-attachment:\/\/attachment\//)
    const path = resolveAttachmentPath(root, saved.url)
    expect(path).not.toBeNull()
    expect(readFileSync(path!)).toEqual(Buffer.from([1, 2, 3, 4]))
  })

  it('does not resolve traversal paths from the attachment protocol', () => {
    const root = mkdtempSync(join(tmpdir(), 'workpulse-attachments-'))
    directories.push(root)

    expect(resolveAttachmentPath(root, 'workpulse-attachment://attachment/..%2Foutside.png')).toBeNull()
    expect(resolveAttachmentPath(root, 'workpulse-attachment://attachment/%2E%2E%2Foutside.png')).toBeNull()
  })
})
