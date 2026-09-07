import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Check, Image, X } from 'lucide-react'
import { useToast } from '../components/Toast'
import { TagHighlightTextarea } from '../components/TagHighlightTextarea'
import { MarkdownToolbar } from '../components/MarkdownToolbar'
import { useI18n, useLanguageStore } from '../stores/languageStore'
import { useThemeStore } from '../stores/themeStore'
import { useProjectStore } from '../stores/projectStore'
import { extractHashTags, findProjectMention, findTagMention, replaceProjectMention, syncProjectReference, type ProjectMentionRange } from '../lib/workspaceInteractions'
import { resolveOrCreateProjectReference } from '../lib/projectMentions'
import { getMentionMenuPosition, getTextareaCaretPosition, type MentionMenuPosition } from '../lib/mentionMenuPosition'
import { loadAllPages } from '../lib/tagPaging'
import { getLocalDateKey } from '../lib/dateUtils'
import type { Tag } from '../lib/workspaceTypes'

interface WorkLog {
  id: number
  public_id: string
  content: string
  category: string
  created_at: string
  project_id: string | null
  tag_names: string[]
}

interface WorkLogEditorPageProps {
  publicId: string
}

interface EditorValues {
  content: string
  category: string
  date: string
  projectId: string
}

function serializeEditorValues(values: EditorValues): string {
  return JSON.stringify(values)
}

