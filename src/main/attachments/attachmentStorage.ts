import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, extname, resolve, sep } from 'node:path'

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

export interface AttachmentInput {
  fileName: string
  mimeType: string
  data: ArrayBuffer | Uint8Array
}

export interface SavedAttachment {
  id: string
  fileName: string
  mimeType: string
  size: number
  url: string
}

function extensionFor(input: AttachmentInput): string {
  const extension = extname(basename(input.fileName)).toLowerCase().replace(/[^a-z0-9.]/g, '')
  if (extension) return extension.slice(0, 12)
  const mimeExtension = input.mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return mimeExtension ? `.${mimeExtension.slice(0, 10)}` : '.bin'
}

function toBuffer(data: AttachmentInput['data']): Buffer {
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data))
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  throw new Error('Attachment data is invalid')
}

export function saveAttachment(root: string, input: AttachmentInput): SavedAttachment {
  if (!input.mimeType.startsWith('image/')) throw new Error('Only image attachments are supported')
  const data = toBuffer(input.data)
  if (data.byteLength === 0 || data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('Attachment size is invalid')
  mkdirSync(root, { recursive: true })
  const id = randomUUID()
  const storedName = `${id}${extensionFor(input)}`
  writeFileSync(resolve(root, storedName), data, { flag: 'wx' })
  const fileName = basename(input.fileName).replace(/[\r\n]/g, '').slice(0, 200) || 'image'
  return {
    id,
    fileName,
    mimeType: input.mimeType,
    size: data.byteLength,
    url: `workpulse-attachment://attachment/${encodeURIComponent(storedName)}`
  }
}

export function resolveAttachmentPath(root: string, requestUrl: string): string | null {
  let fileName = ''
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== 'workpulse-attachment:' || url.hostname !== 'attachment') return null
    fileName = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  } catch {
    return null
  }
  if (!fileName || basename(fileName) !== fileName) return null
  const rootPath = resolve(root)
  const candidate = resolve(rootPath, fileName)
  if (candidate !== rootPath && !candidate.startsWith(`${rootPath}${sep}`)) return null
  return existsSync(candidate) ? candidate : null
}

export function clearAttachments(root: string): void {
  rmSync(root, { recursive: true, force: true })
}
