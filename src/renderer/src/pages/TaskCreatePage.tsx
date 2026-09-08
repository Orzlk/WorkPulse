import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Calendar, Check, Plus, Trash2, X } from 'lucide-react'
import { extractHashTags } from '../lib/workspaceInteractions'
import { useI18n, useLanguageStore } from '../stores/languageStore'
import { useThemeStore } from '../stores/themeStore'
import { useProjectStore } from '../stores/projectStore'
import type { ChecklistItem, TaskPriority } from '../lib/kanbanTypes'
import type { TaskCreateDraft } from '../lib/taskCreateRoute'

function TaskCreatePage({ draft }: { draft: TaskCreateDraft | null }): JSX.Element {
  const [title, setTitle] = useState(draft?.content ?? '')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>(draft?.priority ?? 'medium')
  const [dueDate, setDueDate] = useState('')
  const [projectId, setProjectId] = useState(draft?.projectId ?? '')
  const [tags, setTags] = useState('')
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [checklistDraft, setChecklistDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const initTheme = useThemeStore((state) => state.init)
  const initLanguage = useLanguageStore((state) => state.init)
  const projects = useProjectStore((state) => state.items)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const { t } = useI18n()

  useEffect(() => {
    void initTheme()
    void initLanguage()
    void fetchProjects()
    titleRef.current?.focus()
  }, [fetchProjects, initLanguage, initTheme])

  useLayoutEffect(() => {
    const textarea = descriptionRef.current
    if (!textarea) return
    const maxHeight = 360
    textarea.style.height = 'auto'
    const contentHeight = Math.max(textarea.scrollHeight, 120)
    textarea.style.height = `${Math.min(contentHeight, maxHeight)}px`
    textarea.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden'
  }, [description])

  const isDirty = Boolean(
    title.trim() ||
    description.trim() ||
    priority !== 'medium' ||
    dueDate ||
    projectId ||
    tags.trim() ||
    checklist.length > 0 ||
    checklistDraft.trim()
  )

  useEffect(() => {
    window.api.taskCreateWindow.setDirty(isDirty)
    return () => window.api.taskCreateWindow.setDirty(false)
  }, [isDirty])

  useEffect(() => window.api.on.taskCreateDraft((nextDraft) => {
    setTitle(nextDraft.content)
    setProjectId(nextDraft.projectId)
    setPriority(nextDraft.priority)
  }), [])

  const handleSave = async (): Promise<void> => {
    const normalizedTitle = title.trim()
    if (!normalizedTitle || saving) return

    setSaving(true)
    setError('')
    try {
      const task = await window.api.task.add(
        normalizedTitle,
        description.trim() || undefined,
        'todo',
        undefined,
        { project_id: projectId || null, tag_names: extractHashTags(tags).tags },
        priority,
        dueDate || null,
        checklist
      )
      window.api.taskCreateWindow.setDirty(false)
      window.api.taskCreateWindow.notifyChanged(task.public_id)
      window.api.taskCreateWindow.close(true)
    } catch {
      setError(t('kanban.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    descriptionRef.current?.focus()
  }

  const handleDescriptionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void handleSave()
    }
  }

  const addChecklistItem = (): void => {
    const text = checklistDraft.trim()
    if (!text) return
    setChecklist((items) => [...items, { id: `item-${Date.now()}-${items.length + 1}`, text: text.slice(0, 500), completed: false }])
    setChecklistDraft('')
  }

  const handleChecklistKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    addChecklistItem()
  }

  return (
    <div className="worklog-editor-window task-create-window">
      <header className="worklog-editor-header">
        <div>
          <h1>{t('kanban.newTaskTitle')}</h1>
        </div>
      </header>

      <main className="worklog-editor-main task-create-main">
        <label className="task-create-field">
          <span>{t('kanban.taskTitle')}</span>
          <input ref={titleRef} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} onKeyDown={handleTitleKeyDown} placeholder={t('kanban.newTaskTitlePlaceholder')} disabled={saving} />
        </label>

        <label className="task-create-field task-create-description-field">
          <span>{t('kanban.descriptionPlaceholder')}</span>
          <textarea ref={descriptionRef} value={description} maxLength={20000} onChange={(event) => setDescription(event.target.value)} onKeyDown={handleDescriptionKeyDown} placeholder={t('kanban.newDescriptionPlaceholder')} rows={4} disabled={saving} />
          <em>{t('kanban.newTaskDescriptionHelp')}</em>
        </label>

        <section className="task-create-checklist" aria-label={t('kanban.checklist')}>
          <div className="task-create-checklist-header">
            <span>{t('kanban.checklist')}</span>
            <small>{checklist.filter((item) => item.completed).length}/{checklist.length}</small>
          </div>
          {checklist.length > 0 && <div className="task-create-checklist-items">
            {checklist.map((item) => <div className="task-create-checklist-item" key={item.id}>
              <label>
                <input type="checkbox" checked={item.completed} onChange={(event) => setChecklist((items) => items.map((current) => current.id === item.id ? { ...current, completed: event.target.checked } : current))} disabled={saving} />
                <span className={item.completed ? 'is-completed' : ''}>{item.text}</span>
              </label>
              <button type="button" onClick={() => setChecklist((items) => items.filter((current) => current.id !== item.id))} aria-label={t('kanban.removeChecklist')} disabled={saving}><Trash2 aria-hidden="true" /></button>
            </div>)}
          </div>}
          <div className="task-create-checklist-composer">
            <input value={checklistDraft} onChange={(event) => setChecklistDraft(event.target.value)} onKeyDown={handleChecklistKeyDown} placeholder={t('kanban.checklistPlaceholder')} disabled={saving} />
            <button type="button" onClick={addChecklistItem} aria-label={t('kanban.addChecklist')} disabled={saving || !checklistDraft.trim()}><Plus aria-hidden="true" /></button>
          </div>
        </section>

        <section className="task-create-properties" aria-label={t('kanban.taskProperties')}>
          <label className="task-create-field">
            <span>{t('kanban.priority')}</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)} disabled={saving}>
              <option value="high">{t('kanban.priorityHigh')}</option>
              <option value="medium">{t('kanban.priorityMedium')}</option>
              <option value="low">{t('kanban.priorityLow')}</option>
            </select>
          </label>
          <label className="task-create-field">
            <span>{t('kanban.dueDate')}</span>
            <span className="task-create-date-input">
              <Calendar aria-hidden="true" />
              <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={saving} />
            </span>
          </label>
          <label className="task-create-field">
            <span>{t('workspace.project')}</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={saving}>
              <option value="">{t('workspace.unassigned')}</option>
              {projects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}
            </select>
          </label>
          <label className="task-create-field task-create-tags-field">
            <span>{t('workspace.tags')}</span>
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder={t('workspace.tagsPlaceholder')} disabled={saving} />
          </label>
        </section>

        {error && <p className="worklog-editor-error" role="alert">{error}</p>}
      </main>

      <footer className="worklog-editor-footer task-create-footer">
        <span className="worklog-editor-hint">{t('kanban.newTaskShortcut')}</span>
        <div className="worklog-editor-actions">
          <button type="button" onClick={() => window.api.taskCreateWindow.close(true)} className="worklog-editor-secondary-button" disabled={saving}>
            <X aria-hidden="true" />{t('common.cancel')}
          </button>
          <button type="button" onClick={() => void handleSave()} className="worklog-editor-primary-button" disabled={saving || !title.trim()}>
            <Check aria-hidden="true" />{saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </footer>
    </div>
  )
}

export default TaskCreatePage
