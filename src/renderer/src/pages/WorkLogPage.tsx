import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  AtSign,
  ClipboardEdit,
  Download,
  Hash,
  Image,
  List,
  ListOrdered,
  MoreHorizontal,
  Pencil,
  Search,
  Send,
  Type,
  Trash2,
  Undo2,
  Upload,
  X
} from 'lucide-react'
import { useToast } from '../components/Toast'
import { useWorkLogStore } from '../stores/worklogStore'
import { groupLogsByDate } from '../lib/dateUtils'
import { useI18n } from '../stores/languageStore'
import { useProjectStore } from '../stores/projectStore'
import { extractHashTags, findProjectMention, findTagMention, replaceProjectMention, resolveProjectReference, type ProjectMentionRange } from '../lib/workspaceInteractions'
import { TagHighlightTextarea } from '../components/TagHighlightTextarea'
import { InteractiveMarkdown } from '../components/InteractiveMarkdown'
import { RecordsSidebar } from '../components/RecordsSidebar'
import { WorkspacePageHeader } from '../components/WorkspacePageHeader'
import { WorkspaceSectionTabs } from '../components/WorkspaceSectionTabs'
import { buildTagTree, type TagTreeNode } from '../lib/tagTree'
import { getMentionMenuPosition, getTextareaCaretPosition, type MentionMenuPosition } from '../lib/mentionMenuPosition'
import { applySelectedTagToComposer } from '../lib/tagComposerDefaults'
import type { Tag } from '../lib/workspaceTypes'

