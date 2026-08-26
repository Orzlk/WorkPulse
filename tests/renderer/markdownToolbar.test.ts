import { describe, expect, it } from 'vitest'
import { applyMarkdownAction } from '../../src/renderer/src/lib/markdownToolbar'

describe('Markdown 工具栏', () => {
  it('wraps the selected text with bold markers', () => {
    expect(applyMarkdownAction('完成联调', 0, 4, 'bold')).toEqual({
      value: '**完成联调**',
      selectionStart: 2,
      selectionEnd: 6
    })
  })

  it('inserts a heading prefix at the current line', () => {
    expect(applyMarkdownAction('本周进展', 2, 2, 'section')).toEqual({
      value: '## 本周进展',
      selectionStart: 5,
      selectionEnd: 5
    })
  })

  it('supports list, quote, inline code, and title actions', () => {
    expect(applyMarkdownAction('事项', 0, 2, 'bullet').value).toBe('- 事项')
    expect(applyMarkdownAction('事项', 0, 2, 'ordered').value).toBe('1. 事项')
    expect(applyMarkdownAction('事项', 0, 2, 'quote').value).toBe('> 事项')
    expect(applyMarkdownAction('事项', 0, 2, 'code').value).toBe('`事项`')
    expect(applyMarkdownAction('事项', 0, 2, 'title').value).toBe('# 事项')
  })
})
