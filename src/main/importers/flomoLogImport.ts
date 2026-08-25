import { readFileSync } from 'node:fs'
import { basename, extname, isAbsolute, resolve, sep } from 'node:path'

import {
  MAX_ATTACHMENT_BYTES,
  saveAttachment,
  type AttachmentInput,
  type SavedAttachment
} from '../attachments/attachmentStorage'
import type { FlomoMemo } from './flomoHtmlImporter'

export interface FlomoLogWriter {
  addWorkLog: (
    content: string,
    category?: string,
    taskId?: number | null,
    createdAt?: string,
    associations?: { tagNames?: string[] }
  ) => unknown
  workLogExists: (content: string, category: string, dateStr?: string) => boolean
  listWorkLogs?: () => FlomoLogRecord[]
}

export interface FlomoLogRecord {
  content: string
  category: string
  created_at: string
}

export interface FlomoLogImportSummary {
  imported: number
  skipped: number
  attachmentsImported: number
  attachmentsSkipped: number
}

export interface FlomoLogImportOptions {
  sourceRoot: string
  attachmentRoot: string
  saveAttachment?: (root: string, input: AttachmentInput) => SavedAttachment
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

export function importFlomoMemos(
  memos: FlomoMemo[],
  writer: FlomoLogWriter,
  options?: FlomoLogImportOptions
): FlomoLogImportSummary {
  let imported = 0
  let skipped = 0
  let attachmentsImported = 0
  let attachmentsSkipped = 0
  const existingLogs = options && writer.listWorkLogs ? writer.listWorkLogs() : []

  for (const memo of memos) {
    const isDuplicate = writer.workLogExists(memo.content, '', memo.createdAt) || existingLogs.some((log) => (
      log.category === '' &&
      log.created_at.slice(0, 10) === memo.createdAt.slice(0, 10) &&
      normalizeImageReferences(log.content) === normalizeImageReferences(memo.content)
    ))
    if (isDuplicate) {
      skipped++
      continue
    }

    const attachmentResult = options ? importAttachments(memo, options) : { content: memo.content, imported: 0, skipped: 0 }
    writer.addWorkLog(attachmentResult.content, '', null, memo.createdAt, { tagNames: memo.tagNames })
    imported++
    attachmentsImported += attachmentResult.imported
    attachmentsSkipped += attachmentResult.skipped
    existingLogs.push({ content: attachmentResult.content, category: '', created_at: memo.createdAt })
  }

  return { imported, skipped, attachmentsImported, attachmentsSkipped }
}

function importAttachments(
  memo: FlomoMemo,
  options: FlomoLogImportOptions
): { content: string; imported: number; skipped: number } {
  let content = memo.content
  let imported = 0
  let skipped = 0
  const save = options.saveAttachment ?? saveAttachment

  for (const attachment of memo.attachments ?? []) {
    if (attachment.kind !== 'image') {
      skipped++
      continue
    }

    const saved = copyImageAttachment(attachment.source, options, save)
    if (!saved) {
      skipped++
      continue
    }

    content = replaceImageReference(content, attachment.source, saved.url)
    imported++
  }

  return { content, imported, skipped }
}

function copyImageAttachment(
  source: string,
  options: FlomoLogImportOptions,
  save: (root: string, input: AttachmentInput) => SavedAttachment
): SavedAttachment | null {
  const sourcePath = resolveFlomoAttachmentPath(options.sourceRoot, source)
  if (!sourcePath) return null

  const extension = extname(sourcePath).toLowerCase()
  const mimeType = IMAGE_MIME_TYPES[extension]
  if (!mimeType) return null

  try {
    const data = readFileSync(sourcePath)
    if (data.byteLength === 0 || data.byteLength > MAX_ATTACHMENT_BYTES) return null
    return save(options.attachmentRoot, {
      fileName: basename(sourcePath),
      mimeType,
      data
    })
  } catch {
    return null
  }
}

function resolveFlomoAttachmentPath(sourceRoot: string, source: string): string | null {
  const pathPart = source.split(/[?#]/, 1)[0]
  if (!pathPart || pathPart.includes('\0') || isAbsolute(pathPart) || pathPart.startsWith('//') || pathPart.includes('://')) {
    return null
  }

  const rootPath = resolve(sourceRoot)
  const candidate = resolve(rootPath, pathPart)
  if (candidate === rootPath || !candidate.startsWith(`${rootPath}${sep}`)) return null
  return candidate
}

function replaceImageReference(content: string, source: string, url: string): string {
  const escapedSource = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return content.replace(new RegExp(`(!\\[[^\\]]*\\]\\()${escapedSource}(\\))`, 'g'), `$1${url}$2`)
}

function normalizeImageReferences(content: string): string {
  return content.replace(/!\[([^\]]*)\]\([^)]*\)/g, '![$1](<image>)')
}
