import { inflateRawSync } from 'node:zlib'
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'

import { IpcContractError } from '../ipcContracts'

export const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024

export interface AttachmentArchiveEntry {
  name: string
  data: Buffer
}

export function collectAttachmentNames(value: unknown): string[] {
  const names = new Set<string>()
  const visit = (current: unknown): void => {
    if (typeof current === 'string') {
      const candidates = current.match(/workpulse-attachment:\/\/attachment\/[^\s"'<>)\]]+/g) ?? []
      for (const candidate of candidates) {
        try {
          const url = new URL(candidate)
          if (url.protocol !== 'workpulse-attachment:' || url.hostname !== 'attachment') continue
          const name = decodeURIComponent(url.pathname.slice(1))
          if (!name || basename(name) !== name) continue
          names.add(name)
        } catch { /* Ignore non-URL text that happens to contain the scheme. */ }
      }
      return
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item)
      return
    }
    if (current && typeof current === 'object') {
      for (const item of Object.values(current)) visit(item)
    }
  }
  visit(value)
  return Array.from(names)
}

export function removeUnreferencedAttachments(root: string, referencedNames: Iterable<string>, graceMs = 24 * 60 * 60 * 1000, now = Date.now()): string[] {
  if (!existsSync(root)) return []
  const referenced = new Set(referencedNames)
  const removed: string[] = []
  for (const name of readdirSync(root)) {
    const path = join(root, name)
    try {
      const details = statSync(path)
      if (referenced.has(name) || !details.isFile() || now - details.mtimeMs < graceMs) continue
      unlinkSync(path)
      removed.push(name)
    } catch {
      // A concurrent or malformed directory entry must not prevent cleanup of other files.
    }
  }
  return removed
}

function validateEntryName(name: string): void {
  if (name === 'data.json') return
  if (!/^attachments\/[^/]+$/.test(name) || name.includes('..') || name.includes('\\')) throw new Error('Archive entry path is invalid')
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (let index = 0; index < data.length; index++) {
    crc ^= data[index]
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function archiveTooLarge(): IpcContractError {
  return new IpcContractError('IMPORT_TOO_LARGE', 'Archive is too large')
}

function ensureArchiveSize(size: number): void {
  if (size > MAX_ARCHIVE_BYTES) throw archiveTooLarge()
}

export function createAttachmentArchive(entries: AttachmentArchiveEntry[]): Buffer {
  const names = new Set<string>()
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  let archiveSize = 22
  for (const entry of entries) {
    validateEntryName(entry.name)
    if (names.has(entry.name)) throw new Error('Archive entry is duplicated')
    names.add(entry.name)
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.from(entry.data)
    if (name.length > 0xffff || data.length > 0xffffffff || names.size > 0xffff) throw archiveTooLarge()
    archiveSize += 30 + name.length + data.length + 46 + name.length
    ensureArchiveSize(archiveSize)
    const checksum = crc32(data)
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    localParts.push(local, data)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(0x08000000, 38)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centralParts.push(central)
    offset += local.length + data.length
  }
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(names.size, 8)
  end.writeUInt16LE(names.size, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  const archive = Buffer.concat([...localParts, centralDirectory, end], archiveSize)
  return archive
}

export function readAttachmentArchive(archive: Buffer): AttachmentArchiveEntry[] {
  ensureArchiveSize(archive.length)
  const minimumOffset = Math.max(0, archive.length - 22 - 0xffff)
  let endOffset = -1
  for (let offset = archive.length - 22; offset >= minimumOffset; offset--) {
    if (archive.readUInt32LE(offset) === 0x06054b50) { endOffset = offset; break }
  }
  if (endOffset < 0) throw new Error('Invalid archive')
  if (endOffset + 22 + archive.readUInt16LE(endOffset + 20) !== archive.length) throw new Error('Invalid archive')
  if (archive.readUInt16LE(endOffset + 4) !== 0 || archive.readUInt16LE(endOffset + 6) !== 0) throw new Error('Invalid archive')
  if (archive.readUInt16LE(endOffset + 8) !== archive.readUInt16LE(endOffset + 10)) throw new Error('Invalid archive')
  const count = archive.readUInt16LE(endOffset + 10)
  const centralSize = archive.readUInt32LE(endOffset + 12)
  const centralOffset = archive.readUInt32LE(endOffset + 16)
  if (centralOffset + centralSize !== endOffset) throw new Error('Invalid archive')
  const entries: AttachmentArchiveEntry[] = []
  const names = new Set<string>()
  let totalUncompressedSize = 0
  let cursor = centralOffset
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > centralOffset + centralSize || archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid archive entry')
    const flags = archive.readUInt16LE(cursor + 8)
    const method = archive.readUInt16LE(cursor + 10)
    const checksum = archive.readUInt32LE(cursor + 16)
    const compressedSize = archive.readUInt32LE(cursor + 20)
    const uncompressedSize = archive.readUInt32LE(cursor + 24)
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    const localOffset = archive.readUInt32LE(cursor + 42)
    const nextCursor = cursor + 46 + nameLength + extraLength + commentLength
    if (nextCursor > centralOffset + centralSize || (flags & ~0x0800) !== 0 || (method !== 0 && method !== 8)) throw new Error('Invalid archive entry')
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    validateEntryName(name)
    if (names.has(name)) throw new Error('Archive entry is duplicated')
    names.add(name)
    const remaining = MAX_ARCHIVE_BYTES - totalUncompressedSize
    if (uncompressedSize > remaining) throw archiveTooLarge()
    if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid archive entry')
    const localNameLength = archive.readUInt16LE(localOffset + 26)
    const localExtraLength = archive.readUInt16LE(localOffset + 28)
    const localFlags = archive.readUInt16LE(localOffset + 6)
    const localMethod = archive.readUInt16LE(localOffset + 8)
    if (localFlags !== flags || localMethod !== method || localOffset + 30 + localNameLength + localExtraLength > archive.length) throw new Error('Invalid archive entry')
    const localName = archive.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8')
    if (localName !== name || archive.readUInt32LE(localOffset + 14) !== checksum || archive.readUInt32LE(localOffset + 18) !== compressedSize || archive.readUInt32LE(localOffset + 22) !== uncompressedSize) throw new Error('Invalid archive entry')
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > archive.length) throw new Error('Invalid archive entry')
    const compressed = archive.subarray(dataStart, dataEnd)
    let data: Buffer
    if (method === 0) {
      data = Buffer.from(compressed)
    } else {
      try {
        data = inflateRawSync(compressed, { maxOutputLength: remaining })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw archiveTooLarge()
        throw new Error('Invalid archive entry')
      }
    }
    if (data.length > remaining) throw archiveTooLarge()
    if (data.length !== uncompressedSize || crc32(data) !== checksum) throw new Error('Archive entry checksum failed')
    totalUncompressedSize += data.length
    entries.push({ name, data })
    cursor = nextCursor
  }
  if (cursor !== centralOffset + centralSize) throw new Error('Invalid archive')
  if (!entries.some((entry) => entry.name === 'data.json')) throw new Error('Archive data is missing')
  return entries
}
