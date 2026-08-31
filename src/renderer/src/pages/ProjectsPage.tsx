import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, ChevronDown, Ellipsis, FolderKanban, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useToast } from '../components/Toast'
import { useProjectStore } from '../stores/projectStore'
import { useI18n } from '../stores/languageStore'
import { WorkspacePageHeader } from '../components/WorkspacePageHeader'
import { WorkspaceSectionTabs } from '../components/WorkspaceSectionTabs'
import { ProjectActivityTimeline } from '../components/ProjectActivityTimeline'
import { TaskDetailDrawer } from '../components/TaskDetailDrawer'
import type { AsyncStatus, Project, ProjectActivityItem } from '../lib/workspaceTypes'
import type { KanbanColumn, KanbanTask, TaskUpdates } from '../lib/kanbanTypes'
import { PROJECT_COLOR_OPTIONS } from '../lib/projectColors'

function ProjectColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }): JSX.Element {
  const { t } = useI18n()
  const pickerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const selectedOption = PROJECT_COLOR_OPTIONS.find((option) => value.toLowerCase() === option.value)
  const selectedLabel = selectedOption ? t(selectedOption.labelKey) : t('workspace.customColor')

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && pickerRef.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const selectColor = (nextColor: string): void => {
    onChange(nextColor)
    setOpen(false)
  }

  return <div className="project-color-picker" ref={pickerRef}>
    <button
      type="button"
      className="project-color-trigger"
      onClick={() => setOpen((current) => !current)}
      aria-label={`${t('workspace.chooseColor')}: ${selectedLabel}`}
      title={selectedLabel}
      aria-haspopup="dialog"
      aria-expanded={open}
    >
      <span className="project-color-trigger-swatch" style={{ backgroundColor: value }} aria-hidden="true" />
      <ChevronDown aria-hidden="true" />
    </button>
    {open && <div className="project-color-popover" role="dialog" aria-label={t('workspace.colorPalette')}>
      <div className="project-color-options" role="radiogroup" aria-label={t('workspace.colorPalette')}>
        {PROJECT_COLOR_OPTIONS.map((option) => {
          const selected = value.toLowerCase() === option.value
          return <button
            key={option.value}
            type="button"
            className={`project-color-swatch ${selected ? 'is-selected' : ''}`}
            style={{ backgroundColor: option.value }}
            onClick={() => selectColor(option.value)}
            aria-label={t(option.labelKey)}
            aria-pressed={selected}
            title={t(option.labelKey)}
          />
        })}
        <label className="project-custom-color">
          <span>{t('workspace.customColor')}</span>
          <input type="color" value={value} onChange={(event) => selectColor(event.target.value)} aria-label={t('workspace.customColor')} />
        </label>
      </div>
      <code>{value.toUpperCase()}</code>
    </div>}
  </div>
}

