import { describe, expect, it } from 'vitest'
import {
  createLatestRequestGate,
  extractHashTags,
  mergePage
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
})
