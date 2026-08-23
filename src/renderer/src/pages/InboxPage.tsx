import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, Check, ChevronRight, Inbox, Sparkles, X } from 'lucide-react'
import { useToast } from '../components/Toast'
import { extractHashTags } from '../lib/workspaceInteractions'
import { useInboxStore } from '../stores/inboxStore'
import { useProjectStore } from '../stores/projectStore'
import { useRepositoryStore } from '../stores/repositoryStore'
import { useI18n } from '../stores/languageStore'

function InboxPage({ focusId }: { focusId?: string | null }): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [projectId, setProjectId] = useState('')
  const [repositoryId, setRepositoryId] = useState('')
  const [saving, setSaving] = useState(false)
  const { items, total, status, error, selectedId, fetch, loadByPublicId, loadMore, select, create, organize, ignore } = useInboxStore()
  const projects = useProjectStore((state) => state.items)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const repositories = useRepositoryStore((state) => state.items)
  const fetchRepositories = useRepositoryStore((state) => state.fetch)
  const toast = useToast()
  const { t } = useI18n()

  useEffect(() => { void fetch(); void fetchProjects(); void fetchRepositories(); inputRef.current?.focus() }, [])
  useEffect(() => {
    if (!focusId) return
    void loadByPublicId(focusId).then((item) => {
      if (!item) return
      select(focusId)
      requestAnimationFrame(() => document.getElementById(`inbox-${focusId}`)?.focus())
    })
  }, [focusId, loadByPublicId, select])

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
      toast.success(t('workspace.inboxSaved'))
      inputRef.current?.focus()
    } catch {
      toast.error(t('workspace.inboxSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleOrganize = async (publicId: string): Promise<void> => {
    try { await organize(publicId); toast.success(t('workspace.organized')) } catch { toast.error(t('workspace.organizeFailed')) }
  }

  const handleIgnore = async (publicId: string): Promise<void> => {
    try { await ignore(publicId); toast.success(t('workspace.ignored')) } catch { toast.error(t('workspace.ignoreFailed')) }
  }

  return (
    <div className="workspace-page inbox-page">
      <header className="workspace-page-heading">
        <p className="workspace-kicker">{t('workspace.inboxKicker')}</p>
        <h2>{t('workspace.inboxTitle')}</h2>
        <p>{t('workspace.inboxSubtitle')}</p>
      </header>
      <section className="inbox-capture" aria-label={t('workspace.quickCapture')}>
        <Inbox aria-hidden="true" />
        <input ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter') void save()
        }} placeholder={t('workspace.inboxPlaceholder')} aria-label={t('workspace.inboxInputAria')} />
        <button onClick={() => void save()} disabled={!draft.trim() || saving}>{saving ? t('workspace.saving') : t('common.save')}</button>
        <div className="capture-associations">
          <label>{t('workspace.project')}<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">{t('workspace.unassigned')}</option>{projects.map((project) => <option value={project.public_id} key={project.public_id}>{project.name}</option>)}</select></label>
          <label>{t('workspace.repository')}<select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}><option value="">{t('workspace.unassigned')}</option>{repositories.map((repository) => <option value={repository.public_id} key={repository.public_id}>{repository.name}</option>)}</select></label>
          {tags.length > 0 && <span className="tag-preview">{tags.map((tag) => <span key={tag}>#{tag}</span>)}</span>}
        </div>
      </section>
      <div className="inbox-layout">
        <section className="inbox-list" aria-label={t('workspace.inboxList')}>
          <div className="section-heading"><h3>{t('workspace.toOrganize')}</h3><span>{total}</span></div>
          {status === 'error' && <div className="inline-error" role="alert">{error ? t(error as Parameters<typeof t>[0]) : ''}<button onClick={() => void fetch()}>{t('common.retry')}</button></div>}
          {items.length === 0 && status !== 'running' ? <div className="empty-state"><Inbox aria-hidden="true" /><p>{t('workspace.emptyInbox')}</p><span>{t('workspace.emptyInboxHelp')}</span></div> : (
            <div className="inbox-items">
              {items.map((item) => <button id={`inbox-${item.public_id}`} key={item.public_id} onClick={() => select(item.public_id)} className={`inbox-item ${selectedId === item.public_id ? 'is-selected' : ''}`}>
                <span>{item.content}</span><small>{new Date(item.created_at).toLocaleString()}</small><ChevronRight aria-hidden="true" />
              </button>)}
            </div>
          )}
          {items.length < total && <button className="load-more" onClick={() => void loadMore()} disabled={status === 'running'}>{t('workspace.loadMore')}</button>}
        </section>
        <aside className={`inbox-drawer ${selected ? 'is-open' : ''}`} aria-label={t('workspace.inboxDetails')}>
          {selected ? <>
            <button className="drawer-close" onClick={() => select(null)} aria-label={t('workspace.closeDetails')}><X aria-hidden="true" /></button>
            <p className="workspace-kicker">{t('workspace.recordDetails')}</p><p className="drawer-content">{selected.content}</p>
            <div className="drawer-meta"><span>{t('workspace.project')}: {projects.find((item) => item.public_id === selected.project_id)?.name ?? t('workspace.unassigned')}</span><span>{t('workspace.repository')}: {repositories.find((item) => item.public_id === selected.repository_id)?.name ?? t('workspace.unassigned')}</span></div>
            {selected.ai_suggestion ? <section className="ai-suggestion"><div><Sparkles aria-hidden="true" /><h3>{t('workspace.aiSuggestion')}: {selected.ai_suggestion.target === 'task' ? t('workspace.sourceTask') : selected.ai_suggestion.target === 'work_log' ? t('workspace.sourceLog') : t('workspace.ignore')}</h3></div><p>{selected.ai_suggestion.summary}</p><p>{selected.ai_suggestion.tag_names.map((tag) => `#${tag}`).join(' ')}</p></section> : <p className="drawer-note">{t('workspace.noAiSuggestion')}</p>}
            <div className="drawer-actions"><button className="primary-action" onClick={() => void handleOrganize(selected.public_id)}><Check aria-hidden="true" />{t('workspace.confirmOrganize')}</button><button onClick={() => void handleIgnore(selected.public_id)}><Archive aria-hidden="true" />{t('workspace.ignore')}</button></div>
          </> : <div className="drawer-placeholder"><Sparkles aria-hidden="true" /><p>{t('workspace.selectRecord')}</p></div>}
        </aside>
      </div>
    </div>
  )
}

export default InboxPage
