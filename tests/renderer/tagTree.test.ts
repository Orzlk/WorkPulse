import { describe, expect, it } from 'vitest'
import { buildTagTree } from '../../src/renderer/src/lib/tagTree'

describe('tag tree', () => {
  it('builds synthetic parent nodes and aggregates descendant usage', () => {
    expect(buildTagTree([
      { public_id: 'tag-1', name: '工作/三峡', path: '工作/三峡', parent_id: null, usage_count: 4 },
      { public_id: 'tag-2', name: '工作/研发', path: '工作/研发', parent_id: null, usage_count: 3 },
      { public_id: 'tag-3', name: '缺陷', path: '缺陷', parent_id: null, usage_count: 2 }
    ])).toEqual([
      {
        path: '工作',
        label: '工作',
        public_id: null,
        usage_count: 7,
        children: [
          { path: '工作/三峡', label: '三峡', public_id: 'tag-1', usage_count: 4, children: [] },
          { path: '工作/研发', label: '研发', public_id: 'tag-2', usage_count: 3, children: [] }
        ]
      },
      { path: '缺陷', label: '缺陷', public_id: 'tag-3', usage_count: 2, children: [] }
    ])
  })
})
