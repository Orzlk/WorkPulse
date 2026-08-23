import { useEffect, useState } from 'react'
import { Archive, ArrowUpRight, FolderKanban, Plus } from 'lucide-react'
import { useToast } from '../components/Toast'
import { useProjectStore } from '../stores/projectStore'
import { useI18n } from '../stores/languageStore'

function ProjectsPage({ onOpenReports }: { onOpenReports: (projectId: string) => void }): JSX.Element {
  const { items, total, status, error, fetch, loadMore, create, archive } = useProjectStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#d94f3d')
  const toast = useToast()
  const { t } = useI18n()
  useEffect(() => { void fetch() }, [])
  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    try { await create({ name: name.trim(), description: description.trim(), color }); setName(''); setDescription(''); toast.success(t('workspace.projectCreated')) } catch { toast.error(t('workspace.projectCreateFailed')) }
  }
  return <div className="workspace-page">
    <header className="workspace-page-heading"><p className="workspace-kicker">{t('workspace.projectsKicker')}</p><h2>{t('workspace.projectsTitle')}</h2><p>{t('workspace.projectsSubtitle')}</p></header>
    <section className="project-create"><label>{t('workspace.projectName')}<input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('workspace.projectNamePlaceholder')} /></label><label>{t('workspace.projectDescription')}<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('workspace.optional')} /></label><label>{t('workspace.color')}<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label><button className="primary-action" onClick={() => void submit()} disabled={!name.trim()}><Plus aria-hidden="true" />{t('common.create')}</button></section>
    {status === 'error' && <div className="inline-error" role="alert">{error}<button onClick={() => void fetch()}>{t('common.retry')}</button></div>}
    <section className="project-grid">{items.map((project) => <article className="project-card" key={project.public_id}><div className="project-color" style={{ backgroundColor: project.color }} /><div><p className="workspace-kicker">{t('workspace.projectKicker')}</p><h3>{project.name}</h3><p>{project.description || t('workspace.noDescription')}</p></div><div className="project-stats" aria-label={t('workspace.projectSummary')}><span>{t('workspace.summaryLogs')}: {project.summary.work_logs}</span><span>{t('workspace.summaryTasks')}: {project.summary.tasks}</span><span>{t('workspace.summaryCommits')}: {project.summary.git_commits}</span><span>{t('workspace.summaryReports')}: {project.summary.reports}</span></div><div className="project-actions"><button onClick={() => onOpenReports(project.public_id)}>{t('workspace.projectReports')}<ArrowUpRight aria-hidden="true" /></button><button onClick={() => void archive(project.public_id)} aria-label={t('workspace.archiveProject', { name: project.name })}><Archive aria-hidden="true" /></button></div></article>)}</section>
    {items.length === 0 && status !== 'running' && <div className="empty-state"><FolderKanban aria-hidden="true" /><p>{t('workspace.noProjects')}</p></div>}
    {items.length < total && <button className="load-more" onClick={() => void loadMore()} disabled={status === 'running'}>{t('workspace.loadMore')}</button>}
  </div>
}
export default ProjectsPage
