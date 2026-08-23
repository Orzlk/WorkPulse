import { useEffect, useState } from 'react'
import { Archive, ArrowUpRight, FolderKanban, Plus } from 'lucide-react'
import { useToast } from '../components/Toast'
import { useProjectStore } from '../stores/projectStore'

function ProjectsPage({ onOpenReports }: { onOpenReports: () => void }): JSX.Element {
  const { items, total, status, error, fetch, loadMore, create, archive } = useProjectStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#d94f3d')
  const toast = useToast()
  useEffect(() => { void fetch() }, [])
  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    try { await create({ name: name.trim(), description: description.trim(), color }); setName(''); setDescription(''); toast.success('项目已创建') } catch { toast.error('创建项目失败，请重试。') }
  }
  return <div className="workspace-page">
    <header className="workspace-page-heading"><p className="workspace-kicker">PROJECTS / 02</p><h2>项目是工作的边界</h2><p>把仓库、收件箱和报告汇总到同一个项目，月报自然按项目输出。</p></header>
    <section className="project-create"><label>新项目<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：客户端体验升级" /></label><label>说明<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="可选" /></label><label>色标<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label><button className="primary-action" onClick={() => void submit()} disabled={!name.trim()}><Plus aria-hidden="true" />创建</button></section>
    {status === 'error' && <div className="inline-error" role="alert">{error}<button onClick={() => void fetch()}>重试</button></div>}
    <section className="project-grid">{items.map((project) => <article className="project-card" key={project.public_id}><div className="project-color" style={{ backgroundColor: project.color }} /><div><p className="workspace-kicker">PROJECT</p><h3>{project.name}</h3><p>{project.description || '暂无项目说明。'}</p></div><div className="project-stats"><span>日志 / 任务 / Git 将在报告中按此项目聚合</span></div><div className="project-actions"><button onClick={onOpenReports}>查看报告<ArrowUpRight aria-hidden="true" /></button><button onClick={() => void archive(project.public_id)} aria-label={`归档项目 ${project.name}`}><Archive aria-hidden="true" /></button></div></article>)}</section>
    {items.length === 0 && status !== 'running' && <div className="empty-state"><FolderKanban aria-hidden="true" /><p>创建第一个项目来组织你的工作。</p></div>}
    {items.length < total && <button className="load-more" onClick={() => void loadMore()} disabled={status === 'running'}>加载更多</button>}
  </div>
}
export default ProjectsPage
