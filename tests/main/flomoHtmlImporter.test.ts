import { describe, expect, it } from 'vitest'

import { parseFlomoHtml } from '../../src/main/importers/flomoHtmlImporter'

describe('parseFlomoHtml', () => {
  it('parses memo time, preserves a standalone tag line and ordered lists, and keeps tags', () => {
    const result = parseFlomoHtml(`
      <div class="memo">
        <div class="time">2026-08-19 09:45:51</div>
        <div class="content"><p>#工作/三峡 #设计</p><ol><li><p>方案 A</p></li><li><p>方案 B</p></li></ol></div>
        <div class="files"></div>
      </div>
    `)

    expect(result.memos).toEqual([{
      createdAt: '2026-08-19 09:45:51',
      content: '#工作/三峡 #设计\n\n1. 方案 A\n2. 方案 B',
      tagNames: ['工作/三峡', '设计'],
      attachmentCount: 0,
      attachments: []
    }])
  })

  it('converts Flomo inline emphasis and block paragraphs to Markdown', () => {
    const result = parseFlomoHtml(`
      <div class="memo">
        <div class="time">2026-08-20 10:00:00</div>
        <div class="content"><p>普通段落</p><p><strong>重点</strong> 和 <em>说明</em></p><ul><li>项目 A</li><li>项目 B</li></ul></div>
      </div>
    `)

    expect(result.memos[0]?.content).toBe('普通段落\n\n**重点** 和 *说明*\n\n- 项目 A\n- 项目 B')
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
      content: '需求 & 验证 #保留\n\n下一行\n\n![](file/a.png)\n\n![](file/b.png)',
      tagNames: ['保留'],
      attachmentCount: 2,
      attachments: [
        { source: 'file/a.png', alt: '', kind: 'image' },
        { source: 'file/b.png', alt: '', kind: 'image' }
      ]
    })
    expect(result.attachmentCount).toBe(2)
  })

  it('extracts image, audio and video references while preserving image Markdown placeholders', () => {
    const result = parseFlomoHtml(`
      <div class="memo">
        <div class="time">2026-08-20 10:00:00</div>
        <div class="content">
          <p>部署结果</p>
          <p><img src="files/ok.png" alt="部署截图"></p>
          <p><audio src="files/voice.mp3"></audio><video src="files/demo.mp4"></video></p>
        </div>
      </div>
    `)

    expect(result.memos[0]).toMatchObject({
      attachments: [
        { source: 'files/ok.png', alt: '部署截图', kind: 'image' },
        { source: 'files/voice.mp3', alt: '', kind: 'audio' },
        { source: 'files/demo.mp4', alt: '', kind: 'video' }
      ]
    })
    expect(result.memos[0]?.content).toContain('![部署截图](files/ok.png)')
    expect(result.attachmentCount).toBe(3)
  })

  it('skips memo blocks without a valid time or content', () => {
    const result = parseFlomoHtml('<div class="memo"><div class="time">bad</div><div class="content"><p>x</p></div></div>')

    expect(result.memos).toEqual([])
  })
})
