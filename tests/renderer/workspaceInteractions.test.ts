import { describe, expect, it } from 'vitest'
import {
  createLatestRequestGate,
  extractHashTags,
  findTagMention,
  findInlineReferences,
  findProjectMention,
  highlightHashTags,
  mergePage,
  removeProjectMention,
  replaceProjectMention,
  summarizeRepositoryScan
} from '../../src/renderer/src/lib/workspaceInteractions'

describe('workspace interactions', () => {
  it('extracts unique hierarchical tags without changing the source draft', () => {
    expect(extractHashTags('修复导出 #客户端 #客户端/导出 #客户端')).toEqual({
      content: '修复导出 #客户端 #客户端/导出 #客户端',
      tags: ['客户端', '客户端/导出']
    })
  })

  it('splits hash tags into safe highlight segments without changing the source text', () => {
    expect(highlightHashTags('记录 #工作/项目 完成')).toEqual([
      { text: '记录 ', isTag: false },
      { text: '#工作/项目', isTag: true },
      { text: ' 完成', isTag: false }
    ])
  })

  it('finds a project mention only after whitespace and keeps the current query', () => {
    expect(findProjectMention('完成接口 @三峡', 8)).toEqual({ start: 5, end: 8, query: '三峡' })
    expect(findProjectMention('mail@example.com', 16)).toBeNull()
    expect(findProjectMention('路径foo@bar', 10)).toBeNull()
  })

  it('finds a tag mention only after whitespace and keeps hierarchical queries', () => {
    expect(findTagMention('完成 #工作/三峡', 9)).toEqual({ start: 3, end: 9, query: '工作/三峡' })
    expect(findTagMention('标题#不是标签', 7)).toBeNull()
  })

  it('removes only the selected project mention and returns the new caret position', () => {
    expect(removeProjectMention('完成接口 @三峡，继续处理', { start: 5, end: 8 })).toEqual({
      text: '完成接口 ，继续处理',
      cursor: 5
    })
  })

  it('finds clickable tags and an exact associated project without matching email addresses', () => {
    expect(findInlineReferences('完成 #工作/三峡，联系 @三峡平台。mail@example.com', '三峡平台')).toEqual([
      { start: 3, end: 9, type: 'tag', value: '工作/三峡' },
      { start: 13, end: 18, type: 'project', value: '三峡平台' }
    ])
  })

  it('replaces the selected project mention and keeps it in the saved正文', () => {
    expect(replaceProjectMention('处理 @san', { start: 3, end: 7 }, '@三峡平台')).toEqual({
      text: '处理 @三峡平台',
      cursor: 8
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
