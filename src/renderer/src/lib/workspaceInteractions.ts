export interface PublicItem {
  public_id: string
}

export function extractHashTags(content: string): { content: string; tags: string[] } {
  const tags = Array.from(content.matchAll(/#([^\s#]+)/g), (match) => match[1])
  return {
    content,
    tags: Array.from(new Set(tags))
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
  const existingIds = new Set(existing.map((item) => item.public_id))
  for (const item of incoming) {
    if (!existingIds.has(item.public_id)) {
      existingIds.add(item.public_id)
      items.push(item)
    }
  }
  return { items, hasMore: items.length < total }
}
