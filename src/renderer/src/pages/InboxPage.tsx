import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, Check, ChevronRight, Inbox, Sparkles, X } from 'lucide-react'
import { useToast } from '../components/Toast'
import { extractHashTags } from '../lib/workspaceInteractions'
import { useInboxStore } from '../stores/inboxStore'
import { useProjectStore } from '../stores/projectStore'
import { useRepositoryStore } from '../stores/repositoryStore'

function InboxPage({ focusId }: { focusId?: string | null }): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [projectId, setProjectId] = useState('')
  const [repositoryId, setRepositoryId] = useState('')
  const [saving, setSaving] = useState(false)
  const { items, total, status, error, selectedId, fetch, loadMore, select, create, organize, ignore } = useInboxStore()
  const projects = useProjectStore((state) => state.items)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const repositories = useRepositoryStore((state) => state.items)
  const fetchRepositories = useRepositoryStore((state) => state.fetch)
  const toast = useToast()

  useEffect(() => { void fetch(); void fetchProjects(); void fetchRepositories(); inputRef.current?.focus() }, [])
  useEffect(() => { if (focusId) select(focusId) }, [focusId, select])

  const selected = useMemo(() => items.find((item) => item.public_id === selectedId) ?? null, [items, selectedId])
  const tags = extractHashTags(draft).tags

  const save = async (): Promise<void> => {
    if (!draft.trim() || saving) return
    setSaving(true)
    try {
      await create({
        content: draft.trim(), project_id: projectId || null, repository_id: repositoryId || null,
        tag_names: tags, include_in_reports: true, ai_suggestion: null
      })
      setDraft('')
      toast.success('已保存到收件箱')
      inputRef.current?.focus()
    } catch {
      toast.error('保存失败，请检查后重试。')
    } finally {
      setSaving(false)
    }
  }

  const handleOrganize = async (publicId: string): Promise<void> => {
    try { await organize(publicId); toast.success('已按建议整理') } catch { toast.error('整理失败，可稍后重试。') }
  }

  const handleIgnore = async (publicId: string): Promise<void> => {
    try { await ignore(publicId); toast.success('已忽略该记录') } catch { toast.error('操作失败，请重试。') }
  }

  return (
    <div className="workspace-page inbox-page">
      <header className="workspace-page-heading">
        <p className="workspace-kicker">INBOX / 01</p>
        <h2>先记下，再整理</h2>
        <p>零散想法、进度和待办先进入收件箱；确认后才会进入正式工作流。</p>
      </header>
      <section className="inbox-capture" aria-label="快速记录">
        <Inbox aria-hidden="true" />
        <input ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter') void save()
        }} placeholder="记录一件事，#标签 会自动识别" aria-label="收件箱快速记录" />
        <button onClick={() => void save()} disabled={!draft.trim() || saving}>{saving ? '保存中' : '保存'}</button>
        <div className="capture-associations">
          <label>项目<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">未归属</option>{projects.map((project) => <option value={project.public_id} key={project.public_id}>{project.name}</option>)}</select></label>
          <label>仓库<select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}><option value="">未归属</option>{repositories.map((repository) => <option value={repository.public_id} key={repository.public_id}>{repository.name}</option>)}</select></label>
          {tags.length > 0 && <span className="tag-preview">{tags.map((tag) => <span key={tag}>#{tag}</span>)}</span>}
        </div>
      </section>
      <div className="inbox-layout">
        <section className="inbox-list" aria-label="收件箱列表">
          <div className="section-heading"><h3>待整理</h3><span>{total}</span></div>
          {status === 'error' && <div className="inline-error" role="alert">{error}<button onClick={() => void fetch()}>重试</button></div>}
          {items.length === 0 && status !== 'running' ? <div className="empty-state"><Inbox aria-hidden="true" /><p>这里还没有记录。</p><span>用上方输入框随手捕捉工作碎片。</span></div> : (
            <div className="inbox-items">
              {items.map((item) => <button key={item.public_id} onClick={() => select(item.public_id)} className={`inbox-item ${selectedId === item.public_id ? 'is-selected' : ''}`}>
                <span>{item.content}</span><small>{new Date(item.created_at).toLocaleString()}</small><ChevronRight aria-hidden="true" />
              </button>)}
            </div>
          )}
          {items.length < total && <button className="load-more" onClick={() => void loadMore()} disabled={status === 'running'}>加载更多</button>}
        </section>
        <aside className={`inbox-drawer ${selected ? 'is-open' : ''}`} aria-label="收件箱详情">
          {selected ? <>
            <button className="drawer-close" onClick={() => select(null)} aria-label="关闭详情"><X aria-hidden="true" /></button>
            <p className="workspace-kicker">记录详情</p><p className="drawer-content">{selected.content}</p>
            <div className="drawer-meta"><span>项目：{projects.find((item) => item.public_id === selected.project_id)?.name ?? '未归属'}</span><span>仓库：{repositories.find((item) => item.public_id === selected.repository_id)?.name ?? '未归属'}</span></div>
            {selected.ai_suggestion ? <section className="ai-suggestion"><div><Sparkles aria-hidden="true" /><h3>AI 建议：{selected.ai_suggestion.target === 'task' ? '任务' : selected.ai_suggestion.target === 'work_log' ? '日志' : '忽略'}</h3></div><p>{selected.ai_suggestion.summary}</p><p>{selected.ai_suggestion.tag_names.map((tag) => `#${tag}`).join(' ')}</p></section> : <p className="drawer-note">尚无 AI 建议。可先保留这条原始记录。</p>}
            <div className="drawer-actions"><button className="primary-action" onClick={() => void handleOrganize(selected.public_id)}><Check aria-hidden="true" />确认整理</button><button onClick={() => void handleIgnore(selected.public_id)}><Archive aria-hidden="true" />忽略</button></div>
          </> : <div className="drawer-placeholder"><Sparkles aria-hidden="true" /><p>选择一条记录查看建议与归属。</p></div>}
        </aside>
      </div>
    </div>
  )
}

export default InboxPage
