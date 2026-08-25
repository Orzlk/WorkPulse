import { useEffect, useState } from 'react'
import { Archive, ArrowUpRight, FolderKanban, Pencil, Plus, X } from 'lucide-react'
import { useToast } from '../components/Toast'
import { useProjectStore } from '../stores/projectStore'
import { useI18n } from '../stores/languageStore'
import { WorkspacePageHeader } from '../components/WorkspacePageHeader'
import { WorkspaceSectionTabs } from '../components/WorkspaceSectionTabs'
import type { Project } from '../lib/workspaceTypes'

function ProjectsPage({ onOpenReports, onOpenRepositories }: { onOpenReports: (projectId: string) => void; onOpenRepositories?: () => void }): JSX.Element {
  const { items, total, status, error, fetch, loadMore, create, update, archive } = useProjectStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#d94f3d')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editColor, setEditColor] = useState('#d94f3d')
  const [savingEdit, setSavingEdit] = useState(false)
  const toast = useToast()
  const { t } = useI18n()
  const selectedProject = items.find((project) => project.public_id === selectedProjectId) ?? null

  useEffect(() => { void fetch() }, [])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && selectedProjectId) {
        setSelectedProjectId(null)
        setEditing(false)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [selectedProjectId])

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

  const closeProject = (): void => {
    setSelectedProjectId(null)
    setEditing(false)
  }

  return <div className="workspace-page">
    <WorkspacePageHeader ariaLabel={t('workspace.breadcrumbLabel')} items={[{ label: t('nav.projects'), current: true }]} title={t('workspace.projectsTitle')} description={t('workspace.projectsSubtitle')} />
    <WorkspaceSectionTabs ariaLabel={t('workspace.sectionNavigation')} items={[{ id: 'projects', label: t('nav.projects'), active: true }, { id: 'repositories', label: t('nav.repositories'), onClick: onOpenRepositories }]} />
    <section className="project-create"><label>{t('workspace.projectName')}<input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('workspace.projectNamePlaceholder')} /></label><label>{t('workspace.projectDescription')}<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('workspace.optional')} /></label><label>{t('workspace.color')}<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label><button className="primary-action" onClick={() => void submit()} disabled={!name.trim()}><Plus aria-hidden="true" />{t('common.create')}</button></section>
    {status === 'error' && <div className="inline-error" role="alert">{error ? t(error as Parameters<typeof t>[0]) : ''}<button onClick={() => void fetch()}>{t('common.retry')}</button></div>}
    <section className="project-grid">{items.map((project) => <article className="project-card" key={project.public_id}>
      <div className="project-color" style={{ backgroundColor: project.color }} />
      <button type="button" className="project-card-main" onClick={() => openProject(project)} aria-label={t('workspace.openProject', { name: project.name })}>
        <span className="workspace-kicker">{t('workspace.projectKicker')}</span>
        <h3>{project.name}</h3>
        <span className="project-card-description">{project.description || t('workspace.noDescription')}</span>
      </button>
      <div className="project-stats" aria-label={t('workspace.projectSummary')}><span>{t('workspace.summaryLogs')}: {project.summary.work_logs}</span><span>{t('workspace.summaryTasks')}: {project.summary.tasks}</span><span>{t('workspace.summaryCommits')}: {project.summary.git_commits}</span><span>{t('workspace.summaryReports')}: {project.summary.reports}</span></div>
      <div className="project-actions"><button onClick={(event) => { event.stopPropagation(); onOpenReports(project.public_id) }}>{t('workspace.projectReports')}<ArrowUpRight aria-hidden="true" /></button><button onClick={(event) => { event.stopPropagation(); void archive(project.public_id) }} aria-label={t('workspace.archiveProject', { name: project.name })}><Archive aria-hidden="true" /></button></div>
    </article>)}</section>
    {items.length === 0 && status !== 'running' && <div className="empty-state"><FolderKanban aria-hidden="true" /><p>{t('workspace.noProjects')}</p></div>}
    {items.length < total && <button className="load-more" onClick={() => void loadMore()} disabled={status === 'running'}>{t('workspace.loadMore')}</button>}

    {selectedProject && <div className="project-detail-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeProject() }}>
      <aside className="project-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="project-detail-title" tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape') closeProject() }}>
        <header className="project-detail-header"><div><p className="workspace-kicker">{t('workspace.projectDetails')}</p><h3 id="project-detail-title">{selectedProject.name}</h3></div><button type="button" className="project-detail-close" onClick={closeProject} aria-label={t('workspace.closeProject')}><X aria-hidden="true" /></button></header>
        {editing ? <div className="project-detail-edit">
          <label>{t('workspace.projectName')}<input value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
          <label>{t('workspace.projectDescription')}<textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} rows={5} /></label>
          <label>{t('workspace.color')}<input type="color" value={editColor} onChange={(event) => setEditColor(event.target.value)} /></label>
          <div className="project-detail-actions"><button type="button" onClick={() => setEditing(false)} disabled={savingEdit}>{t('common.cancel')}</button><button type="button" className="primary-action" onClick={() => void saveEdit()} disabled={savingEdit || !editName.trim()}>{savingEdit ? t('common.saving') : t('workspace.saveProject')}</button></div>
        </div> : <>
          <p className="project-detail-description">{selectedProject.description || t('workspace.noDescription')}</p>
          <div className="project-detail-metrics" aria-label={t('workspace.projectActivity')}><div><strong>{selectedProject.summary.work_logs}</strong><span>{t('workspace.projectLogs')}</span></div><div><strong>{selectedProject.summary.tasks}</strong><span>{t('workspace.projectTasks')}</span></div><div><strong>{selectedProject.summary.git_commits}</strong><span>{t('workspace.projectCommits')}</span></div><div><strong>{selectedProject.summary.reports}</strong><span>{t('workspace.projectReportsCount')}</span></div></div>
          <div className="project-detail-actions"><button type="button" onClick={startEdit}><Pencil aria-hidden="true" />{t('workspace.editProject')}</button><button type="button" className="primary-action" onClick={() => { closeProject(); onOpenReports(selectedProject.public_id) }}><ArrowUpRight aria-hidden="true" />{t('workspace.projectReports')}</button></div>
        </>}
      </aside>
    </div>}
  </div>
}

export default ProjectsPage
