export interface TagPage<T> {
  items: T[]
  total: number
}

export interface TagPageRequest {
  limit: number
  offset: number
}

export async function loadAllPages<T>(load: (request: TagPageRequest) => Promise<TagPage<T>>, pageSize = 200): Promise<T[]> {
  const items: T[] = []
  let offset = 0
  do {
    const page = await load({ limit: pageSize, offset })
    items.push(...page.items)
    offset += page.items.length
    if (page.items.length === 0 || offset >= page.total) break
  } while (true)
  return items
}
