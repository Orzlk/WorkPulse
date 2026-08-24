import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Check, X } from 'lucide-react'
import { useToast } from '../components/Toast'
import { TagHighlightTextarea } from '../components/TagHighlightTextarea'
import { useI18n, useLanguageStore } from '../stores/languageStore'
import { useThemeStore } from '../stores/themeStore'
import { useProjectStore } from '../stores/projectStore'
import { useRepositoryStore } from '../stores/repositoryStore'
import { extractHashTags, findProjectMention, findTagMention, replaceProjectMention, type ProjectMentionRange } from '../lib/workspaceInteractions'
import { getMentionMenuPosition, getTextareaCaretPosition, type MentionMenuPosition } from '../lib/mentionMenuPosition'
import type { Tag } from '../lib/workspaceTypes'

interface WorkLog {
  id: number
  public_id: string
  content: string
  category: string
  created_at: string
  project_id: string | null
  repository_id: string | null
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
  repositoryId: string
  tagsInput: string
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
  const [repositoryId, setRepositoryId] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [projectMention, setProjectMention] = useState<ProjectMentionRange | null>(null)
  const [tagMention, setTagMention] = useState<ProjectMentionRange | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [tagOptions, setTagOptions] = useState<Tag[]>([])
  const [mentionPosition, setMentionPosition] = useState<MentionMenuPosition | null>(null)
  const [mentionPositionTick, setMentionPositionTick] = useState(0)
  const initialValuesRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const contentShellRef = useRef<HTMLDivElement>(null)
  const mentionMenuRef = useRef<HTMLDivElement>(null)
  const initTheme = useThemeStore((state) => state.init)
  const initLanguage = useLanguageStore((state) => state.init)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const projects = useProjectStore((state) => state.items)
  const fetchRepositories = useRepositoryStore((state) => state.fetch)
  const repositories = useRepositoryStore((state) => state.items)
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

  const values: EditorValues = { content, category, date, projectId, repositoryId, tagsInput }
  const isDirty = Boolean(log && initialValuesRef.current && serializeEditorValues(values) !== initialValuesRef.current)

  useEffect(() => {
    void initTheme()
    void initLanguage()
    void fetchProjects()
    void fetchRepositories()
    void window.api.tag.list({ limit: 200, offset: 0 }).then((page) => setTagOptions(page.items)).catch(() => setTagOptions([]))
  }, [fetchProjects, fetchRepositories, initLanguage, initTheme])

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
        date: loadedLog.created_at.slice(0, 10),
        projectId: loadedLog.project_id ?? '',
        repositoryId: loadedLog.repository_id ?? '',
        tagsInput: loadedLog.tag_names.map((tag) => `#${tag}`).join(' ')
      }
      initialValuesRef.current = serializeEditorValues(nextValues)
      setLog(loadedLog)
      setContent(nextValues.content)
      setCategory(nextValues.category)
      setDate(nextValues.date)
      setProjectId(nextValues.projectId)
      setRepositoryId(nextValues.repositoryId)
      setTagsInput(nextValues.tagsInput)
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
      const updated = await window.api.worklog.update(
        log.id,
        trimmedContent,
        category.trim(),
        date ? `${date}${log.created_at.slice(10)}` : undefined,
        {
          project_id: projectId || null,
          repository_id: repositoryId || null,
          tag_names: extractHashTags(`${trimmedContent} ${tagsInput}`).tags
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
          <p>{t('worklog.editorSubtitle')}</p>
        </div>
        <span className={`worklog-editor-status ${isDirty ? 'is-dirty' : ''}`}>
          {isDirty ? t('worklog.editorUnsaved') : t('common.saved')}
        </span>
      </header>

      <main className="worklog-editor-main">
        <label htmlFor="worklog-editor-content" className="worklog-editor-label">{t('worklog.editorContentLabel')}</label>
        <div ref={contentShellRef} className="worklog-editor-content-shell">
          <TagHighlightTextarea
            ref={inputRef}
            id="worklog-editor-content"
            value={content}
            onChange={handleEditorChange}
            onKeyDown={handleEditorKeyDown}
            onSelect={() => setMentionPositionTick((current) => current + 1)}
            onScroll={() => setMentionPositionTick((current) => current + 1)}
            placeholder={t('worklog.editorContentPlaceholder')}
            className="worklog-editor-composer"
            aria-controls={activeMention ? mentionMenuId : undefined}
            aria-expanded={Boolean(activeMention)}
            autoFocus
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

        <section className="worklog-editor-associations" aria-label={t('workspace.associations')}>
          <label>
            <span>{t('workspace.project')}</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">{t('workspace.unassigned')}</option>
              {projects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}
            </select>
          </label>
          <label>
            <span>{t('workspace.repository')}</span>
            <select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
              <option value="">{t('workspace.unassigned')}</option>
              {repositories.map((repository) => <option key={repository.public_id} value={repository.public_id}>{repository.name}</option>)}
            </select>
          </label>
          <label>
            <span>{t('workspace.tags')}</span>
            <input value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} placeholder={t('workspace.tagsPlaceholder')} />
          </label>
          <label>
            <span>{t('worklog.category')}</span>
            <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="#tag" />
          </label>
          <label>
            <span>{t('common.date')}</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        </section>
        {error && <p className="worklog-editor-error" role="alert">{error}</p>}
      </main>

      <footer className="worklog-editor-footer">
        <span className="worklog-editor-hint">{t('worklog.editorShortcut')}</span>
        <div className="worklog-editor-actions">
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
