import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import type { TextareaHTMLAttributes, UIEvent } from 'react'
import { highlightComposerReferences } from '../lib/workspaceInteractions'

interface TagHighlightTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoGrow?: boolean
  autoGrowMinHeight?: number
  autoGrowMaxHeight?: number
}

export const TagHighlightTextarea = forwardRef<HTMLTextAreaElement, TagHighlightTextareaProps>(
  function TagHighlightTextarea({ value, onScroll, className = '', autoGrow = false, autoGrowMinHeight = 220, autoGrowMaxHeight = 560, ...props }, forwardedRef): JSX.Element {
    const highlightRef = useRef<HTMLDivElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const text = String(value ?? '')
    const segments = highlightComposerReferences(text)

    useEffect(() => {
      if (text.length === 0) {
        highlightRef.current?.scrollTo(0, 0)
        textareaRef.current?.scrollTo(0, 0)
      }
    }, [text])

    useLayoutEffect(() => {
      if (!autoGrow) return
      const textarea = textareaRef.current
      const wrapper = textarea?.parentElement
      if (!textarea || !wrapper) return

      wrapper.style.height = 'auto'
      textarea.style.height = 'auto'
      const contentHeight = Math.min(Math.max(textarea.scrollHeight, autoGrowMinHeight), autoGrowMaxHeight)
      wrapper.style.height = `${contentHeight}px`
      textarea.style.height = '100%'
      textarea.style.overflowY = 'auto'
    }, [autoGrow, autoGrowMaxHeight, autoGrowMinHeight, text])

    useImperativeHandle(forwardedRef, () => textareaRef.current as HTMLTextAreaElement, [])

    const setTextareaRef = (element: HTMLTextAreaElement | null): void => {
      textareaRef.current = element
    }

    const handleScroll = (event: UIEvent<HTMLTextAreaElement>): void => {
      if (highlightRef.current) {
        highlightRef.current.scrollTop = event.currentTarget.scrollTop
        highlightRef.current.scrollLeft = event.currentTarget.scrollLeft
      }
      onScroll?.(event)
    }

    return (
      <div className={`tag-composer ${className}`.trim()}>
        <div ref={highlightRef} className="tag-composer-highlight" aria-hidden="true">
          {segments.map((segment, index) => (
            <span className={segment.type === 'tag' ? 'tag-composer-highlight-tag' : segment.type === 'project' ? 'tag-composer-highlight-project' : undefined} key={`${index}-${segment.text}`}>
              {segment.text}
            </span>
          ))}
          {text.endsWith('\n') && <br />}
        </div>
        <textarea
          {...props}
          ref={setTextareaRef}
          value={value}
          onScroll={handleScroll}
          className="tag-composer-input"
        />
      </div>
    )
  }
)

TagHighlightTextarea.displayName = 'TagHighlightTextarea'
