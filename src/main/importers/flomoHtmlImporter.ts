export interface FlomoMemo {
  createdAt: string
  content: string
  tagNames: string[]
  attachmentCount: number
  attachments: FlomoAttachmentReference[]
}

export interface FlomoAttachmentReference {
  source: string
  alt: string
  kind: 'image' | 'audio' | 'video'
}

export interface FlomoImportParseResult {
  memos: FlomoMemo[]
  attachmentCount: number
}

const FLOMO_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
const MEMO_OPEN_PATTERN = /<div\b[^>]*\bclass\s*=\s*(["'])([^"']*\bmemo\b[^"']*)\1[^>]*>/gi
const CLASS_OPEN_PATTERN = /<div\b[^>]*\bclass\s*=\s*(["'])([^"']*)\1[^>]*>/gi
const DIV_TOKEN_PATTERN = /<\/?div\b[^>]*>/gi

export function parseFlomoHtml(html: string): FlomoImportParseResult {
  const memoStarts = Array.from(html.matchAll(MEMO_OPEN_PATTERN), (match) => match.index ?? -1).filter((index) => index >= 0)
  const memos: FlomoMemo[] = []
  let attachmentCount = 0

  for (let index = 0; index < memoStarts.length; index++) {
    const start = memoStarts[index]
    const end = memoStarts[index + 1] ?? html.length
    const block = html.slice(start, end)
    const files = extractClassInner(block, 'files')
    const rawContent = extractClassInner(block, 'content')
    const contentAttachments = extractAttachments(rawContent ?? '')
    const fileAttachments = extractAttachments(files ?? '')
    const attachments = dedupeAttachments([...contentAttachments, ...fileAttachments])
    attachmentCount += attachments.length

    const time = extractClassInner(block, 'time')
    const createdAt = decodeHtmlEntities(time ?? '').trim()
    const markdownContent = toMarkdown(rawContent ?? '')
    const fileImages = fileAttachments
      .filter((attachment) => attachment.kind === 'image')
      .filter((attachment) => !contentAttachments.some((current) => current.kind === 'image' && current.source === attachment.source))
      .map((attachment) => `![${attachment.alt}](${attachment.source})`)
    const content = [markdownContent, ...fileImages].filter(Boolean).join('\n\n')
    if (!isValidFlomoTime(createdAt) || !content) continue

    const { content: body, tags } = extractTags(content)
    if (!body) continue

    memos.push({
      createdAt,
      content: body,
      tagNames: tags,
      attachmentCount: attachments.length,
      attachments
    })
  }

  return { memos, attachmentCount }
}

function extractClassInner(source: string, className: string): string | null {
  CLASS_OPEN_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CLASS_OPEN_PATTERN.exec(source)) !== null) {
    const classes = match[2].split(/\s+/)
    if (!classes.includes(className)) continue
    const closingIndex = findClosingDiv(source, match.index, CLASS_OPEN_PATTERN.lastIndex)
    if (closingIndex === -1) return null
    return source.slice(CLASS_OPEN_PATTERN.lastIndex, closingIndex)
  }
  return null
}

function findClosingDiv(source: string, openingStart: number, openingEnd: number): number {
  DIV_TOKEN_PATTERN.lastIndex = openingStart
  let depth = 0
  let token: RegExpExecArray | null
  while ((token = DIV_TOKEN_PATTERN.exec(source)) !== null) {
    const isClosing = /^<\/div\b/i.test(token[0])
    if (!isClosing && token.index < openingEnd) {
      depth = 1
      continue
    }
    if (isClosing) {
      depth--
      if (depth === 0) return token.index
    } else {
      depth++
    }
  }
  return -1
}

function extractAttachments(source: string): FlomoAttachmentReference[] {
  const attachments: FlomoAttachmentReference[] = []
  const pattern = /<(img|audio|video)\b([^>]*)>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    const rawSource = getAttribute(match[2], 'src')
    if (!rawSource) continue
    const attachmentSource = decodeHtmlEntities(rawSource).trim()
    if (!attachmentSource) continue
    const element = match[1].toLowerCase()
    const kind: FlomoAttachmentReference['kind'] = element === 'img'
      ? 'image'
      : element === 'audio'
        ? 'audio'
        : 'video'
    attachments.push({
      source: attachmentSource,
      alt: decodeHtmlEntities(getAttribute(match[2], 'alt') ?? '').trim(),
      kind
    })
  }
  return attachments
}

