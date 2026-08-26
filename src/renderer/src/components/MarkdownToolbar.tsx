import { Bold, Code2, List, ListOrdered, Quote, Type } from 'lucide-react'
import type { RefObject } from 'react'
import { useI18n } from '../stores/languageStore'
import { applyMarkdownAction, type MarkdownAction } from '../lib/markdownToolbar'
import type { TranslationKey } from '../lib/i18n'

interface MarkdownToolbarProps {
  textareaRef: RefObject<HTMLTextAreaElement>
  value: string
  onChange: (value: string, cursor: number) => void
  className?: string
}

const ACTIONS: Array<{ action: MarkdownAction; labelKey: TranslationKey; Icon: typeof Type }> = [
  { action: 'title', labelKey: 'worklog.formatTitle', Icon: Type },
  { action: 'section', labelKey: 'worklog.formatSection', Icon: Type },
  { action: 'bold', labelKey: 'worklog.formatBold', Icon: Bold },
  { action: 'bullet', labelKey: 'worklog.insertBulletList', Icon: List },
  { action: 'ordered', labelKey: 'worklog.insertNumberedList', Icon: ListOrdered },
  { action: 'quote', labelKey: 'worklog.formatQuote', Icon: Quote },
  { action: 'code', labelKey: 'worklog.formatCode', Icon: Code2 }
]

export function MarkdownToolbar({ textareaRef, value, onChange, className = '' }: MarkdownToolbarProps): JSX.Element {
  const { t } = useI18n()

  const apply = (action: MarkdownAction): void => {
    const textarea = textareaRef.current
    const start = textarea?.selectionStart ?? value.length
    const end = textarea?.selectionEnd ?? start
    const result = applyMarkdownAction(value, start, end, action)
    onChange(result.value, result.selectionEnd)
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(result.selectionStart, result.selectionEnd)
    })
  }

  return (
    <div className={`markdown-toolbar ${className}`.trim()} role="toolbar" aria-label={t('worklog.formatToolbar')}>
      {ACTIONS.map(({ action, labelKey, Icon }) => (
        <button key={action} type="button" onClick={() => apply(action)} aria-label={t(labelKey)} title={t(labelKey)}>
          <Icon aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
