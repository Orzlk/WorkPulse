import { describe, expect, it } from 'vitest'
import {
  createLatestRequestGate,
  extractHashTags,
  mergePage,
  summarizeRepositoryScan
} from '../../src/renderer/src/lib/workspaceInteractions'

describe('workspace interactions', () => {
  it('extracts unique hierarchical tags without changing the source draft', () => {
    expect(extractHashTags('修复导出 #客户端 #客户端/导出 #客户端')).toEqual({
      content: '修复导出 #客户端 #客户端/导出 #客户端',
      tags: ['客户端', '客户端/导出']
    })
  })

  it('prevents an older search request from becoming current', () => {
    const gate = createLatestRequestGate()
    const first = gate.next()
    const second = gate.next()

    expect(gate.isCurrent(first)).toBe(false)
    expect(gate.isCurrent(second)).toBe(true)
  })

  it('merges a page without duplicate public ids and reports whether another page exists', () => {
    const result = mergePage(
      [{ public_id: 'one' }, { public_id: 'two' }],
      [{ public_id: 'two' }, { public_id: 'three' }],
      4
    )

    expect(result.items.map((item) => item.public_id)).toEqual(['one', 'two', 'three'])
    expect(result.hasMore).toBe(true)
  })

  it('summarizes successful and failed repository scans for a retryable UI state', () => {
    expect(summarizeRepositoryScan([
      { repository_id: 'repo-1', status: 'succeeded', inserted_count: 3 },
      { repository_id: 'repo-2', status: 'failed', inserted_count: 0, error: 'bad path' },
      { repository_id: 'repo-3', status: 'skipped', inserted_count: 0 }
    ], new Map([['repo-2', 'Broken repo']]))).toEqual({
      succeeded: 1,
      failed: 1,
      commits: 3,
      failures: [{ repository_id: 'repo-2', name: 'Broken repo', error: 'bad path' }]
    })
  })
})
