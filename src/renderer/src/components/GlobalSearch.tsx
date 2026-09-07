import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock3, Search, X } from 'lucide-react'
import { createLatestRequestGate } from '../lib/workspaceInteractions'
import { useI18n } from '../stores/languageStore'
import type { SearchResult } from '../lib/workspaceTypes'
import { getNextSearchIndex } from '../lib/searchNavigation'
import { useOverlayStack } from './OverlayStack'

interface Props {
  onOpenResult: (result: SearchResult) => void
  onClose?: () => void
}

const PAGE_SIZE = 12

export function GlobalSearch({ onOpenResult, onClose }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<SearchResult[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle')
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const gate = useMemo(createLatestRequestGate, [])
  const controllerRef = useRef<AbortController | null>(null)
  const { t, resolvedLanguage } = useI18n()
  const overlayStack = useOverlayStack()

  useEffect(() => overlayStack.register({ id: 'global-search', priority: 20, requestClose: () => onClose?.() }), [onClose, overlayStack])

  const runSearch = (text: string, offset: number, append: boolean): void => {
    controllerRef.current?.abort()
    const requestId = gate.next()
    const controller = new AbortController()
    controllerRef.current = controller
    setStatus('running')
    void window.api.search.query({ text, limit: PAGE_SIZE, offset })
      .then((page) => {
        if (controller.signal.aborted || !gate.isCurrent(requestId)) return
        setItems((current) => append ? [...current, ...page.items] : page.items)
        setTotal(page.total)
        setStatus('idle')
      })
      .catch(() => {
        if (!controller.signal.aborted && gate.isCurrent(requestId)) setStatus('error')
      })
  }

  useEffect(() => {
    const text = query.trim()
    setActiveIndex(null)
    controllerRef.current?.abort()
    if (!text) {
      setItems([])
      setTotal(0)
      setStatus('idle')
      return
    }
    const timer = window.setTimeout(() => runSearch(text, 0, false), 280)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (activeIndex !== null && activeIndex >= items.length) setActiveIndex(null)
  }, [activeIndex, items.length])

  const sourceLabel = (source: SearchResult['source']): string => {
    const key = {
      inbox: 'workspace.sourceInbox',
      work_log: 'workspace.sourceLog',
      task: 'workspace.sourceTask',
      git_commit: 'workspace.sourceCommit',
      report: 'workspace.sourceReport'
    }[source] as Parameters<typeof t>[0]
    return t(key)
  }

  const formatTime = (value: string): string => new Date(value).toLocaleDateString(resolvedLanguage === 'zh' ? 'zh-CN' : 'en-US')

  return (
    <div className="global-search">
      <label className="sr-only" htmlFor="global-search-input">{t('workspace.searchLabel')}</label>
      <Search aria-hidden="true" className="global-search-icon" />
      <input
        id="global-search-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('workspace.searchPlaceholder')}
        className="global-search-input"
        autoComplete="off"
        aria-expanded={Boolean(query)}
        aria-controls="global-search-results"
        aria-activedescendant={activeIndex === null ? undefined : `global-search-result-${activeIndex}`}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex((current) => getNextSearchIndex(current, items.length, event.key === 'ArrowDown' ? 1 : -1))
          } else if (event.key === 'Enter' && activeIndex !== null && items[activeIndex]) {
            event.preventDefault()
            onOpenResult(items[activeIndex])
          }
        }}
      />
      {query && <button className="global-search-clear" onClick={() => setQuery('')} aria-label={t('workspace.clearSearch')}><X aria-hidden="true" /></button>}
      {query && <>
        <div className="global-search-status" role="status" aria-live="polite">
          {status === 'running' && t('workspace.searching')}
          {status === 'error' && t('workspace.searchFailed')}
          {status === 'idle' && items.length === 0 && t('workspace.noSearchResults')}
        </div>
        <div id="global-search-results" className="global-search-results" role="listbox" aria-label={t('workspace.searchResults')}>
          {items.map((item, index) => <div role="option" aria-selected={activeIndex === index} id={`global-search-result-${index}`} key={`${item.source}:${item.public_id}`}>
            <button className={`global-search-result ${activeIndex === index ? 'is-active' : ''}`} onClick={() => onOpenResult(item)}>
              <span className="search-result-content"><strong>{item.title}</strong><span>{item.excerpt}</span></span>
              <span className="search-result-meta">
                <span>{sourceLabel(item.source)}</span>
                {item.project_name && <span>{item.project_name}</span>}
                {item.repository_name && <span>{item.repository_name}</span>}
                {item.tags.map((tag) => <span key={tag}>#{tag}</span>)}
                <time dateTime={item.time}><Clock3 aria-hidden="true" />{formatTime(item.time)}</time>
              </span>
            </button>
          </div>)}
          {items.length < total && <button className="load-more search-load-more" onClick={() => runSearch(query.trim(), items.length, true)} disabled={status === 'running'}>{t('workspace.loadMore')}</button>}
        </div>
      </>}
    </div>
  )
}
