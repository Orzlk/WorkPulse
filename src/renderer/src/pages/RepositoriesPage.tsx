import { useEffect, useState } from 'react'
import { FolderGit2, Pause, Play, RefreshCw, ServerCog } from 'lucide-react'
import { useToast } from '../components/Toast'
import { useProjectStore } from '../stores/projectStore'
import { useRepositoryStore } from '../stores/repositoryStore'

function RepositoriesPage(): JSX.Element {
  const { items, total, status, error, fetch, loadMore, create, update, scan, scanAll } = useRepositoryStore()
  const projects = useProjectStore((state) => state.items)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [projectId, setProjectId] = useState('')
  const [scanningId, setScanningId] = useState<string | null>(null)
  const toast = useToast()
  useEffect(() => { void fetch(); void fetchProjects() }, [])
  const add = async (): Promise<void> => { if (!name.trim() || !path.trim()) return; try { await create({ name: name.trim(), local_path: path.trim(), project_id: projectId || null }); setName(''); setPath(''); toast.success('仓库已添加') } catch { toast.error('添加仓库失败，请确认路径。') } }
  const scanOne = async (id: string): Promise<void> => { setScanningId(id); try { const result = await scan(id); result.status === 'failed' ? toast.error(result.error ?? '扫描失败') : toast.success(`扫描完成：新增 ${result.inserted_count} 条提交`) } finally { setScanningId(null) } }
  return <div className="workspace-page"><header className="workspace-page-heading"><p className="workspace-kicker">REPOSITORIES / 03</p><h2>只读观察本地 Git</h2><p>扫描只调用本地 Git 读取提交；它不会 fetch、checkout 或修改你的仓库。</p></header>
    <section className="repository-create"><label>名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="仓库名称" /></label><label>本地路径<input value={path} onChange={(event) => setPath(event.target.value)} placeholder="D:\\Workspace\\project" /></label><label>项目<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">未归属</option>{projects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}</select></label><button className="primary-action" onClick={() => void add()} disabled={!name.trim() || !path.trim()}>添加仓库</button><button onClick={() => void scanAll()} disabled={status === 'running'}><RefreshCw aria-hidden="true" />扫描全部</button></section>
    {status === 'error' && <div className="inline-error" role="alert">{error}<button onClick={() => void fetch()}>重试</button></div>}
    <section className="repository-list">{items.map((repository) => <article className="repository-row" key={repository.public_id}><FolderGit2 aria-hidden="true" /><div className="repository-main"><h3>{repository.name}</h3><code>{repository.local_path}</code><span>{repository.branch ?? '未检测分支'} · {repository.last_scanned_at ? `最近扫描 ${new Date(repository.last_scanned_at).toLocaleString()}` : '尚未扫描'}</span>{repository.last_scan_error && <p className="repository-error">扫描失败：{repository.last_scan_error}</p>}</div><div className="repository-controls"><label className="toggle-label"><input type="checkbox" checked={repository.enabled} onChange={(event) => void update(repository.public_id, { enabled: event.target.checked })} /><span>{repository.enabled ? '已启用' : '已暂停'}</span></label><button onClick={() => void scanOne(repository.public_id)} disabled={scanningId === repository.public_id || !repository.enabled}><RefreshCw aria-hidden="true" />{scanningId === repository.public_id ? '扫描中' : '扫描'}</button><button onClick={() => void update(repository.public_id, { enabled: !repository.enabled })} aria-label={repository.enabled ? `暂停 ${repository.name}` : `启用 ${repository.name}`}>{repository.enabled ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button></div></article>)}</section>
    {items.length === 0 && status !== 'running' && <div className="empty-state"><ServerCog aria-hidden="true" /><p>添加本地 Git 仓库后，WorkPulse 会定期读取改动。</p></div>}
    {items.length < total && <button className="load-more" onClick={() => void loadMore()} disabled={status === 'running'}>加载更多</button>}
  </div>
}
export default RepositoriesPage