function dedupeAttachments(attachments: FlomoAttachmentReference[]): FlomoAttachmentReference[] {
  const seen = new Set<string>()
  return attachments.filter((attachment) => {
    const key = `${attachment.kind}:${attachment.source}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getAttribute(attributes: string, name: string): string | null {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attributes)
  if (quoted) return quoted[2]
  const unquoted = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i').exec(attributes)
  return unquoted?.[1] ?? null
}

function isValidFlomoTime(value: string): boolean {
  const match = FLOMO_TIME_PATTERN.exec(value)
  if (!match) return false
  const [, year, month, day, hour, minute, second] = match
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`)
  return !Number.isNaN(date.getTime()) &&
    date.getFullYear() === Number(year) &&
    date.getMonth() + 1 === Number(month) &&
    date.getDate() === Number(day) &&
    date.getHours() === Number(hour) &&
    date.getMinutes() === Number(minute) &&
    date.getSeconds() === Number(second)
}

function toMarkdown(html: string): string {
  const withoutUnsafe = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  const withLists = withoutUnsafe
    .replace(/<ol\b[^>]*>([\s\S]*?)<\/ol\s*>/gi, (_match, inner: string) => renderList(inner, true))
    .replace(/<ul\b[^>]*>([\s\S]*?)<\/ul\s*>/gi, (_match, inner: string) => renderList(inner, false))
  const withBlocks = withLists
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi, (_match, inner: string) => `${convertInlineHtml(inner)}\n\n`)
    .replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi, (_match, inner: string) => `**${convertInlineHtml(inner)}**\n\n`)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:div|section)\s*>/gi, '\n\n')
  const stripped = withBlocks
    .replace(/<[^>]+>/g, '')

  return decodeHtmlEntities(stripped)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function renderList(html: string, ordered: boolean): string {
  let index = 0
  const lines = html.replace(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi, (_match, inner: string) => {
    const content = convertInlineHtml(inner).replace(/\s*\n\s*/g, ' ').trim()
    if (!content) return ''
    index++
    return `${ordered ? `${index}.` : '-'} ${content}\n`
  })
  return `${lines.trim()}\n\n`
}

function convertInlineHtml(html: string): string {
  return html
    .replace(/<img\b([^>]*)>/gi, (_match, attributes: string) => renderImage(attributes))
    .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)\s*>/gi, '**$1**')
    .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)\s*>/gi, '*$1*')
    .replace(/<(?:del|s)\b[^>]*>([\s\S]*?)<\/(?:del|s)\s*>/gi, '~~$1~~')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?(?:p|span)\b[^>]*>/gi, '')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi, '$1')
}

function renderImage(attributes: string): string {
  const source = getAttribute(attributes, 'src')
  if (!source) return ''
  const alt = getAttribute(attributes, 'alt') ?? ''
  return `![${decodeHtmlEntities(alt)}](${decodeHtmlEntities(source)})`
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    const normalized = code.toLowerCase()
    if (normalized === 'amp') return '&'
    if (normalized === 'lt') return '<'
    if (normalized === 'gt') return '>'
    if (normalized === 'quot') return '"'
    if (normalized === 'apos') return "'"
    if (normalized === 'nbsp') return ' '
    const radix = normalized.startsWith('#x') ? 16 : 10
    const digits = normalized.startsWith('#x') ? normalized.slice(2) : normalized.slice(1)
    const value = Number.parseInt(digits, radix)
    return Number.isNaN(value) ? entity : String.fromCodePoint(value)
  })
}

function extractTags(content: string): { content: string; tags: string[] } {
  const tags: string[] = []
  for (const match of Array.from(content.matchAll(/(?:^|\s)#([^\s#]+)/g))) {
    const tag = cleanTag(match[1])
    if (tag && !tags.includes(tag)) tags.push(tag)
  }
  return { content: content.replace(/\n{3,}/g, '\n\n').trim(), tags }
}

function cleanTag(value: string): string {
  return value
    .replace(/[，。；、,.!?！？:：;；\]）)]+$/g, '')
    .trim()
    .replace(/^#/, '')
    .split('/')
    .map((segment) => segment.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('/')
}
