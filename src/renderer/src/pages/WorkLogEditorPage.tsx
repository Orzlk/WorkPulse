import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { useToast } from '../components/Toast'
import { useI18n, useLanguageStore } from '../stores/languageStore'
import { useThemeStore } from '../stores/themeStore'
import { useProjectStore } from '../stores/projectStore'
import { useRepositoryStore } from '../stores/repositoryStore'
import { extractHashTags } from '../lib/workspaceInteractions'

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
  const initialValuesRef = useRef<string | null>(null)
  const initTheme = useThemeStore((state) => state.init)
  const initLanguage = useLanguageStore((state) => state.init)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const projects = useProjectStore((state) => state.items)
  const fetchRepositories = useRepositoryStore((state) => state.fetch)
  const repositories = useRepositoryStore((state) => state.items)
  const toast = useToast()
  const { t } = useI18n()

  const values: EditorValues = { content, category, date, projectId, repositoryId, tagsInput }
  const isDirty = Boolean(log && initialValuesRef.current && serializeEditorValues(values) !== initialValuesRef.current)

  useEffect(() => {
    void initTheme()
    void initLanguage()
    void fetchProjects()
    void fetchRepositories()
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
        <textarea
          id="worklog-editor-content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              void handleSave()
            }
          }}
          placeholder={t('worklog.editorContentPlaceholder')}
          className="worklog-editor-textarea"
          autoFocus
        />

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