function ProjectsPage({ onOpenReports, onOpenRepositories }: { onOpenReports: (projectId: string) => void; onOpenRepositories?: () => void }): JSX.Element {
  const { items, total, status, error, fetch, loadMore, create, update, archive } = useProjectStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(PROJECT_COLOR_OPTIONS[0].value)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editColor, setEditColor] = useState(PROJECT_COLOR_OPTIONS[0].value)
  const [savingEdit, setSavingEdit] = useState(false)
  const [activityItems, setActivityItems] = useState<ProjectActivityItem[]>([])
  const [activityStatus, setActivityStatus] = useState<AsyncStatus>('idle')
  const [activityReloadKey, setActivityReloadKey] = useState(0)
  const [activeTask, setActiveTask] = useState<KanbanTask | null>(null)
  const [taskColumns, setTaskColumns] = useState<KanbanColumn[]>([])
  const [taskLoading, setTaskLoading] = useState(false)
  const toast = useToast()
  const { t } = useI18n()
  const selectedProject = items.find((project) => project.public_id === selectedProjectId) ?? null

  useEffect(() => { void fetch() }, [])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && projectMenuId) {
        setProjectMenuId(null)
        return
      }
      if (event.key === 'Escape' && selectedProjectId && !activeTask) {
        setSelectedProjectId(null)
        setEditing(false)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [activeTask, projectMenuId, selectedProjectId])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Element && !event.target.closest('.project-menu')) setProjectMenuId(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  useEffect(() => {
    if (!selectedProjectId) {
      setActivityItems([])
      setActivityStatus('idle')
      return
    }
    let cancelled = false
    setActivityStatus('running')
    void window.api.project.activity(selectedProjectId).then((items) => {
      if (cancelled) return
      setActivityItems(items)
      setActivityStatus('success')
    }).catch(() => {
      if (!cancelled) setActivityStatus('error')
    })
    return () => { cancelled = true }
  }, [activityReloadKey, selectedProjectId])

  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    try {
      await create({ name: name.trim(), description: description.trim(), color })
      setName('')
      setDescription('')
      toast.success(t('workspace.projectCreated'))
    } catch {
      toast.error(t('workspace.projectCreateFailed'))
    }
  }

  const openProject = (project: Project): void => {
    setProjectMenuId(null)
    setSelectedProjectId(project.public_id)
    setEditing(false)
    setEditName(project.name)
    setEditDescription(project.description)
    setEditColor(project.color)
  }

  const startEdit = (): void => {
    if (!selectedProject) return
    setEditName(selectedProject.name)
    setEditDescription(selectedProject.description)
    setEditColor(selectedProject.color)
    setEditing(true)
  }

  const saveEdit = async (): Promise<void> => {
    if (!selectedProject || !editName.trim()) return
    setSavingEdit(true)
    try {
      await update(selectedProject.public_id, {
        name: editName.trim(),
        description: editDescription.trim(),
        color: editColor
      })
      setEditing(false)
      toast.success(t('workspace.projectUpdated'))
    } catch {
      toast.error(t('workspace.projectUpdateFailed'))
    } finally {
      setSavingEdit(false)
    }
  }

  const handleOpenTask = async (publicId: string): Promise<void> => {
    if (taskLoading) return
    setTaskLoading(true)
    try {
      const [task, columns] = await Promise.all([window.api.task.get(publicId), window.api.kanban.columns.list()])
      if (task) {
        setTaskColumns(columns)
        setActiveTask(task as KanbanTask)
      }
    } catch {
      toast.error(t('kanban.saveFailed'))
    } finally {
      setTaskLoading(false)
    }
  }

  const handleTaskSave = async (id: number, updates: TaskUpdates): Promise<void> => {
    try {
      const updated = await window.api.task.update(id, updates)
      if (!updated) throw new Error('Task not found')
      void fetch()
      setActivityReloadKey((value) => value + 1)
    } catch (error) {
      toast.error(t('kanban.saveFailed'))
      throw error
    }
  }

  const handleTaskMove = async (id: number, target: string): Promise<void> => {
    const status = target === 'draft' ? 'draft' : taskColumns.find((column) => column.column_key === target)?.status
    if (!status) return
    try {
      const updated = await window.api.task.update(id, { board_column: target, status })
      if (!updated) throw new Error('Task not found')
      setActiveTask(null)
      void fetch()
      setActivityReloadKey((value) => value + 1)
    } catch {
      toast.error(t('kanban.saveFailed'))
    }
  }

  const handleTaskReopen = async (id: number): Promise<void> => {
    try {
      const updated = await window.api.task.update(id, { board_column: 'todo', status: 'todo' })
      if (!updated) throw new Error('Task not found')
      setActiveTask(null)
      void fetch()
      setActivityReloadKey((value) => value + 1)
      toast.success(t('kanban.reopenedToast'))
    } catch {
      toast.error(t('kanban.moveFailed'))
    }
  }

  const handleTaskDelete = async (id: number): Promise<void> => {
    const task = activeTask?.id === id ? activeTask : null
    if (!task || !window.confirm(t('kanban.deleteTaskConfirm', { title: task.title }))) return
    try {
      const deleted = await window.api.task.delete(id)
      if (!deleted) throw new Error('Task not found')
      setActiveTask(null)
      void fetch()
      setActivityReloadKey((value) => value + 1)
    } catch {
      toast.error(t('kanban.deleteFailed'))
    }
  }

  const handleDeleteProject = async (project: Project): Promise<void> => {
    setProjectMenuId(null)
    if (!window.confirm(t('workspace.deleteProjectConfirm', { name: project.name }))) return
    try {
      await archive(project.public_id)
      if (selectedProjectId === project.public_id) closeProject()
      toast.success(t('workspace.projectDeleted'))
    } catch {
      toast.error(t('workspace.projectDeleteFailed'))
    }
  }

  const openProjectEditor = (project: Project): void => {
    openProject(project)
    setEditing(true)
  }

  const closeProject = (): void => {
    setSelectedProjectId(null)
    setEditing(false)
  }

  return <div className="workspace-page">
    <WorkspacePageHeader ariaLabel={t('workspace.breadcrumbLabel')} items={[{ label: t('nav.projects'), current: true }]} title={t('workspace.projectsTitle')} description={t('workspace.projectsSubtitle')} />
    <WorkspaceSectionTabs ariaLabel={t('workspace.sectionNavigation')} items={[{ id: 'projects', label: t('nav.projects'), active: true }, { id: 'repositories', label: t('nav.repositories'), onClick: onOpenRepositories }]} />
    <section className="project-create"><label>{t('workspace.projectName')}<input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('workspace.projectNamePlaceholder')} /></label><label>{t('workspace.projectDescription')}<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('workspace.optional')} /></label><div className="project-color-field"><span>{t('workspace.color')}</span><ProjectColorPicker value={color} onChange={setColor} /></div><button className="primary-action" onClick={() => void submit()} disabled={!name.trim()}><Plus aria-hidden="true" />{t('common.create')}</button></section>
    {status === 'error' && <div className="inline-error" role="alert">{error ? t(error as Parameters<typeof t>[0]) : ''}<button onClick={() => void fetch()}>{t('common.retry')}</button></div>}
    <section className="project-grid">{items.map((project) => <article className="project-card" key={project.public_id}>
      <div className="project-menu">
        <button
          type="button"
          className="project-menu-trigger"
          onClick={(event) => {
            event.stopPropagation()
            setProjectMenuId((current) => current === project.public_id ? null : project.public_id)
          }}
          aria-label={t('workspace.projectMenu', { name: project.name })}
          title={t('workspace.projectMenu', { name: project.name })}
          aria-haspopup="menu"
          aria-expanded={projectMenuId === project.public_id}
        >
          <Ellipsis aria-hidden="true" />
        </button>
        {projectMenuId === project.public_id && <div className="project-menu-panel" role="menu">
          <button type="button" role="menuitem" onClick={() => openProjectEditor(project)}><Pencil aria-hidden="true" />{t('workspace.editProject')}</button>
          <button type="button" role="menuitem" className="danger-action" onClick={() => void handleDeleteProject(project)}><Trash2 aria-hidden="true" />{t('workspace.deleteProject')}</button>
        </div>}
      </div>
      <button type="button" className="project-card-main" onClick={() => openProject(project)} aria-label={t('workspace.openProject', { name: project.name })}>
        <span className="workspace-kicker">{t('workspace.projectKicker')}</span>
        <span className="project-card-title-row"><span className="project-color-dot" style={{ backgroundColor: project.color, '--project-color': project.color } as CSSProperties} aria-hidden="true" /><h3>{project.name}</h3></span>
        <span className="project-card-description">{project.description || t('workspace.noDescription')}</span>
      </button>
      <div className="project-stats" aria-label={t('workspace.projectSummary')}><span>{t('workspace.summaryLogs')}: {project.summary.work_logs}</span><span>{t('workspace.summaryTasks')}: {project.summary.tasks}</span><span>{t('workspace.summaryCommits')}: {project.summary.git_commits}</span><span>{t('workspace.summaryReports')}: {project.summary.reports}</span></div>
      <div className="project-actions"><button onClick={(event) => { event.stopPropagation(); onOpenReports(project.public_id) }}>{t('workspace.projectReports')}<ArrowUpRight aria-hidden="true" /></button></div>
    </article>)}</section>
    {items.length === 0 && status !== 'running' && <div className="empty-state"><FolderKanban aria-hidden="true" /><p>{t('workspace.noProjects')}</p></div>}
    {items.length < total && <button className="load-more" onClick={() => void loadMore()} disabled={status === 'running'}>{t('workspace.loadMore')}</button>}

    {selectedProject && <div className="project-detail-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeProject() }}>
      <aside className="project-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="project-detail-title" tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape') closeProject() }}>
        <header className="project-detail-header"><div><p className="workspace-kicker">{t('workspace.projectDetails')}</p><span className="project-detail-title"><span className="project-detail-color-dot" style={{ backgroundColor: selectedProject.color, '--project-color': selectedProject.color } as CSSProperties} aria-hidden="true" /><h3 id="project-detail-title">{selectedProject.name}</h3></span></div><button type="button" className="project-detail-close" onClick={closeProject} aria-label={t('workspace.closeProject')}><X aria-hidden="true" /></button></header>
        {editing ? <div className="project-detail-edit">
          <label>{t('workspace.projectName')}<input value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
          <label>{t('workspace.projectDescription')}<textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} rows={5} /></label>
          <div className="project-color-field"><span>{t('workspace.color')}</span><ProjectColorPicker value={editColor} onChange={setEditColor} /></div>
          <div className="project-detail-actions"><button type="button" onClick={() => setEditing(false)} disabled={savingEdit}>{t('common.cancel')}</button><button type="button" className="primary-action" onClick={() => void saveEdit()} disabled={savingEdit || !editName.trim()}>{savingEdit ? t('common.saving') : t('workspace.saveProject')}</button></div>
        </div> : <>
           <p className="project-detail-description">{selectedProject.description || t('workspace.noDescription')}</p>
           <div className="project-detail-metrics" aria-label={t('workspace.projectActivity')}><div><strong>{selectedProject.summary.work_logs}</strong><span>{t('workspace.projectLogs')}</span></div><div><strong>{selectedProject.summary.tasks}</strong><span>{t('workspace.projectTasks')}</span></div><div><strong>{selectedProject.summary.git_commits}</strong><span>{t('workspace.projectCommits')}</span></div><div><strong>{selectedProject.summary.reports}</strong><span>{t('workspace.projectReportsCount')}</span></div></div>
           <ProjectActivityTimeline items={activityItems} status={activityStatus} onRetry={() => setActivityReloadKey((value) => value + 1)} onTaskClick={(publicId) => { void handleOpenTask(publicId) }} />
           <div className="project-detail-actions"><button type="button" onClick={startEdit}><Pencil aria-hidden="true" />{t('workspace.editProject')}</button><button type="button" className="primary-action" onClick={() => { closeProject(); onOpenReports(selectedProject.public_id) }}><ArrowUpRight aria-hidden="true" />{t('workspace.projectReports')}</button></div>
        </>}
      </aside>
    </div>}
    {activeTask && <TaskDetailDrawer task={activeTask} columns={taskColumns} projects={items.map((project) => ({ public_id: project.public_id, name: project.name }))} onClose={() => setActiveTask(null)} onSave={handleTaskSave} onMove={handleTaskMove} onReopen={handleTaskReopen} onDelete={handleTaskDelete} columnName={(columnKey) => taskColumns.find((column) => column.column_key === columnKey)?.name ?? columnKey} />}
  </div>
}

export default ProjectsPage
