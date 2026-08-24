import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { TextareaHTMLAttributes, UIEvent } from 'react'
import { highlightHashTags } from '../lib/workspaceInteractions'

export const TagHighlightTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TagHighlightTextarea({ value, onScroll, className = '', ...props }, forwardedRef): JSX.Element {
    const highlightRef = useRef<HTMLDivElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const text = String(value ?? '')
    const segments = highlightHashTags(text)

    useEffect(() => {
      if (text.length === 0) {
        highlightRef.current?.scrollTo(0, 0)
        textareaRef.current?.scrollTo(0, 0)
      }
    }, [text])

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
            <span className={segment.isTag ? 'tag-composer-highlight-tag' : undefined} key={`${index}-${segment.text}`}>
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
