import { useEffect, useMemo, useState } from 'react'
import { FolderGit2, Pause, Play, RefreshCw, ServerCog } from 'lucide-react'
import { useToast } from '../components/Toast'
import { useProjectStore } from '../stores/projectStore'
import { useRepositoryStore } from '../stores/repositoryStore'
import { useI18n } from '../stores/languageStore'
import { summarizeRepositoryScan } from '../lib/workspaceInteractions'
import type { TranslationKey } from '../lib/i18n'

function RepositoriesPage({ focusPublicId }: { focusPublicId?: string | null }): JSX.Element {
  const { items, total, status, error, fetch, loadByPublicId, loadMore, create, update, scan, scanAll } = useRepositoryStore()
  const projects = useProjectStore((state) => state.items)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [projectId, setProjectId] = useState('')
  const [scanningId, setScanningId] = useState<string | null>(null)
  const [operation, setOperation] = useState<{ kind: 'scan' | 'scanAll' | 'update'; id?: string } | null>(null)
  const [operationError, setOperationError] = useState('')
  const [retry, setRetry] = useState<(() => Promise<void>) | null>(null)
  const [scanFailures, setScanFailures] = useState<Array<{ repository_id: string; name: string; error: string }>>([])
  const toast = useToast()
  const { t } = useI18n()
  useEffect(() => { void fetch(); void fetchProjects() }, [])
  useEffect(() => {
    if (!focusPublicId) return
    void loadByPublicId(focusPublicId).then((repository) => {
      if (!repository) return
      requestAnimationFrame(() => {
        const element = document.getElementById(`repository-${focusPublicId}`)
        element?.scrollIntoView({ block: 'center' })
        element?.focus()
      })
    })
  }, [focusPublicId, loadByPublicId])
  const isBusy = operation !== null
  const repositoryNames = useMemo(() => new Map(items.map((item) => [item.public_id, item.name])), [items])
  const add = async (): Promise<void> => { if (!name.trim() || !path.trim()) return; try { await create({ name: name.trim(), local_path: path.trim(), project_id: projectId || null }); setName(''); setPath(''); toast.success(t('workspace.repositoryAdded')) } catch { toast.error(t('workspace.repositoryAddFailed')) } }
  const scanOne = async (id: string): Promise<void> => {
    setScanningId(id); setOperation({ kind: 'scan', id }); setOperationError(''); setScanFailures([]); setRetry(() => () => scanOne(id))
    try {
      const result = await scan(id)
      if (result.status === 'failed') {
        const failure = { repository_id: id, name: repositoryNames.get(id) ?? id, error: result.error ?? t('workspace.scanFailed') }
        setScanFailures([failure])
        setOperationError(t('workspace.scanOneFailed', { name: failure.name }))
      } else {
        toast.success(t('workspace.scanComplete', { count: result.inserted_count }))
      }
    } catch {
      setScanFailures([{ repository_id: id, name: repositoryNames.get(id) ?? id, error: t('workspace.scanFailed') }])
      setOperationError(t('workspace.scanFailed'))
    }
    finally { setScanningId(null); setOperation(null) }
  }
  const scanAllRepositories = async (): Promise<void> => {
    setOperation({ kind: 'scanAll' }); setOperationError(''); setScanFailures([]); setRetry(() => scanAllRepositories)
    try {
      const result = await scanAll()
      const summary = summarizeRepositoryScan(result.results, repositoryNames)
      setScanFailures(summary.failures)
      if (summary.failed > 0) setOperationError(t('workspace.scanAllPartial', { succeeded: summary.succeeded, failed: summary.failed }))
      else toast.success(t('workspace.scanAllComplete', { count: summary.commits }))
    }
    catch { setOperationError(t('workspace.scanAllFailed')) }
    finally { setOperation(null) }
  }
  const translatedError = error ? t(error as TranslationKey) : ''
  const updateRepository = async (id: string, enabled: boolean): Promise<void> => {
    setOperation({ kind: 'update', id }); setOperationError(''); setRetry(() => () => updateRepository(id, enabled))
    try { await update(id, { enabled }) }
    catch { setOperationError(t('workspace.repositoryUpdateFailed')) }
    finally { setOperation(null) }
  }
  return <div className="workspace-page"><header className="workspace-page-heading"><p className="workspace-kicker">{t('workspace.repositoriesKicker')}</p><h2>{t('workspace.repositoriesTitle')}</h2><p>{t('workspace.repositoriesSubtitle')}</p></header>
    <section className="repository-create"><label>{t('workspace.repositoryName')}<input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('workspace.repositoryNamePlaceholder')} /></label><label>{t('workspace.localPath')}<input value={path} onChange={(event) => setPath(event.target.value)} placeholder={t('workspace.localPathPlaceholder')} /></label><label>{t('workspace.project')}<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">{t('workspace.unassigned')}</option>{projects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}</select></label><button className="primary-action" onClick={() => void add()} disabled={!name.trim() || !path.trim() || isBusy}>{t('workspace.addRepository')}</button><button onClick={() => void scanAllRepositories()} disabled={isBusy}><RefreshCw aria-hidden="true" />{operation?.kind === 'scanAll' ? t('workspace.scanning') : t('workspace.scanAll')}</button></section>
    {(status === 'error' || operationError) && <div className="inline-error" role="alert"><p>{operationError || translatedError}</p><button onClick={() => retry ? void retry() : void fetch()}>{t('common.retry')}</button>{scanFailures.map((failure) => <div key={failure.repository_id} className="repository-scan-failure"><span>{failure.name}: {failure.error}</span><button onClick={() => void scanOne(failure.repository_id)} disabled={isBusy}>{t('workspace.retryRepository')}</button></div>)}</div>}
    <section className="repository-list">{items.map((repository) => <article className="repository-row" key={repository.public_id} id={`repository-${repository.public_id}`} tabIndex={-1}><FolderGit2 aria-hidden="true" /><div className="repository-main"><h3>{repository.name}</h3><code>{repository.local_path}</code><span>{repository.branch ?? t('workspace.branchUnknown')} · {repository.last_scanned_at ? `${t('workspace.lastScanned')} ${new Date(repository.last_scanned_at).toLocaleString()}` : t('workspace.notScanned')}</span>{repository.last_scan_error && <p className="repository-error">{t('workspace.scanFailed')}: {repository.last_scan_error}</p>}</div><div className="repository-controls"><label className="toggle-label"><input type="checkbox" checked={repository.enabled} disabled={isBusy} onChange={(event) => void updateRepository(repository.public_id, event.target.checked)} /><span>{repository.enabled ? t('workspace.enabled') : t('workspace.paused')}</span></label><button onClick={() => void scanOne(repository.public_id)} disabled={isBusy || scanningId === repository.public_id || !repository.enabled}><RefreshCw aria-hidden="true" />{scanningId === repository.public_id ? t('workspace.scanning') : t('workspace.scan')}</button><button onClick={() => void updateRepository(repository.public_id, !repository.enabled)} disabled={isBusy} aria-label={repository.enabled ? t('workspace.pauseRepository', { name: repository.name }) : t('workspace.enableRepository', { name: repository.name })}>{repository.enabled ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button></div></article>)}</section>
    {items.length === 0 && status !== 'running' && <div className="empty-state"><ServerCog aria-hidden="true" /><p>{t('workspace.noRepositories')}</p></div>}
    {items.length < total && <button className="load-more" onClick={() => void loadMore()} disabled={status === 'running' || isBusy}>{t('workspace.loadMore')}</button>}
  </div>
}
export default RepositoriesPage