function WorkLogPage({ focusPublicId, onOpenInbox }: { focusPublicId?: string | null; onOpenInbox?: () => void }): JSX.Element {
  const { logs, fetchLogs, loadByPublicId, loadMore, hasMore, addLog, deleteLog, undoDelete, dismissUndo, lastDeleted, searchLogs, clearSearch, searchKeyword, loading, tagFilter, setTagFilter, projectFilter, setProjectFilter } =
    useWorkLogStore()
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [shaking, setShaking] = useState(false)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>([])
  const [projectMention, setProjectMention] = useState<ProjectMentionRange | null>(null)
  const [tagMention, setTagMention] = useState<ProjectMentionRange | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [tagTree, setTagTree] = useState<TagTreeNode[]>([])
  const [tagOptions, setTagOptions] = useState<Tag[]>([])
  const [mentionPosition, setMentionPosition] = useState<MentionMenuPosition | null>(null)
  const [mentionPositionTick, setMentionPositionTick] = useState(0)
  const [attachmentSaving, setAttachmentSaving] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const autoTagPrefixRef = useRef('')
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const mentionMenuRef = useRef<HTMLDivElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const toast = useToast()
  const { t } = useI18n()
  const projects = useProjectStore((state) => state.items)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const projectSuggestions = useMemo(() => {
    if (!projectMention) return []
    const query = projectMention.query.trim().toLocaleLowerCase()
    return projects
      .filter((project) => !query || project.name.toLocaleLowerCase().includes(query))
      .slice(0, 8)
  }, [projects, projectMention])

  const tagSuggestions = useMemo(() => {
    if (!tagMention) return []
    const query = tagMention.query.trim().toLocaleLowerCase()
    return tagOptions
      .filter((tag) => !query || tag.path.toLocaleLowerCase().includes(query))
      .slice(0, 8)
  }, [tagMention, tagOptions])

  const refreshTagTree = (): Promise<void> =>
    window.api.tag.list({ limit: 200, offset: 0 })
      .then((page) => {
        setTagTree(buildTagTree(page.items))
        setTagOptions(page.items)
      })
      .catch(() => {
        setTagTree([])
        setTagOptions([])
      })

  useEffect(() => {
    void fetchLogs()
    void fetchProjects()
    void refreshTagTree()
    window.api.worklog.categories().then(setCategorySuggestions).catch(() => setCategorySuggestions([]))
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setInput((current) => {
      const next = applySelectedTagToComposer(current, tagFilter, autoTagPrefixRef.current)
      autoTagPrefixRef.current = next.autoPrefix
      return next.text
    })
  }, [tagFilter])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest('.log-card-menu')) {
        setOpenMenuId(null)
      }
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenMenuId(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.on.worklogEditorChanged(() => {
      const state = useWorkLogStore.getState()
      if (state.searchKeyword) {
        void state.searchLogs(state.searchKeyword, state.tagFilter || undefined, state.projectFilter || undefined)
      } else {
        void state.fetchLogs(state.tagFilter || undefined, state.projectFilter || undefined)
      }
      void refreshTagTree()
    })
    return unsubscribe
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
      await addLog(trimmed, '', { project_id: resolveProjectReference(trimmed, projects), repository_id: null, tag_names: extractHashTags(trimmed).tags })
      await refreshTagTree()
      autoTagPrefixRef.current = ''
      setInput('')
      setProjectMention(null)
      setTagMention(null)
    } catch {
      setError(t('worklog.saveError'))
    }
    inputRef.current?.focus()
  }

  const syncComposerMention = (value: string, cursor: number): void => {
    const nextProjectMention = findProjectMention(value, cursor)
    const nextTagMention = findTagMention(value, cursor)
    if (nextProjectMention && (!nextTagMention || nextProjectMention.start > nextTagMention.start)) {
      setProjectMention(nextProjectMention)
      setTagMention(null)
    } else if (nextTagMention) {
      setProjectMention(null)
      setTagMention(nextTagMention)
    } else {
      setProjectMention(null)
      setTagMention(null)
    }
    setMentionIndex(0)
  }

  const handleComposerChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = event.target.value
    setInput(value)
    syncComposerMention(value, event.target.selectionStart)
  }

  const selectProjectMention = (projectPublicId: string): void => {
    if (!projectMention) return
    const project = projects.find((item) => item.public_id === projectPublicId)
    if (!project) return
    const next = replaceProjectMention(input, projectMention, `@${project.name}`)
    setInput(next.text)
    setProjectMention(null)
    setTagMention(null)
    requestAnimationFrame(() => {
      const textarea = inputRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(next.cursor, next.cursor)
    })
  }

  const selectTagMention = (tagPath: string): void => {
    if (!tagMention) return
    const next = replaceProjectMention(input, tagMention, `#${tagPath}`)
    setInput(next.text)
    setTagMention(null)
    requestAnimationFrame(() => {
      const textarea = inputRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(next.cursor, next.cursor)
    })
  }

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    const activeMention = projectMention ?? tagMention
    const activeSuggestions = projectMention ? projectSuggestions : tagSuggestions
    if (event.key === 'Escape' && activeMention) {
      event.preventDefault()
      setProjectMention(null)
      setTagMention(null)
      return
    }
    if (!activeMention || activeSuggestions.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setMentionIndex((current) => (current + 1) % activeSuggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setMentionIndex((current) => (current - 1 + activeSuggestions.length) % activeSuggestions.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (projectMention) {
        selectProjectMention(projectSuggestions[mentionIndex]?.public_id ?? projectSuggestions[0].public_id)
      } else {
        selectTagMention(tagSuggestions[mentionIndex]?.path ?? tagSuggestions[0].path)
      }
    }
  }

  const insertComposerText = (text: string): void => {
    const textarea = inputRef.current
    if (!textarea) {
      setInput((current) => current + text)
      return
    }
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const next = `${input.slice(0, start)}${text}${input.slice(end)}`
    setInput(next)
    syncComposerMention(next, start + text.length)
    requestAnimationFrame(() => {
      textarea.focus()
      const cursor = start + text.length
      textarea.setSelectionRange(cursor, cursor)
    })
  }

  const insertComposerAttachment = async (file: File): Promise<void> => {
    if (!file.type.startsWith('image/')) {
      setError(t('worklog.saveError'))
      return
    }
    setAttachmentSaving(true)
    try {
      const saved = await window.api.attachment.save({
        fileName: file.name || 'pasted-image.png',
        mimeType: file.type || 'image/png',
        data: await file.arrayBuffer()
      })
      insertComposerText(`![${saved.fileName}](${saved.url})`)
    } catch {
      setError(t('worklog.saveError'))
    } finally {
      setAttachmentSaving(false)
    }
  }

  const handleComposerPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>): void => {
    const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/'))
    if (!image) return
    event.preventDefault()
    void insertComposerAttachment(image)
  }

  const handleComposerDrop = (event: ReactDragEvent<HTMLTextAreaElement>): void => {
    event.preventDefault()
    const image = Array.from(event.dataTransfer.files).find((file) => file.type.startsWith('image/'))
    if (image) void insertComposerAttachment(image)
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

  const handleTagSelect = (path: string): void => {
    void setTagFilter(tagFilter === path ? '' : path)
  }

  const handleProjectSelect = (publicId: string): void => {
    void setProjectFilter(projectFilter === publicId ? '' : publicId)
  }

  const handleDelete = async (id: number): Promise<void> => {
    await deleteLog(id)
    await refreshTagTree()
    setDeletingId(null)
    toast.success(t('worklog.deleted'))
  }

  const handleUndo = async (): Promise<void> => {
    await undoDelete()
    toast.success(t('worklog.restored'))
  }

  const grouped = groupLogsByDate(logs)
  const selectedProjectName = projects.find((project) => project.public_id === projectFilter)?.name
  const tagPathParts = tagFilter.split('/').filter(Boolean)
  const tagMenuItems = tagFilter
    ? tagOptions
      .filter((tag) => tag.path !== tagFilter)
      .sort((left, right) => left.path.localeCompare(right.path, 'zh-Hans'))
      .slice(0, 12)
      .map((tag) => ({ label: tag.path, onClick: () => { void setTagFilter(tag.path) } }))
    : []
  const activeMention = projectMention ?? tagMention
  const activeSuggestions = projectMention ? projectSuggestions : tagSuggestions
  const mentionMenuId = projectMention ? 'worklog-project-mention-list' : 'worklog-tag-mention-list'

  useLayoutEffect(() => {
    if (!activeMention) {
      setMentionPosition(null)
      return
    }
    const textarea = inputRef.current
    const container = composerRef.current
    const menu = mentionMenuRef.current
    if (!textarea || !container || !menu) return
    const caret = getTextareaCaretPosition(textarea, activeMention.end)
    const containerRect = container.getBoundingClientRect()
    setMentionPosition(getMentionMenuPosition(
      caret,
      containerRect,
      { width: menu.offsetWidth || 280, height: menu.offsetHeight || 220 }
    ))
  }, [activeMention, mentionIndex, mentionPositionTick])

  return (
    <div className="worklog-page">
      <div className="records-layout">
        <RecordsSidebar
          mode="notes"
          notesLabel={t('workspace.notes')}
          inboxLabel={t('nav.inbox')}
          tagNodes={tagTree}
          selectedTagPath={tagFilter}
          allNotesLabel={t('workspace.allNotes')}
          noTagsLabel={t('workspace.noTags')}
          tagSidebarId="worklog-tag-sidebar"
          onSelectTag={handleTagSelect}
        />
        <main className="records-main worklog-main">
      <WorkspacePageHeader
        ariaLabel={t('workspace.breadcrumbLabel')}
        title={t('workspace.allNotes')}
        onHome={() => {
          void setTagFilter('')
          void setProjectFilter('')
        }}
        items={[
          {
            label: t('workspace.allNotes'),
            current: tagPathParts.length === 0,
            onClick: tagPathParts.length > 0 ? () => { void setTagFilter('') } : undefined
          },
          ...tagPathParts.map((part, index) => ({
            label: part,
            current: index === tagPathParts.length - 1,
            expandable: index === tagPathParts.length - 1,
            onClick: () => { void setTagFilter(tagPathParts.slice(0, index + 1).join('/')) },
            menuItems: index === tagPathParts.length - 1 ? tagMenuItems : undefined
          }))
        ]}
      />
      <WorkspaceSectionTabs
        ariaLabel={t('workspace.sectionNavigation')}
        items={[
          { id: 'notes', label: t('workspace.notes'), active: true, onClick: () => { void setTagFilter('') } },
          { id: 'inbox', label: t('nav.inbox'), onClick: onOpenInbox }
        ]}
      />
      <div className="worklog-navigation">
        <div className="worklog-active-filters" aria-label={t('workspace.activeFilters')}>
        {projectFilter && selectedProjectName && (
          <>
            <span className="worklog-active-filter-label">{t('workspace.projectFilter')}:</span>
            <button type="button" className="worklog-filter-chip worklog-filter-chip-project is-selected" onClick={() => handleProjectSelect(projectFilter)}>
              @{selectedProjectName}<span aria-hidden="true">×</span>
            </button>
          </>
        )}
        </div>
      </div>
      {/* Input */}
      <div className="quick-entry-section">
        <div ref={composerRef} className={`quick-entry ${shaking ? 'animate-shake is-error' : ''}`}>
          <TagHighlightTextarea
            ref={inputRef}
            rows={5}
            value={input}
            onChange={handleComposerChange}
            onKeyDown={handleComposerKeyDown}
            onPaste={handleComposerPaste}
            onDrop={handleComposerDrop}
            onDragOver={(event) => event.preventDefault()}
            onSelect={() => setMentionPositionTick((current) => current + 1)}
            onScroll={() => setMentionPositionTick((current) => current + 1)}
            placeholder={t('worklog.inputPlaceholder')}
            aria-label={t('worklog.inputAria')}
            aria-controls={activeMention ? mentionMenuId : undefined}
            aria-expanded={Boolean(activeMention)}
          />
          <input
            ref={attachmentInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const image = event.target.files?.[0]
              if (image) void insertComposerAttachment(image)
              event.currentTarget.value = ''
            }}
          />
          {activeMention && (
            <div ref={mentionMenuRef} id={mentionMenuId} style={mentionPosition ? { left: mentionPosition.left, top: mentionPosition.top } : undefined} className={`project-mention-menu worklog-mention-menu ${tagMention ? 'tag-mention-menu' : ''}`} role="listbox" aria-label={t(projectMention ? 'worklog.projectMentionSuggestions' : 'worklog.tagMentionSuggestions')}>
              {activeSuggestions.length > 0 ? projectMention ? projectSuggestions.map((project, index) => (
                <button
                  key={project.public_id}
                  type="button"
                  role="option"
                  aria-selected={index === mentionIndex}
                  className={`project-mention-option ${index === mentionIndex ? 'is-selected' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectProjectMention(project.public_id)}
                >
                  <span className="project-mention-symbol">@</span>
                  <span>{project.name}</span>
                </button>
              )) : tagSuggestions.map((tag, index) => (
                <button
                  key={tag.public_id}
                  type="button"
                  role="option"
                  aria-selected={index === mentionIndex}
                  className={`project-mention-option tag-mention-option ${index === mentionIndex ? 'is-selected' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectTagMention(tag.path)}
                >
                  <span className="tag-mention-symbol">#</span>
                  <span>{tag.path}</span>
                </button>
              )) : (
                <p className="project-mention-empty">{t(projectMention ? 'worklog.projectMentionEmpty' : 'worklog.tagMentionEmpty')}</p>
              )}
            </div>
          )}
          <div className="quick-entry-footer">
            <div className="quick-entry-actions" aria-label={t('worklog.inputTools')}>
              <button type="button" onClick={() => insertComposerText('#')} aria-label={t('worklog.insertTag')} title={t('worklog.insertTag')}>
                <Hash aria-hidden="true" />
              </button>
              <button type="button" disabled={attachmentSaving} onClick={() => attachmentInputRef.current?.click()} aria-label={t('common.save')} title={t('common.save')}>
                <Image aria-hidden="true" />
              </button>
              <span className="quick-entry-divider" aria-hidden="true" />
              <button type="button" disabled aria-label={t('worklog.formatComingSoon')} title={t('worklog.formatComingSoon')}>
                <Type aria-hidden="true" />
              </button>
              <button type="button" onClick={() => insertComposerText('- ')} aria-label={t('worklog.insertBulletList')} title={t('worklog.insertBulletList')}>
                <List aria-hidden="true" />
              </button>
              <button type="button" onClick={() => insertComposerText('1. ')} aria-label={t('worklog.insertNumberedList')} title={t('worklog.insertNumberedList')}>
                <ListOrdered aria-hidden="true" />
              </button>
              <span className="quick-entry-divider" aria-hidden="true" />
              <button type="button" onClick={() => insertComposerText('@')} aria-label={t('worklog.chooseAssociation')} title={t('worklog.chooseAssociation')}>
                <AtSign aria-hidden="true" />
              </button>
            </div>
            <div className="quick-entry-submit">
              <span aria-label={t('worklog.characterCount')}>{input.length}</span>
              <button type="button" onClick={() => void handleSubmit()} aria-label={t('worklog.submit')} title={t('worklog.submit')}>
                <Send aria-hidden="true" />
              </button>
            </div>
          </div>
        {error && <p className="quick-entry-error">{error}</p>}
        </div>
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
              try {
                const result = await window.api.import.logs()
                if (result) {
                  const message = result.source === 'flomo'
                    ? result.skipped > 0
                      ? t('worklog.importedFlomoSkipped', { imported: result.imported, skipped: result.skipped })
                      : t('worklog.importedFlomo', { count: result.imported })
                    : result.skipped > 0
                      ? t('worklog.importedSkipped', { imported: result.imported, skipped: result.skipped })
                      : t('worklog.imported', { count: result.imported })
                  const attachmentMessages = result.source === 'flomo'
                    ? [
                        result.attachmentsImported > 0
                          ? t('worklog.flomoAttachmentsImported', { count: result.attachmentsImported })
                          : '',
                        result.attachmentsSkipped > 0
                          ? t('worklog.flomoAttachmentsSkipped', { count: result.attachmentsSkipped })
                          : ''
                      ].filter(Boolean)
                    : []
                  const attachmentMessage = attachmentMessages.length > 0 ? ` · ${attachmentMessages.join(' · ')}` : ''
                  toast.success(`${message}${attachmentMessage}`)
                  await fetchLogs()
                  await refreshTagTree()
                }
              } catch {
                toast.error(t('worklog.importFailed'))
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
              <div className="log-day-items stagger-children">
                {dateLogs.map((log) => (
                  <div
                    key={log.id}
                    id={`work-log-${log.public_id}`}
                    tabIndex={-1}
                    className="log-row group"
                  >
                    <span className="log-dot" aria-hidden="true" />
                    <div className="log-card-header">
                      <time className="log-card-time" dateTime={log.created_at}>{log.created_at.slice(0, 16).replace('T', ' ')}</time>
                      {deletingId === log.id ? (
                        <div className="log-delete-confirm" role="group" aria-label={t('worklog.deleteAria')}>
                          <button type="button" onClick={() => void handleDelete(log.id)}>{t('common.confirm')}</button>
                          <button type="button" onClick={() => setDeletingId(null)}>{t('common.cancel')}</button>
                        </div>
                      ) : (
                        <div className="log-card-menu">
                          <button
                            type="button"
                            className="log-menu-trigger"
                            onClick={() => setOpenMenuId((current) => current === log.id ? null : log.id)}
                            aria-label={t('worklog.moreActions')}
                            aria-haspopup="menu"
                            aria-expanded={openMenuId === log.id}
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </button>
                          {openMenuId === log.id && (
                            <div className="log-card-menu-popover" role="menu">
                              <button type="button" role="menuitem" onClick={() => { setOpenMenuId(null); void window.api.worklogEditor.open(log.public_id) }}>
                                <Pencil aria-hidden="true" />{t('worklog.edit')}
                              </button>
                              <button type="button" role="menuitem" onClick={() => { setOpenMenuId(null); setDeletingId(log.id) }}>
                                <Trash2 aria-hidden="true" />{t('common.delete')}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                     <div className="log-content">
                           <div className="log-content-markdown">
                             <InteractiveMarkdown
                               content={log.content}
                               projectId={log.project_id}
                               projectName={projects.find((project) => project.public_id === log.project_id)?.name}
                               selectedProjectId={projectFilter}
                               selectedTagPath={tagFilter}
                               onProjectClick={handleProjectSelect}
                               onTagClick={handleTagSelect}
                             />
                           </div>
                           {log.category && (
                             <div className="log-associations" aria-label={t('workspace.associations')}>
                                <span className="log-category">
                                  {log.category}
                                </span>
                            </div>
                          )}
                        </div>
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
        </main>
      </div>
      <datalist id="worklog-category-suggestions">
        {categorySuggestions.map((category) => <option key={category} value={`#${category}`} />)}
      </datalist>
    </div>
  )
}

export default WorkLogPage
