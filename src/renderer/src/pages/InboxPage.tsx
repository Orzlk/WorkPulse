import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, Check, ChevronRight, Inbox, Sparkles, Trash2, X } from 'lucide-react'
import { useToast } from '../components/Toast'
import { extractHashTags } from '../lib/workspaceInteractions'
import { useInboxStore } from '../stores/inboxStore'
import { useProjectStore } from '../stores/projectStore'
import { useI18n } from '../stores/languageStore'
import { WorkspacePageHeader } from '../components/WorkspacePageHeader'
import { WorkspaceSectionTabs } from '../components/WorkspaceSectionTabs'
import { RecordsSidebar } from '../components/RecordsSidebar'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { InboxFilter } from '../lib/workspaceTypes'

function InboxPage({ focusId, onFocusHandled, onOpenRecords }: { focusId?: string | null; onFocusHandled?: () => void; onOpenRecords?: () => void }): JSX.Element {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState('')
  const [projectId, setProjectId] = useState('')
  const [saving, setSaving] = useState(false)
  const [aiOrganizing, setAiOrganizing] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const { items, total, status, error, selectedId, filter: inboxFilter, fetch, setFilter: setInboxFilter, loadByPublicId, loadMore, select, create, suggestAi, organize, ignore, remove } = useInboxStore()
  const projects = useProjectStore((state) => state.items)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const toast = useToast()
  const { t } = useI18n()

  useEffect(() => { void fetch(); void fetchProjects(); inputRef.current?.focus() }, [])
  useEffect(() => {
    if (!focusId) return
    void loadByPublicId(focusId).then((item) => {
      if (!item) return
      select(focusId)
      requestAnimationFrame(() => { document.getElementById(`inbox-${focusId}`)?.focus(); onFocusHandled?.() })
    }).finally(() => { if (!useInboxStore.getState().items.some((item) => item.public_id === focusId)) onFocusHandled?.() })
  }, [focusId, loadByPublicId, onFocusHandled, select])

  const selected = useMemo(() => items.find((item) => item.public_id === selectedId) ?? null, [items, selectedId])
  const tags = extractHashTags(draft).tags

  const save = async (): Promise<void> => {
    if (!draft.trim() || saving) return
    setSaving(true)
    try {
      await create({
        content: draft.trim(), project_id: projectId || null,
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

  const handleManualOrganize = async (publicId: string, target: 'task' | 'work_log'): Promise<void> => {
    const item = items.find((candidate) => candidate.public_id === publicId)
    if (!item) return
    try {
      await organize(publicId, { target, project_id: item.project_id, tag_names: [] })
      toast.success(t('workspace.organized'))
    } catch {
      toast.error(t('workspace.organizeFailed'))
    }
  }

  const handleIgnore = async (publicId: string): Promise<void> => {
    try { await ignore(publicId); toast.success(t('workspace.ignored')) } catch { toast.error(t('workspace.ignoreFailed')) }
  }

  const handleDelete = (publicId: string): void => {
    setPendingDeleteId(publicId)
  }

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDeleteId) return
    try {
      await remove(pendingDeleteId)
      toast.success(t('workspace.inboxDeleted'))
      setPendingDeleteId(null)
    } catch {
      toast.error(t('workspace.deleteInboxFailed'))
    }
  }

  const handleAiOrganize = async (): Promise<void> => {
    if (aiOrganizing || items.length === 0) return
    setAiOrganizing(true)
    try {
      const result = await suggestAi({ limit: 20 })
      toast.success(`${t('workspace.organized')}：${result.updated}`)
    } catch {
      toast.error(t('workspace.organizeFailed'))
    } finally {
      setAiOrganizing(false)
    }
  }

  return (
    <div className="records-layout">
      <RecordsSidebar
        mode="inbox"
        notesLabel={t('workspace.notes')}
        inboxLabel={t('nav.inbox')}
        inboxFilter={inboxFilter}
        inboxFilterLabels={{
          all: t('workspace.allInbox'),
          unorganized: t('workspace.inboxUnorganized'),
          confirmed: t('workspace.inboxConfirmed'),
          ignored: t('workspace.inboxIgnored'),
          archived: t('workspace.inboxArchived')
        }}
        onInboxFilter={(nextFilter: InboxFilter) => { void setInboxFilter(nextFilter) }}
      />
      <main className="records-main workspace-page inbox-page">
      <WorkspacePageHeader
        ariaLabel={t('workspace.breadcrumbLabel')}
        items={[{ label: t('nav.inbox'), current: true }]}
        title={t('workspace.inboxTitle')}
        description={t('workspace.inboxSubtitle')}
      />
      <WorkspaceSectionTabs
        ariaLabel={t('workspace.sectionNavigation')}
        items={[
          { id: 'notes', label: t('workspace.notes'), onClick: onOpenRecords },
          { id: 'inbox', label: t('nav.inbox'), active: true }
        ]}
      />
      <section className="inbox-capture" aria-label={t('workspace.quickCapture')}>
        <Inbox aria-hidden="true" />
        <textarea className="inbox-capture-input" ref={inputRef} rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void save()
          }
        }} placeholder={t('workspace.inboxPlaceholder')} aria-label={t('workspace.inboxInputAria')} />
        <button onClick={() => void save()} disabled={!draft.trim() || saving}>{saving ? t('workspace.saving') : t('common.save')}</button>
        <div className="capture-associations">
          <label>{t('workspace.project')}<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">{t('workspace.unassigned')}</option>{projects.map((project) => <option value={project.public_id} key={project.public_id}>{project.name}</option>)}</select></label>
          {tags.length > 0 && <span className="tag-preview">{tags.map((tag) => <span key={tag}>#{tag}</span>)}</span>}
        </div>
      </section>
      <div className="inbox-layout">
        <section className="inbox-list" aria-label={t('workspace.inboxList')}>
          <div className="section-heading"><h3>{inboxFilter === 'unorganized' ? t('workspace.toOrganize') : t('workspace.inboxList')}</h3><div className="flex items-center gap-2"><span>{total}</span><button type="button" onClick={() => void handleAiOrganize()} disabled={aiOrganizing || items.length === 0 || inboxFilter !== 'unorganized'} className="inline-flex min-h-8 items-center gap-1 rounded-md border border-zinc-300 px-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{aiOrganizing ? t('workspace.saving') : t('workspace.aiSuggestion')}</button></div></div>
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
            <div className="drawer-meta"><span>{t('workspace.project')}: {projects.find((item) => item.public_id === selected.project_id)?.name ?? t('workspace.unassigned')}</span></div>
            {selected.ai_suggestion ? <section className="ai-suggestion"><div><Sparkles aria-hidden="true" /><h3>{t('workspace.aiSuggestion')}: {selected.ai_suggestion.target === 'task' ? t('workspace.sourceTask') : selected.ai_suggestion.target === 'work_log' ? t('workspace.sourceLog') : t('workspace.ignore')}</h3></div><p>{selected.ai_suggestion.summary}</p><p>{selected.ai_suggestion.tag_names.map((tag) => `#${tag}`).join(' ')}</p></section> : <p className="drawer-note">{t('workspace.noAiSuggestion')}</p>}
            {selected.state === 'unorganized' ? <div className="drawer-actions">{selected.ai_suggestion ? <button className="primary-action" onClick={() => void handleOrganize(selected.public_id)}><Check aria-hidden="true" />{t('workspace.confirmOrganize')}</button> : <><button className="primary-action" onClick={() => void handleManualOrganize(selected.public_id, 'task')}><Check aria-hidden="true" />{t('workspace.manualTask')}</button><button onClick={() => void handleManualOrganize(selected.public_id, 'work_log')}><Check aria-hidden="true" />{t('workspace.manualWorkLog')}</button></>}<button onClick={() => void handleIgnore(selected.public_id)}><Archive aria-hidden="true" />{t('workspace.ignore')}</button><button className="danger-action" onClick={() => void handleDelete(selected.public_id)}><Trash2 aria-hidden="true" />{t('workspace.deleteInbox')}</button></div> : <div className="drawer-actions"><p className="drawer-note">{inboxFilterLabelsForState(selected.state, t)}</p><button className="danger-action" onClick={() => void handleDelete(selected.public_id)}><Trash2 aria-hidden="true" />{t('workspace.deleteInbox')}</button></div>}
          </> : <div className="drawer-placeholder"><Sparkles aria-hidden="true" /><p>{t('workspace.selectRecord')}</p></div>}
        </aside>
      </div>
      </main>
      {pendingDeleteId && <ConfirmDialog
        title={t('workspace.deleteInbox')}
        message={t('workspace.deleteInboxConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />}
    </div>
  )
}

function inboxFilterLabelsForState(state: Exclude<InboxFilter, 'all'>, t: ReturnType<typeof useI18n>['t']): string {
  switch (state) {
    case 'confirmed': return t('workspace.inboxConfirmed')
    case 'ignored': return t('workspace.inboxIgnored')
    case 'archived': return t('workspace.inboxArchived')
    case 'unorganized': return t('workspace.inboxUnorganized')
  }
}

export default InboxPage
