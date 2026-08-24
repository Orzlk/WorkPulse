export interface FlomoMemo {
  createdAt: string
  content: string
  tagNames: string[]
  attachmentCount: number
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
    const memoAttachmentCount = countAttachments(files ?? '')
    attachmentCount += memoAttachmentCount

    const time = extractClassInner(block, 'time')
    const rawContent = extractClassInner(block, 'content')
    const createdAt = decodeHtmlEntities(time ?? '').trim()
    const content = toPlainText(rawContent ?? '')
    if (!isValidFlomoTime(createdAt) || !content) continue

    const { content: body, tags } = extractTags(content)
    if (!body) continue

    memos.push({
      createdAt,
      content: body,
      tagNames: tags,
      attachmentCount: memoAttachmentCount
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

function countAttachments(files: string): number {
  return (files.match(/<(?:img|audio|video)\b/gi) ?? []).length
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

function toPlainText(html: string): string {
  const withoutUnsafe = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  const withLineBreaks = withoutUnsafe
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(?:li|p|div|ol|ul|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')

  return decodeHtmlEntities(withLineBreaks)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
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

  const lines = content.split('\n')
  const firstContentLine = lines.findIndex((line) => line.trim())
  if (firstContentLine >= 0 && isStandaloneTagLine(lines[firstContentLine])) {
    lines.splice(firstContentLine, 1)
  }

  return { content: lines.join('\n').replace(/\n{2,}/g, '\n').trim(), tags }
}

function isStandaloneTagLine(line: string): boolean {
  return line.trim().split(/\s+/).every((token) => /^#[^\s#]+$/.test(token))
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
