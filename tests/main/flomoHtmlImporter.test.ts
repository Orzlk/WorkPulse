import { describe, expect, it } from 'vitest'

import { parseFlomoHtml } from '../../src/main/importers/flomoHtmlImporter'

describe('parseFlomoHtml', () => {
  it('parses memo time, removes a standalone tag line, and keeps tags', () => {
    const result = parseFlomoHtml(`
      <div class="memo">
        <div class="time">2026-08-19 09:45:51</div>
        <div class="content"><p>#工作/三峡 #设计</p><ol><li><p>方案 A</p></li><li><p>方案 B</p></li></ol></div>
        <div class="files"></div>
      </div>
    `)

    expect(result.memos).toEqual([{
      createdAt: '2026-08-19 09:45:51',
      content: '- 方案 A\n- 方案 B',
      tagNames: ['工作/三峡', '设计'],
      attachmentCount: 0
    }])
  })

  it('decodes entities, preserves inline hashtags, and counts attachments', () => {
    const result = parseFlomoHtml(`
      <div class="memo">
        <div class="time">2026-08-20 10:00:00</div>
        <div class="content"><p>需求 &amp; 验证 #保留</p><p><br>下一行</p></div>
        <div class="files"><img src="file/a.png"><img src="file/b.png"></div>
      </div>
    `)

    expect(result.memos[0]).toMatchObject({
      content: '需求 & 验证 #保留\n下一行',
      tagNames: ['保留'],
      attachmentCount: 2
    })
    expect(result.attachmentCount).toBe(2)
  })

  it('skips memo blocks without a valid time or content', () => {
    const result = parseFlomoHtml('<div class="memo"><div class="time">bad</div><div class="content"><p>x</p></div></div>')

    expect(result.memos).toEqual([])
  })
})