function WorkLogEditorPage({ publicId }: WorkLogEditorPageProps): JSX.Element {
  const [log, setLog] = useState<WorkLog | null>(null)
  const [content, setContent] = useState('')
  const [category, setCategory] = useState('')
  const [date, setDate] = useState('')
  const [projectId, setProjectId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [projectMention, setProjectMention] = useState<ProjectMentionRange | null>(null)
  const [tagMention, setTagMention] = useState<ProjectMentionRange | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [tagOptions, setTagOptions] = useState<Tag[]>([])
  const [mentionPosition, setMentionPosition] = useState<MentionMenuPosition | null>(null)
  const [mentionPositionTick, setMentionPositionTick] = useState(0)
  const [attachmentSaving, setAttachmentSaving] = useState(false)
  const initialValuesRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const contentShellRef = useRef<HTMLDivElement>(null)
  const mentionMenuRef = useRef<HTMLDivElement>(null)
  const initTheme = useThemeStore((state) => state.init)
  const initLanguage = useLanguageStore((state) => state.init)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const projects = useProjectStore((state) => state.items)
  const createProject = useProjectStore((state) => state.create)
  const toast = useToast()
  const { t } = useI18n()

  const projectSuggestions = useMemo(() => {
    if (!projectMention) return []
    const query = projectMention.query.trim().toLocaleLowerCase()
    return projects
      .filter((project) => !query || project.name.toLocaleLowerCase().includes(query))
      .slice(0, 8)
  }, [projectMention, projects])

  const tagSuggestions = useMemo(() => {
    if (!tagMention) return []
    const query = tagMention.query.trim().toLocaleLowerCase()
    return tagOptions
      .filter((tag) => !query || tag.path.toLocaleLowerCase().includes(query))
      .slice(0, 8)
  }, [tagMention, tagOptions])

  const values: EditorValues = { content, category, date, projectId }
  const isDirty = Boolean(log && initialValuesRef.current && serializeEditorValues(values) !== initialValuesRef.current)

  useEffect(() => {
    void initTheme()
    void initLanguage()
    void fetchProjects()
    void loadAllPages((pagination) => window.api.tag.list(pagination)).then((items) => setTagOptions(items)).catch(() => setTagOptions([]))
  }, [fetchProjects, initLanguage, initTheme])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void window.api.worklog.get(publicId).then((loadedLog) => {
      if (!active) return
      if (!loadedLog) {
        setError(t('worklog.editorNotFound'))
        setLoading(false)
        return
      }
      const nextValues: EditorValues = {
        content: loadedLog.content,
        category: loadedLog.category,
        date: getLocalDateKey(loadedLog.created_at),
        projectId: loadedLog.project_id ?? ''
      }
      initialValuesRef.current = serializeEditorValues(nextValues)
      setLog(loadedLog)
      setContent(nextValues.content)
      setCategory(nextValues.category)
      setDate(nextValues.date)
      setProjectId(nextValues.projectId)
      setLoading(false)
    }).catch(() => {
      if (!active) return
      setError(t('worklog.editorLoadFailed'))
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [publicId])

  useEffect(() => {
    window.api.worklogEditor.setDirty(isDirty)
    return () => window.api.worklogEditor.setDirty(false)
  }, [isDirty])

  const syncEditorMention = (value: string, cursor: number): void => {
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

  const handleEditorChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = event.target.value
    setContent(value)
    syncEditorMention(value, event.target.selectionStart)
  }

  const insertEditorText = (text: string): void => {
    const textarea = inputRef.current
    if (!textarea) {
      setContent((current) => `${current}${text}`)
      return
    }
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const next = `${content.slice(0, start)}${text}${content.slice(end)}`
    setContent(next)
    syncEditorMention(next, start + text.length)
    requestAnimationFrame(() => {
      textarea.focus()
      const cursor = start + text.length
      textarea.setSelectionRange(cursor, cursor)
    })
  }

  const insertEditorAttachment = async (file: File): Promise<void> => {
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
      insertEditorText(`![${saved.fileName}](${saved.url})`)
    } catch {
      setError(t('worklog.saveError'))
    } finally {
      setAttachmentSaving(false)
    }
  }

  const handleEditorPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>): void => {
    const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/'))
    if (!image) return
    event.preventDefault()
    void insertEditorAttachment(image)
  }

  const handleEditorDrop = (event: ReactDragEvent<HTMLTextAreaElement>): void => {
    event.preventDefault()
    const image = Array.from(event.dataTransfer.files).find((file) => file.type.startsWith('image/'))
    if (image) void insertEditorAttachment(image)
  }

  const selectProjectMention = (projectPublicId: string): void => {
    if (!projectMention) return
    const project = projects.find((item) => item.public_id === projectPublicId)
    if (!project) return
    const next = replaceProjectMention(content, projectMention, `@${project.name}`)
    setContent(next.text)
    setProjectId(project.public_id)
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
    const next = replaceProjectMention(content, tagMention, `#${tagPath}`)
    setContent(next.text)
    setTagMention(null)
    setProjectMention(null)
    requestAnimationFrame(() => {
      const textarea = inputRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(next.cursor, next.cursor)
    })
  }

  const handleProjectChange = (nextProjectId: string): void => {
    setProjectId(nextProjectId)
    setContent(syncProjectReference(content, projects, nextProjectId || null))
  }

  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    const activeMention = projectMention ?? tagMention
    const activeSuggestions = projectMention ? projectSuggestions : tagSuggestions
    if (event.key === 'Escape' && activeMention) {
      event.preventDefault()
      setProjectMention(null)
      setTagMention(null)
      return
    }
    if (activeMention && activeSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMentionIndex((current) => (current + 1) % activeSuggestions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionIndex((current) => (current - 1 + activeSuggestions.length) % activeSuggestions.length)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        if (projectMention) {
          selectProjectMention(projectSuggestions[mentionIndex]?.public_id ?? projectSuggestions[0].public_id)
        } else {
          selectTagMention(tagSuggestions[mentionIndex]?.path ?? tagSuggestions[0].path)
        }
        return
      }
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleSave()
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!log) return
    const trimmedContent = content.trim()
    if (!trimmedContent) {
      setError(t('worklog.emptyError'))
      return
    }

    setSaving(true)
    setError('')
    try {
      const mentionedProjectId = await resolveOrCreateProjectReference(trimmedContent, projects, createProject)
      const updated = await window.api.worklog.update(
        log.id,
        trimmedContent,
          category.trim(),
          date ? `${date}${log.created_at.slice(10)}` : undefined,
          {
          project_id: mentionedProjectId ?? (projectId || null),
          tag_names: extractHashTags(trimmedContent).tags
          }
      )
      if (!updated) {
        setError(t('worklog.saveError'))
        return
      }
      toast.success(t('worklog.editSave'))
      window.api.worklogEditor.setDirty(false)
      window.api.worklogEditor.notifyChanged(updated.public_id)
      window.api.worklogEditor.close()
    } catch {
      setError(t('worklog.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = (): void => {
    window.api.worklogEditor.close()
  }

  const activeMention = projectMention ?? tagMention
  const activeSuggestions = projectMention ? projectSuggestions : tagSuggestions
  const mentionMenuId = projectMention ? 'worklog-project-mention-list' : 'worklog-tag-mention-list'

  useLayoutEffect(() => {
    if (!activeMention) {
      setMentionPosition(null)
      return
    }
    const textarea = inputRef.current
    const container = contentShellRef.current
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

  if (loading) {
    return <div className="worklog-editor-window" role="status">{t('common.loading')}</div>
  }

  if (!log) {
    return (
      <div className="worklog-editor-window">
        <div className="worklog-editor-empty">
          <p>{error || t('worklog.editorNotFound')}</p>
          <button type="button" onClick={handleCancel} className="worklog-editor-secondary-button">{t('common.close')}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="worklog-editor-window">
      <header className="worklog-editor-header">
        <div>
          <h1>{t('worklog.editorTitle')}</h1>
        </div>
        <span className={`worklog-editor-status ${isDirty ? 'is-dirty' : ''}`}>
          {isDirty ? t('worklog.editorUnsaved') : t('common.saved')}
        </span>
      </header>

      <main className="worklog-editor-main">
        <section className="worklog-editor-property-bar" aria-label={t('workspace.associations')}>
          <label>
            <span>{t('workspace.project')}</span>
            <select value={projectId} onChange={(event) => handleProjectChange(event.target.value)}>
              <option value="">{t('workspace.unassigned')}</option>
              {projects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}
            </select>
          </label>
          <div className="worklog-editor-property-tags">
            <span>{t('workspace.tags')}</span>
            <div className="worklog-editor-tag-list">
              {extractHashTags(content).tags.length > 0
                ? extractHashTags(content).tags.map((tag) => <span key={tag}>#{tag}</span>)
                : <em>{t('workspace.noTags')}</em>}
            </div>
          </div>
          <label>
            <span>{t('worklog.category')}</span>
            <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="#tag" />
          </label>
          <label>
            <span>{t('common.date')}</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        </section>
        <label htmlFor="worklog-editor-content" className="worklog-editor-label">{t('worklog.editorContentLabel')}</label>
        <div ref={contentShellRef} className="worklog-editor-content-shell">
          <TagHighlightTextarea
            ref={inputRef}
            id="worklog-editor-content"
            value={content}
            onChange={handleEditorChange}
            onKeyDown={handleEditorKeyDown}
            onPaste={handleEditorPaste}
            onDrop={handleEditorDrop}
            onDragOver={(event) => event.preventDefault()}
            onSelect={() => setMentionPositionTick((current) => current + 1)}
            onScroll={() => setMentionPositionTick((current) => current + 1)}
            placeholder={t('worklog.editorContentPlaceholder')}
            className="worklog-editor-composer"
            autoGrow
            autoGrowMinHeight={220}
            autoGrowMaxHeight={560}
            aria-controls={activeMention ? mentionMenuId : undefined}
            aria-expanded={Boolean(activeMention)}
            autoFocus
          />
          <input
            ref={attachmentInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const image = event.target.files?.[0]
              if (image) void insertEditorAttachment(image)
              event.currentTarget.value = ''
            }}
          />
          {activeMention && (
            <div ref={mentionMenuRef} id={mentionMenuId} style={mentionPosition ? { left: mentionPosition.left, top: mentionPosition.top } : undefined} className={`project-mention-menu worklog-mention-menu worklog-editor-mention-menu ${tagMention ? 'tag-mention-menu' : ''}`} role="listbox" aria-label={t(projectMention ? 'worklog.projectMentionSuggestions' : 'worklog.tagMentionSuggestions')}>
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
        </div>

        <MarkdownToolbar
          textareaRef={inputRef}
          value={content}
          className="worklog-editor-markdown-toolbar"
          onChange={(next, cursor) => {
            setContent(next)
            syncEditorMention(next, cursor)
          }}
        />

        {error && <p className="worklog-editor-error" role="alert">{error}</p>}
      </main>

      <footer className="worklog-editor-footer">
        <span className="worklog-editor-hint">{t('worklog.editorShortcut')}</span>
        <div className="worklog-editor-actions">
          <button type="button" onClick={() => attachmentInputRef.current?.click()} className="worklog-editor-secondary-button" disabled={saving || attachmentSaving} title={t('worklog.insertImage')}>
            <Image aria-hidden="true" />{t('worklog.insertImage')}
          </button>
          <button type="button" onClick={handleCancel} className="worklog-editor-secondary-button" disabled={saving}>
            <X aria-hidden="true" />{t('worklog.editCancel')}
          </button>
          <button type="button" onClick={() => void handleSave()} className="worklog-editor-primary-button" disabled={saving}>
            <Check aria-hidden="true" />{saving ? t('common.saving') : t('worklog.editSave')}
          </button>
        </div>
      </footer>
    </div>
  )
}

export default WorkLogEditorPage
