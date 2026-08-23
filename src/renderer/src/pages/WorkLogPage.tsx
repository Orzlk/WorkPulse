import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ClipboardEdit,
  Download,
  PenLine,
  Pencil,
  Search,
  Trash2,
  Undo2,
  Upload,
  X
} from 'lucide-react'
import { useToast } from '../components/Toast'
import { useWorkLogStore } from '../stores/worklogStore'
import { formatDate, formatTime, groupLogsByDate } from '../lib/dateUtils'
import { useI18n } from '../stores/languageStore'
import { useProjectStore } from '../stores/projectStore'
import { useRepositoryStore } from '../stores/repositoryStore'
import { extractHashTags } from '../lib/workspaceInteractions'

function WorkLogPage({ focusPublicId }: { focusPublicId?: string | null }): JSX.Element {
  const { logs, fetchLogs, loadByPublicId, loadMore, hasMore, addLog, deleteLog, undoDelete, dismissUndo, lastDeleted, searchLogs, clearSearch, searchKeyword, loading, updateLog } =
    useWorkLogStore()
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [shaking, setShaking] = useState(false)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editDate, setEditDate] = useState('')
  const [projectId, setProjectId] = useState('')
  const [repositoryId, setRepositoryId] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [editProjectId, setEditProjectId] = useState('')
  const [editRepositoryId, setEditRepositoryId] = useState('')
  const [editTagsInput, setEditTagsInput] = useState('')
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const toast = useToast()
  const { resolvedLanguage, t } = useI18n()
  const projects = useProjectStore((state) => state.items)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const repositories = useRepositoryStore((state) => state.items)
  const fetchRepositories = useRepositoryStore((state) => state.fetch)

  useEffect(() => {
    void fetchLogs()
    void fetchProjects()
    void fetchRepositories()
    window.api.worklog.categories().then(setCategorySuggestions).catch(() => setCategorySuggestions([]))
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!focusPublicId) return
    void loadByPublicId(focusPublicId).then((log) => {
      if (!log) return
      requestAnimationFrame(() => {
        const element = document.getElementById(`work-log-${focusPublicId}`)
        element?.scrollIntoView({ block: 'center' })
        element?.focus()
      })
    })
  }, [focusPublicId, loadByPublicId])

  const parseCategory = (text: string): { content: string; category: string } => {
    const match = text.match(/#(\S+)\s*/)
    if (match) {
      return { content: text.replace(match[0], '').trim(), category: match[1] }
    }
    return { content: text, category: '' }
  }

  const handleSubmit = async (): Promise<void> => {
    const trimmed = input.trim()
    if (!trimmed) {
      setShaking(true)
      setError(t('worklog.emptyError'))
      setTimeout(() => {
        setShaking(false)
        setError('')
      }, 1500)
      return
    }

    try {
      const { content, category } = parseCategory(trimmed)
      await addLog(content, category, { project_id: projectId || null, repository_id: repositoryId || null, tag_names: extractHashTags(`${trimmed} ${tagsInput}`).tags })
      setInput('')
    } catch {
      setError(t('worklog.saveError'))
    }
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleSearchChange = (value: string): void => {
    setSearch(value)
    clearTimeout(searchTimerRef.current)
    if (!value.trim()) {
      clearSearch()
      return
    }
    searchTimerRef.current = setTimeout(() => {
      searchLogs(value.trim())
    }, 300)
  }

  const handleClearSearch = (): void => {
    setSearch('')
    clearSearch()
  }

  const handleDelete = async (id: number): Promise<void> => {
    await deleteLog(id)
    setDeletingId(null)
    toast.success(t('worklog.deleted'))
  }

  const handleUndo = async (): Promise<void> => {
    await undoDelete()
    toast.success(t('worklog.restored'))
  }

  const handleEditSave = async (): Promise<void> => {
    if (!editingId) return
    const trimmedContent = editContent.trim()
    if (!trimmedContent) return
    const log = logs.find((l) => l.id === editingId)
    const timePart = log ? log.created_at.slice(10) : ''
    const newCreatedAt = editDate ? editDate + timePart : undefined
    try {
      await updateLog(editingId, trimmedContent, editCategory.trim(), newCreatedAt, { project_id: editProjectId || null, repository_id: editRepositoryId || null, tag_names: extractHashTags(editTagsInput).tags })
      setEditingId(null)
      toast.success(t('worklog.editSave'))
    } catch {
      setError(t('worklog.saveError'))
    }
  }

  const handleEditCancel = (): void => {
    setEditingId(null)
  }

  const grouped = groupLogsByDate(logs)

  return (
    <div className="worklog-page">
      {/* Input */}
      <div className="quick-entry-section">
        <div className={`quick-entry ${shaking ? 'animate-shake is-error' : ''}`}>
          <PenLine className="quick-entry-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('worklog.inputPlaceholder')}
            aria-label={t('worklog.inputAria')}
            list="worklog-category-suggestions"
            className="quick-entry-input"
          />
        </div>
        {error && <p className="quick-entry-error">{error}</p>}
        <div className="quick-create-associations worklog-associations"><label>{t('workspace.project')}<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">{t('workspace.unassigned')}</option>{projects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}</select></label><label>{t('workspace.repository')}<select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}><option value="">{t('workspace.unassigned')}</option>{repositories.map((repository) => <option key={repository.public_id} value={repository.public_id}>{repository.name}</option>)}</select></label><label>{t('workspace.tags')}<input value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} placeholder="#tag1 #tag2" /></label></div>
      </div>

      {/* Search + Export */}
      <div className="worklog-toolbar">
        <div className="worklog-search">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t('worklog.searchPlaceholder')}
            className="worklog-search-input"
          />
          {search && (
            <button
              onClick={handleClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              const result = await window.api.import.logs()
              if (result) {
                const msg = result.skipped > 0
                  ? t('worklog.importedSkipped', { imported: result.imported, skipped: result.skipped })
                  : t('worklog.imported', { count: result.imported })
                toast.success(msg)
                await fetchLogs()
              }
            }}
            className="export-button btn-bounce"
            title={t('worklog.import')}
          >
            <Upload />
            {t('common.import')}
          </button>
          <div className="relative group export-menu">
            <button className="export-button btn-bounce">
              <Download />
              {t('common.export')}
            </button>
            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
              <button
                onClick={async () => {
                  const path = await window.api.export.logs('csv')
                  if (path) toast.success(t('worklog.exportedCsv'))
                }}
                className="block w-full px-4 py-2 text-sm text-left text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 rounded-t-lg whitespace-nowrap"
              >
                {t('worklog.exportCsv')}
              </button>
              <button
                onClick={async () => {
                  const path = await window.api.export.logs('markdown')
                  if (path) toast.success(t('worklog.exportedMarkdown'))
                }}
                className="block w-full px-4 py-2 text-sm text-left text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 rounded-b-lg whitespace-nowrap"
              >
                {t('worklog.exportMarkdown')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Search info */}
      {searchKeyword && (
        <div className="mb-3 text-sm text-zinc-500">
          {t('worklog.searchInfo', { keyword: searchKeyword, count: logs.length })}
          <button onClick={handleClearSearch} className="ml-2 text-blue-500 hover:underline">
            {t('common.clear')}
          </button>
        </div>
      )}

      {/* Log list */}
      {logs.length === 0 ? (
        <div className="text-center py-16 animate-fade-in">
          <ClipboardEdit className="w-12 h-12 mx-auto text-zinc-300 mb-4 animate-float" />
          {searchKeyword ? (
            <>
              <p className="text-zinc-500 text-lg mb-1">{t('worklog.noResults')}</p>
              <p className="text-zinc-400 text-sm">{t('worklog.tryOtherKeywords')}</p>
            </>
          ) : (
            <>
              <p className="text-zinc-500 text-lg mb-1">{t('worklog.emptyTitle')}</p>
              <p className="text-zinc-400 text-sm">{t('worklog.emptySubtitle')}</p>
            </>
          )}
        </div>
      ) : (
        <>
        <div role="list" className="log-timeline">
          {Array.from(grouped.entries()).map(([dateKey, dateLogs]) => (
            <section key={dateKey} role="group" className="log-day">
              <h3 className="log-day-title">
                {formatDate(dateKey + 'T00:00:00', resolvedLanguage)}
              </h3>
              <div className="log-day-items stagger-children">
                {dateLogs.map((log) => (
                  <div
                    key={log.id}
                    id={`work-log-${log.public_id}`}
                    tabIndex={-1}
                    className="log-row group"
                  >
                    <span className="log-dot" aria-hidden="true" />
                    {editingId === log.id ? (
                      <>
                        <div className="log-content flex-wrap">
                          <input
                            type="text"
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleEditSave()
                              if (e.key === 'Escape') handleEditCancel()
                            }}
                            className="w-full sm:min-w-[180px] sm:flex-1 px-2 py-1 text-sm border border-zinc-300 dark:border-zinc-600 rounded outline-none focus:border-blue-400 bg-white dark:bg-zinc-700 dark:text-zinc-100"
                            autoFocus
                          />
                          <label className="sr-only" htmlFor={`edit-project-${log.id}`}>{t('workspace.project')}</label>
                          <select id={`edit-project-${log.id}`} value={editProjectId} onChange={(e) => setEditProjectId(e.target.value)} className="w-full sm:w-36 px-2 py-1 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-700 dark:text-zinc-100"><option value="">{t('workspace.unassigned')}</option>{projects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}</select>
                          <label className="sr-only" htmlFor={`edit-repository-${log.id}`}>{t('workspace.repository')}</label>
                          <select id={`edit-repository-${log.id}`} value={editRepositoryId} onChange={(e) => setEditRepositoryId(e.target.value)} className="w-full sm:w-36 px-2 py-1 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-700 dark:text-zinc-100"><option value="">{t('workspace.unassigned')}</option>{repositories.map((repository) => <option key={repository.public_id} value={repository.public_id}>{repository.name}</option>)}</select>
                          <input type="text" value={editTagsInput} onChange={(e) => setEditTagsInput(e.target.value)} placeholder={t('workspace.tagsPlaceholder')} className="w-full sm:w-32 px-2 py-1 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-700 dark:text-zinc-100" />
                          <input
                            type="text"
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleEditSave()
                              if (e.key === 'Escape') handleEditCancel()
                            }}
                            placeholder="#tag"
                            list="worklog-category-suggestions"
                            className="w-full sm:w-28 px-2 py-1 text-sm border border-zinc-300 dark:border-zinc-600 rounded outline-none focus:border-blue-400 bg-white dark:bg-zinc-700 dark:text-zinc-100"
                          />
                          <input
                            type="date"
                            value={editDate}
                            onChange={(e) => setEditDate(e.target.value)}
                            className="w-full sm:w-36 px-2 py-1 text-sm border border-zinc-300 dark:border-zinc-600 rounded outline-none focus:border-blue-400 bg-white dark:bg-zinc-700 dark:text-zinc-100"
                          />
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={handleEditSave}
                            className="p-1 text-green-500 hover:text-green-600"
                            title={t('worklog.editSave')}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={handleEditCancel}
                            className="p-1 text-zinc-400 hover:text-zinc-600"
                            title={t('worklog.editCancel')}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="log-content">
                          <span className="log-content-text">{log.content}</span>
                          {log.category && (
                            <span className="log-category">
                              {log.category}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-zinc-400">{formatTime(log.created_at)}</span>
                          {deletingId === log.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDelete(log.id)}
                                className="text-xs text-red-500 hover:text-red-700 px-1"
                              >
                                {t('common.confirm')}
                              </button>
                              <button
                                onClick={() => setDeletingId(null)}
                                className="text-xs text-zinc-400 hover:text-zinc-600 px-1"
                              >
                                {t('common.cancel')}
                              </button>
                            </div>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setEditingId(log.id)
                                  setEditContent(log.content)
                                  setEditCategory(log.category)
                                  setEditDate(log.created_at.slice(0, 10))
                                  setEditProjectId(log.project_id ?? '')
                                  setEditRepositoryId(log.repository_id ?? '')
                                  setEditTagsInput(log.tag_names.map((tag) => `#${tag}`).join(' '))
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-blue-500 transition-all"
                                aria-label={t('worklog.editAria')}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setDeletingId(log.id)}
                                className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-red-500 transition-all"
                                aria-label={t('worklog.deleteAria')}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        {hasMore && !searchKeyword && (
          <div className="text-center py-4">
            <button
              onClick={loadMore}
              disabled={loading}
              className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 disabled:opacity-50"
            >
              {loading ? t('common.loading') : t('worklog.loadMore')}
            </button>
          </div>
        )}
        </>
      )}

      {/* Undo bar */}
      {lastDeleted && (
        <div className="fixed bottom-4 left-1/2 z-40 flex items-center gap-3 px-4 py-2.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg shadow-lg text-sm animate-undo-slide-up">
          <span>{t('worklog.deletedOne')}</span>
          <button
            onClick={handleUndo}
            className="flex items-center gap-1 font-medium text-blue-300 dark:text-blue-600 hover:text-blue-200 dark:hover:text-blue-500"
          >
            <Undo2 className="w-3.5 h-3.5" />
            {t('worklog.undo')}
          </button>
          <button
            onClick={dismissUndo}
            className="ml-1 p-0.5 text-zinc-400 dark:text-zinc-500 hover:text-white dark:hover:text-zinc-900"
            title={t('common.confirm')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <datalist id="worklog-category-suggestions">
        {categorySuggestions.map((category) => <option key={category} value={`#${category}`} />)}
      </datalist>
    </div>
  )
}

export default WorkLogPage
