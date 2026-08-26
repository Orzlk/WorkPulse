export type MarkdownAction = 'title' | 'section' | 'bold' | 'bullet' | 'ordered' | 'quote' | 'code'

export interface MarkdownActionResult {
  value: string
  selectionStart: number
  selectionEnd: number
}

function linePrefix(value: string, start: number, end: number, prefix: string): MarkdownActionResult {
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const selectedEnd = Math.max(start, end)
  const lineEndIndex = value.indexOf('\n', selectedEnd)
  const blockEnd = lineEndIndex === -1 ? value.length : lineEndIndex
  const block = value.slice(lineStart, blockEnd)
  const nextBlock = block.split('\n').map((line) => line.startsWith(prefix) ? line : `${prefix}${line}`).join('\n')
  const nextValue = `${value.slice(0, lineStart)}${nextBlock}${value.slice(blockEnd)}`
  const delta = nextBlock.length - block.length
  return { value: nextValue, selectionStart: start + prefix.length, selectionEnd: end + delta }
}

export function applyMarkdownAction(value: string, start: number, end: number, action: MarkdownAction): MarkdownActionResult {
  const safeStart = Math.max(0, Math.min(start, value.length))
  const safeEnd = Math.max(safeStart, Math.min(end, value.length))

  if (action === 'title') return linePrefix(value, safeStart, safeEnd, '# ')
  if (action === 'section') return linePrefix(value, safeStart, safeEnd, '## ')
  if (action === 'bullet') return linePrefix(value, safeStart, safeEnd, '- ')
  if (action === 'ordered') return linePrefix(value, safeStart, safeEnd, '1. ')
  if (action === 'quote') return linePrefix(value, safeStart, safeEnd, '> ')

  const [prefix, suffix, placeholder] = action === 'bold'
    ? ['**', '**', '加粗文字']
    : ['`', '`', '代码']
  const selected = value.slice(safeStart, safeEnd) || placeholder
  const nextValue = `${value.slice(0, safeStart)}${prefix}${selected}${suffix}${value.slice(safeEnd)}`
  const selectionStart = safeStart + prefix.length
  return { value: nextValue, selectionStart, selectionEnd: selectionStart + selected.length }
}
