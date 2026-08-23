import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock3, Search, X } from 'lucide-react'
import { createLatestRequestGate } from '../lib/workspaceInteractions'
import type { InboxItem, Project, Repository } from '../lib/workspaceTypes'

interface Props {
  projects: Project[]
  repositories: Repository[]
  onOpenInbox: (publicId: string) => void
}

export function GlobalSearch({ projects, repositories, onOpenInbox }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<InboxItem[]>([])
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle')
  const gate = useMemo(createLatestRequestGate, [])
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const text = query.trim()
    controllerRef.current?.abort()
    if (!text) {
      setItems([])
      setStatus('idle')
      return
    }

    const requestId = gate.next()
    const controller = new AbortController()
    controllerRef.current = controller
    setStatus('running')
    const timer = window.setTimeout(() => {
      void window.api.search.query({ text, limit: 12, offset: 0 })
        .then((page) => {
          if (!controller.signal.aborted && gate.isCurrent(requestId)) {
            setItems(page.items)
            setStatus('idle')
          }
        })
        .catch(() => {
          if (!controller.signal.aborted && gate.isCurrent(requestId)) setStatus('error')
        })
    }, 280)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, gate])

  const projectNames = useMemo(() => new Map(projects.map((item) => [item.public_id, item.name])), [projects])
  const repositoryNames = useMemo(() => new Map(repositories.map((item) => [item.public_id, item.name])), [repositories])

  return (
    <div className="global-search">
      <label className="sr-only" htmlFor="global-search-input">全局搜索</label>
      <Search aria-hidden="true" className="global-search-icon" />
      <input
        id="global-search-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索收件箱、标签和项目"
        className="global-search-input"
        autoComplete="off"
      />
      {query && (
        <button className="global-search-clear" onClick={() => setQuery('')} aria-label="清除搜索">
          <X aria-hidden="true" />
        </button>
      )}
      {query && (
        <div className="global-search-results" role="status" aria-live="polite">
          {status === 'running' && <p className="search-state">正在搜索…</p>}
          {status === 'error' && <p className="search-state is-error">搜索失败，请重试。</p>}
          {status === 'idle' && items.length === 0 && <p className="search-state">没有找到匹配记录。</p>}
          {items.map((item) => (
            <button
              key={item.public_id}
              className="global-search-result"
              onClick={() => { onOpenInbox(item.public_id); setQuery('') }}
            >
              <span className="search-result-content">{item.content}</span>
              <span className="search-result-meta">
                <span>收件箱</span>
                {item.project_id && <span>{projectNames.get(item.project_id) ?? '未命名项目'}</span>}
                {item.repository_id && <span>{repositoryNames.get(item.repository_id) ?? '未命名仓库'}</span>}
                {item.ai_suggestion?.tag_names.map((tag) => <span key={tag}>#{tag}</span>)}
                <time dateTime={item.created_at}><Clock3 aria-hidden="true" />{new Date(item.created_at).toLocaleDateString()}</time>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
