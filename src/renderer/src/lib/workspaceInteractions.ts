export interface PublicItem {
  public_id?: string
  id?: string | number
}

export function extractHashTags(content: string): { content: string; tags: string[] } {
  const tags = Array.from(content.matchAll(/#([^\s#]+)/g), (match) => match[1])
  return {
    content,
    tags: Array.from(new Set(tags))
  }
}

export interface HighlightSegment {
  text: string
  isTag: boolean
}

export interface ComposerHighlightSegment {
  text: string
  type: 'plain' | 'tag' | 'project'
}

export function highlightHashTags(content: string): HighlightSegment[] {
  const segments: HighlightSegment[] = []
  let cursor = 0
  const tagPattern = /#([^\s#]+)/g
  let match = tagPattern.exec(content)
  while (match) {
    const index = match.index ?? cursor
    if (index > cursor) segments.push({ text: content.slice(cursor, index), isTag: false })
    segments.push({ text: match[0], isTag: true })
    cursor = index + match[0].length
    match = tagPattern.exec(content)
  }
  if (cursor < content.length) segments.push({ text: content.slice(cursor), isTag: false })
  if (segments.length === 0) segments.push({ text: '', isTag: false })
  return segments
}

export function highlightComposerReferences(content: string): ComposerHighlightSegment[] {
  const segments: ComposerHighlightSegment[] = []
  let cursor = 0
  const referencePattern = /(^|\s)(#[^\s#]+|@[^\s@]+)/g
  let match = referencePattern.exec(content)
  while (match) {
    const prefix = match[1] ?? ''
    const token = match[2] ?? ''
    const index = (match.index ?? cursor) + prefix.length
    if (index > cursor) segments.push({ text: content.slice(cursor, index), type: 'plain' })
    if (token) segments.push({ text: token, type: token.startsWith('#') ? 'tag' : 'project' })
    cursor = index + token.length
    match = referencePattern.exec(content)
  }
  if (cursor < content.length) segments.push({ text: content.slice(cursor), type: 'plain' })
  if (segments.length === 0) segments.push({ text: '', type: 'plain' })
  return segments
}

export interface ProjectMentionRange {
  start: number
  end: number
  query: string
}

export function findProjectMention(content: string, cursor: number): ProjectMentionRange | null {
  const safeCursor = Math.min(Math.max(cursor, 0), content.length)
  const atIndex = content.lastIndexOf('@', safeCursor - 1)
  if (atIndex < 0) return null
  if (atIndex > 0 && !/\s/.test(content[atIndex - 1])) return null
  const query = content.slice(atIndex + 1, safeCursor)
  if (/[\r\n]/.test(query)) return null
  return { start: atIndex, end: safeCursor, query }
}

export function findTagMention(content: string, cursor: number): ProjectMentionRange | null {
  const safeCursor = Math.min(Math.max(cursor, 0), content.length)
  const hashIndex = content.lastIndexOf('#', safeCursor - 1)
  if (hashIndex < 0) return null
  if (hashIndex > 0 && !/\s/.test(content[hashIndex - 1])) return null
  const query = content.slice(hashIndex + 1, safeCursor)
  if (/[\r\n]/.test(query)) return null
  return { start: hashIndex, end: safeCursor, query }
}

export function removeProjectMention(content: string, range: Pick<ProjectMentionRange, 'start' | 'end'>): { text: string; cursor: number } {
  const start = Math.min(Math.max(range.start, 0), content.length)
  const end = Math.min(Math.max(range.end, start), content.length)
  return { text: `${content.slice(0, start)}${content.slice(end)}`, cursor: start }
}

export interface InlineReference {
  start: number
  end: number
  type: 'tag' | 'project'
  value: string
}

export interface ProjectReferenceCandidate {
  public_id: string
  name: string
}

export interface ProjectReferenceMatch extends ProjectReferenceCandidate {
  start: number
  end: number
}

const PROJECT_REFERENCE_END = '(?=$|\\s|[，。；、,.!?！？:：;；\\]）)])'

export function findProjectReferences(content: string, projects: ProjectReferenceCandidate[]): ProjectReferenceMatch[] {
  const matches: ProjectReferenceMatch[] = []
  const candidates = [...projects]
    .map((project) => ({ ...project, name: project.name.trim() }))
    .filter((project) => project.name)
    .sort((left, right) => right.name.length - left.name.length)

  for (const project of candidates) {
    const escapedName = project.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(^|\\s)@${escapedName}${PROJECT_REFERENCE_END}`, 'g')
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content)) !== null) {
      const prefixLength = match[1]?.length ?? 0
      const start = match.index + prefixLength
      const end = start + project.name.length + 1
      if (!matches.some((item) => item.start === start && item.end === end)) {
        matches.push({ ...project, start, end })
      }
    }
  }

  return matches.sort((left, right) => left.start - right.start || right.end - left.end)
}

export function resolveProjectReference(content: string, projects: ProjectReferenceCandidate[]): string | null {
  return findProjectReferences(content, projects)[0]?.public_id ?? null
}

export function syncProjectReference(
  content: string,
  projects: ProjectReferenceCandidate[],
  projectPublicId: string | null
): string {
  const existing = findProjectReferences(content, projects)[0]
  const selected = projectPublicId ? projects.find((project) => project.public_id === projectPublicId) : null
  if (existing) {
    const replacement = selected ? `@${selected.name}` : ''
    return `${content.slice(0, existing.start)}${replacement}${content.slice(existing.end)}`
  }
  if (!selected) return content
  return `@${selected.name}\n${content}`
}

const INLINE_TAG_PATTERN = /(^|\s)(#[^\s#，。；、,.!?！？:：;；\]）)]+)/g
const INLINE_REFERENCE_BOUNDARY = /[A-Za-z0-9_@]/

function normalizeInlineTag(value: string): string {
  return value
    .replace(/^#/, '')
    .split('/')
    .map((segment) => segment.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('/')
    .toLocaleLowerCase()
}

export function findInlineReferences(content: string, projectName?: string): InlineReference[] {
  const references: InlineReference[] = []
  let tagMatch = INLINE_TAG_PATTERN.exec(content)
  while (tagMatch) {
    const raw = tagMatch[2]
    const start = (tagMatch.index ?? 0) + tagMatch[0].length - raw.length
    const value = normalizeInlineTag(raw)
    if (value) references.push({ start, end: start + raw.length, type: 'tag', value })
    tagMatch = INLINE_TAG_PATTERN.exec(content)
  }

  const normalizedProjectName = projectName?.trim()
  if (normalizedProjectName) {
    const marker = `@${normalizedProjectName}`
    let start = content.indexOf(marker)
    while (start >= 0) {
      const before = content[start - 1]
      const after = content[start + marker.length]
      const hasValidStart = start === 0 || !!before && /\s/.test(before)
      const hasValidEnd = !after || !INLINE_REFERENCE_BOUNDARY.test(after)
      if (hasValidStart && hasValidEnd) {
        references.push({ start, end: start + marker.length, type: 'project', value: normalizedProjectName })
      }
      start = content.indexOf(marker, start + marker.length)
    }
  }

  return references
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .filter((reference, index, all) => index === 0 || reference.start >= all[index - 1].end)
}

export function replaceProjectMention(
  content: string,
  range: Pick<ProjectMentionRange, 'start' | 'end'>,
  replacement: string
): { text: string; cursor: number } {
  const start = Math.min(Math.max(range.start, 0), content.length)
  const end = Math.min(Math.max(range.end, start), content.length)
  return {
    text: `${content.slice(0, start)}${replacement}${content.slice(end)}`,
    cursor: start + replacement.length
  }
}

export function createLatestRequestGate(): { next: () => number; isCurrent: (requestId: number) => boolean } {
  let currentRequestId = 0
  return {
    next: () => {
      currentRequestId += 1
      return currentRequestId
    },
    isCurrent: (requestId) => requestId === currentRequestId
  }
}

export function mergePage<T extends PublicItem>(existing: T[], incoming: T[], total: number): {
  items: T[]
  hasMore: boolean
} {
  const items = [...existing]
  const existingIds = new Set(existing.flatMap(getStableItemIds))
  for (const item of incoming) {
    const itemIds = getStableItemIds(item)
    if (!itemIds.some((id) => existingIds.has(id))) {
      itemIds.forEach((id) => existingIds.add(id))
      items.push(item)
    }
  }
  return { items, hasMore: items.length < total }
}

function getStableItemIds(item: PublicItem): string[] {
  const ids: string[] = []
  if (item.public_id) ids.push(`public:${item.public_id}`)
  if (item.id !== undefined && item.id !== null) ids.push(`id:${item.id}`)
  return ids
}

export interface RepositoryScanSummary {
  succeeded: number
  failed: number
  commits: number
  failures: Array<{ repository_id: string; name: string; error: string }>
}

export function summarizeRepositoryScan(
  results: Array<{ repository_id: string; status: string; inserted_count: number; error?: string }>,
  names: Map<string, string>
): RepositoryScanSummary {
  const failures = results
    .filter((result) => result.status === 'failed')
    .map((result) => ({
      repository_id: result.repository_id,
      name: names.get(result.repository_id) ?? result.repository_id,
      error: result.error ?? ''
    }))
  return {
    succeeded: results.filter((result) => result.status === 'succeeded').length,
    failed: failures.length,
    commits: results.reduce((total, result) => total + result.inserted_count, 0),
    failures
  }
}
