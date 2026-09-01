import { useEffect, useMemo, useState } from 'react'
import { FolderGit2, GitBranch, MoreHorizontal, Pause, Pencil, Play, RefreshCw, ServerCog, Trash2, X } from 'lucide-react'
import { useToast } from '../components/Toast'
import { useProjectStore } from '../stores/projectStore'
import { useRepositoryStore } from '../stores/repositoryStore'
import { useI18n } from '../stores/languageStore'
import { summarizeRepositoryScan } from '../lib/workspaceInteractions'
import { WorkspacePageHeader } from '../components/WorkspacePageHeader'
import { WorkspaceSectionTabs } from '../components/WorkspaceSectionTabs'
import type { Repository } from '../lib/workspaceTypes'
import type { TranslationKey } from '../lib/i18n'

interface RepositoryForm {
  name: string
  local_path: string
  remote_url: string
  project_id: string
}

const emptyRepositoryForm: RepositoryForm = { name: '', local_path: '', remote_url: '', project_id: '' }

function RepositoriesPage({ focusPublicId, onFocusHandled, onOpenProjects }: { focusPublicId?: string | null; onFocusHandled?: () => void; onOpenProjects?: () => void }): JSX.Element {
  const { items, total, status, error, fetch, loadByPublicId, loadMore, create, update, remove, scan, scanAll } = useRepositoryStore()
  const projects = useProjectStore((state) => state.items)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [projectId, setProjectId] = useState('')
  const [scanningId, setScanningId] = useState<string | null>(null)
  const [operation, setOperation] = useState<{ kind: 'scan' | 'scanAll' | 'update' | 'delete'; id?: string } | null>(null)
  const [operationError, setOperationError] = useState('')
  const [retry, setRetry] = useState<(() => Promise<void>) | null>(null)
  const [scanFailures, setScanFailures] = useState<Array<{ repository_id: string; name: string; error: string }>>([])
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingRepository, setEditingRepository] = useState<Repository | null>(null)
  const [editForm, setEditForm] = useState<RepositoryForm>(emptyRepositoryForm)
  const [savingEdit, setSavingEdit] = useState(false)
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
        onFocusHandled?.()
      })
    }).finally(() => { if (!useRepositoryStore.getState().items.some((repository) => repository.public_id === focusPublicId)) onFocusHandled?.() })
  }, [focusPublicId, loadByPublicId, onFocusHandled])
  useEffect(() => {
    const closeMenu = (event: PointerEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest('.repository-card-menu')) setOpenMenuId(null)
    }
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpenMenuId(null) }
    document.addEventListener('pointerdown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  const isBusy = operation !== null
  const repositoryNames = useMemo(() => new Map(items.map((item) => [item.public_id, item.name])), [items])
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.public_id, project.name])), [projects])
  const isEditDirty = Boolean(editingRepository && (
    editForm.name !== editingRepository.name ||
    editForm.local_path !== editingRepository.local_path ||
    editForm.remote_url !== (editingRepository.remote_url ?? '') ||
    editForm.project_id !== (editingRepository.project_id ?? '')
  ))

  const requestCloseEdit = (): void => {
    if (savingEdit) return
    if (isEditDirty && !window.confirm(t('workspace.repositoryEditDiscardConfirm'))) return
    setEditingRepository(null)
  }

  useEffect(() => {
    if (!editingRepository) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') requestCloseEdit()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [editingRepository, editForm, savingEdit])

  const add = async (): Promise<void> => {
    if (!name.trim() || !path.trim()) return
    try {
      await create({ name: name.trim(), local_path: path.trim(), project_id: projectId || null })
      setName('')
      setPath('')
      toast.success(t('workspace.repositoryAdded'))
    } catch {
      toast.error(t('workspace.repositoryAddFailed'))
    }
  }

  const scanOne = async (id: string): Promise<void> => {
    setScanningId(id)
    setOperation({ kind: 'scan', id })
    setOperationError('')
    setScanFailures([])
    setRetry(() => () => scanOne(id))
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
    } finally {
      setScanningId(null)
      setOperation(null)
    }
  }

  const scanAllRepositories = async (): Promise<void> => {
    setOperation({ kind: 'scanAll' })
    setOperationError('')
    setScanFailures([])
    setRetry(() => scanAllRepositories)
    try {
      const result = await scanAll()
      const summary = summarizeRepositoryScan(result.results, repositoryNames)
      setScanFailures(summary.failures)
      if (summary.failed > 0) setOperationError(t('workspace.scanAllPartial', { succeeded: summary.succeeded, failed: summary.failed }))
      else toast.success(t('workspace.scanAllComplete', { count: summary.commits }))
    } catch {
      setOperationError(t('workspace.scanAllFailed'))
    } finally {
      setOperation(null)
    }
  }

  const translatedError = error ? t(error as TranslationKey) : ''
  const updateRepository = async (id: string, enabled: boolean): Promise<void> => {
    setOperation({ kind: 'update', id })
    setOperationError('')
    setRetry(() => () => updateRepository(id, enabled))
    try {
      await update(id, { enabled })
    } catch {
      setOperationError(t('workspace.repositoryUpdateFailed'))
    } finally {
      setOperation(null)
    }
  }

  const startEdit = (repository: Repository): void => {
    setOpenMenuId(null)
    setEditingRepository(repository)
    setEditForm({
      name: repository.name,
      local_path: repository.local_path,
      remote_url: repository.remote_url ?? '',
      project_id: repository.project_id ?? ''
    })
  }

  const saveEdit = async (): Promise<void> => {
    if (!editingRepository || !editForm.name.trim() || !editForm.local_path.trim()) return
    setSavingEdit(true)
    try {
      await update(editingRepository.public_id, {
        name: editForm.name.trim(),
        local_path: editForm.local_path.trim(),
        remote_url: editForm.remote_url.trim() || null,
        project_id: editForm.project_id || null
      })
      setEditingRepository(null)
      toast.success(t('workspace.repositorySaved'))
    } catch {
      toast.error(t('workspace.repositorySaveFailed'))
    } finally {
      setSavingEdit(false)
    }
  }

  const requestDelete = (publicId: string): void => {
    setOpenMenuId(null)
    setDeletingId(publicId)
  }

  const deleteRepository = async (publicId: string): Promise<void> => {
    setOperation({ kind: 'delete', id: publicId })
    setOperationError('')
    try {
      await remove(publicId)
      setDeletingId(null)
      toast.success(t('workspace.repositoryDeleted'))
    } catch {
      toast.error(t('workspace.repositoryDeleteFailed'))
    } finally {
      setOperation(null)
    }
  }

  return <div className="workspace-page">
    <WorkspacePageHeader ariaLabel={t('workspace.breadcrumbLabel')} items={[{ label: t('nav.projects') }, { label: t('nav.repositories'), current: true }]} title={t('workspace.repositoriesTitle')} description={t('workspace.repositoriesSubtitle')} />
    <WorkspaceSectionTabs ariaLabel={t('workspace.sectionNavigation')} items={[{ id: 'projects', label: t('nav.projects'), onClick: onOpenProjects }, { id: 'repositories', label: t('nav.repositories'), active: true }]} />
    <section className="repository-create"><label>{t('workspace.repositoryName')}<input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('workspace.repositoryNamePlaceholder')} /></label><label>{t('workspace.localPath')}<input value={path} onChange={(event) => setPath(event.target.value)} placeholder={t('workspace.localPathPlaceholder')} /></label><label>{t('workspace.project')}<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">{t('workspace.unassigned')}</option>{projects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}</select></label><button className="primary-action" onClick={() => void add()} disabled={!name.trim() || !path.trim() || isBusy}>{t('workspace.addRepository')}</button><button onClick={() => void scanAllRepositories()} disabled={isBusy}><RefreshCw aria-hidden="true" />{operation?.kind === 'scanAll' ? t('workspace.scanning') : t('workspace.scanAll')}</button></section>
    {(status === 'error' || operationError) && <div className="inline-error" role="alert"><p>{operationError || translatedError}</p><button onClick={() => retry ? void retry() : void fetch()}>{t('common.retry')}</button>{scanFailures.map((failure) => <div key={failure.repository_id} className="repository-scan-failure"><span>{failure.name}: {failure.error}</span><button onClick={() => void scanOne(failure.repository_id)} disabled={isBusy}>{t('workspace.retryRepository')}</button></div>)}</div>}
    <section className="repository-list">{items.map((repository) => <article className="repository-card" key={repository.public_id} id={`repository-${repository.public_id}`} tabIndex={-1}>
      <div className="repository-card-header">
        <div className="repository-card-identity"><span className="repository-card-icon"><FolderGit2 aria-hidden="true" /></span><div><p className="workspace-kicker">{t('workspace.repositoriesKicker')}</p><h3>{repository.name}</h3></div></div>
        {deletingId === repository.public_id ? <div className="repository-delete-confirm"><span>{t('workspace.repositoryDeleteConfirm', { name: repository.name })}</span><button className="danger-action" onClick={() => void deleteRepository(repository.public_id)} disabled={isBusy}>{t('common.confirm')}</button><button onClick={() => setDeletingId(null)} disabled={isBusy}>{t('common.cancel')}</button></div> : <div className="repository-card-menu">
          <button className="repository-menu-trigger" aria-label={t('workspace.repositoryMenu')} aria-haspopup="menu" aria-expanded={openMenuId === repository.public_id} onClick={() => setOpenMenuId(openMenuId === repository.public_id ? null : repository.public_id)}><MoreHorizontal aria-hidden="true" /></button>
          {openMenuId === repository.public_id && <div className="repository-card-menu-popover" role="menu"><button role="menuitem" onClick={() => startEdit(repository)}><Pencil aria-hidden="true" />{t('workspace.repositoryEdit')}</button><button role="menuitem" onClick={() => requestDelete(repository.public_id)}><Trash2 aria-hidden="true" />{t('workspace.repositoryDelete')}</button></div>}
        </div>}
      </div>
      <code className="repository-card-path">{repository.local_path}</code>
      <div className="repository-card-meta"><span className="repository-card-chip"><GitBranch aria-hidden="true" />{repository.branch ?? t('workspace.branchUnknown')}</span><span className="repository-card-chip">{repository.project_id ? projectNames.get(repository.project_id) : t('workspace.unassigned')}</span><span className={`repository-card-chip ${repository.enabled ? 'is-enabled' : 'is-paused'}`}>{repository.enabled ? t('workspace.enabled') : t('workspace.paused')}</span></div>
      {repository.remote_url && <p className="repository-card-remote">{t('workspace.remoteUrl')}: {repository.remote_url}</p>}
      {repository.last_scan_error && <p className="repository-error">{t('workspace.scanFailed')}: {repository.last_scan_error}</p>}
      <div className="repository-card-footer"><span>{repository.last_scanned_at ? `${t('workspace.lastScanned')} ${new Date(repository.last_scanned_at).toLocaleString()}` : t('workspace.notScanned')}</span><div className="repository-controls"><button onClick={() => void scanOne(repository.public_id)} disabled={isBusy || scanningId === repository.public_id || !repository.enabled}><RefreshCw aria-hidden="true" />{scanningId === repository.public_id ? t('workspace.scanning') : t('workspace.scan')}</button><button onClick={() => void updateRepository(repository.public_id, !repository.enabled)} disabled={isBusy} aria-label={repository.enabled ? t('workspace.pauseRepository', { name: repository.name }) : t('workspace.enableRepository', { name: repository.name })}>{repository.enabled ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button></div></div>
    </article>)}</section>
    {items.length === 0 && status !== 'running' && <div className="empty-state"><ServerCog aria-hidden="true" /><p>{t('workspace.noRepositories')}</p></div>}
    {items.length < total && <button className="load-more" onClick={() => void loadMore()} disabled={status === 'running' || isBusy}>{t('workspace.loadMore')}</button>}
    {editingRepository && <div className="repository-edit-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestCloseEdit() }}><div className="repository-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="repository-edit-title"><div className="repository-edit-heading"><div><p className="workspace-kicker">{t('workspace.repositoryEdit')}</p><h3 id="repository-edit-title">{editingRepository.name}</h3></div><button type="button" aria-label={t('common.close')} onClick={requestCloseEdit}><X aria-hidden="true" /></button></div><label>{t('workspace.repositoryName')}<input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} /></label><label>{t('workspace.localPath')}<input value={editForm.local_path} onChange={(event) => setEditForm({ ...editForm, local_path: event.target.value })} /></label><label>{t('workspace.remoteUrl')}<input value={editForm.remote_url} onChange={(event) => setEditForm({ ...editForm, remote_url: event.target.value })} placeholder="https://..." /></label><label>{t('workspace.project')}<select value={editForm.project_id} onChange={(event) => setEditForm({ ...editForm, project_id: event.target.value })}><option value="">{t('workspace.unassigned')}</option>{projects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}</select></label><div className="repository-edit-actions"><button type="button" onClick={requestCloseEdit} disabled={savingEdit}>{t('common.cancel')}</button><button type="button" className="primary-action" onClick={() => void saveEdit()} disabled={savingEdit || !editForm.name.trim() || !editForm.local_path.trim()}>{savingEdit ? t('common.saving') : t('common.save')}</button></div></div></div>}
  </div>
}

export default RepositoriesPage
