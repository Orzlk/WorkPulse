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
