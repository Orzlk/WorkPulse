import { describe, expect, it } from 'vitest'
import { loadAllPages } from '../../src/renderer/src/lib/tagPaging'

describe('tag paging', () => {
  it('loads every page instead of truncating the tag picker at 200 items', async () => {
    const calls: number[] = []
    const items = Array.from({ length: 205 }, (_, index) => ({ public_id: String(index), path: `tag-${index}` }))
    const result = await loadAllPages(async ({ limit, offset }) => {
      calls.push(offset)
      return { items: items.slice(offset, offset + limit), total: items.length }
    })

    expect(result).toHaveLength(205)
    expect(calls).toEqual([0, 200])
  })
})
