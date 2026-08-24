export interface TextareaCaretPosition {
  left: number
  top: number
  height: number
}

export interface MentionMenuPosition {
  left: number
  top: number
}

const MIRROR_STYLE_PROPERTIES = [
  'boxSizing',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textIndent',
  'textTransform',
  'wordSpacing',
  'tabSize'
] as const

export function getTextareaCaretPosition(textarea: HTMLTextAreaElement, cursor = textarea.selectionStart): TextareaCaretPosition {
  const safeCursor = Math.min(Math.max(cursor, 0), textarea.value.length)
  const style = window.getComputedStyle(textarea)
  const textareaRect = textarea.getBoundingClientRect()
  const mirror = document.createElement('div')
  const marker = document.createElement('span')

  mirror.style.position = 'fixed'
  mirror.style.top = `${textareaRect.top}px`
  mirror.style.left = `${textareaRect.left}px`
  mirror.style.width = `${textareaRect.width}px`
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.wordBreak = style.wordBreak
  mirror.style.overflow = 'visible'

  for (const property of MIRROR_STYLE_PROPERTIES) {
    mirror.style[property] = style[property]
  }

  mirror.textContent = textarea.value.slice(0, safeCursor)
  marker.textContent = textarea.value.slice(safeCursor, safeCursor + 1) || '\u200b'
  marker.style.display = 'inline-block'
  marker.style.width = '0'
  marker.style.padding = '0'
  marker.style.border = '0'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const markerRect = marker.getBoundingClientRect()
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2 || 20
  const position = {
    left: markerRect.left - textarea.scrollLeft,
    top: markerRect.top - textarea.scrollTop,
    height: lineHeight
  }
  mirror.remove()
  return position
}

export function getMentionMenuPosition(
  caret: TextareaCaretPosition,
  container: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  menu: { width: number; height: number }
): MentionMenuPosition {
  const padding = 12
  const menuWidth = Math.max(menu.width, 1)
  const menuHeight = Math.max(menu.height, 1)
  const maxLeft = Math.max(padding, container.width - menuWidth - padding)
  const left = Math.min(Math.max(padding, caret.left - container.left), maxLeft)
  const belowTop = caret.top - container.top + caret.height + 6
  const maxTop = Math.max(padding, container.height - menuHeight - padding)
  const top = belowTop <= maxTop
    ? belowTop
    : Math.max(padding, caret.top - container.top - menuHeight - 6)

  return { left, top }
}
