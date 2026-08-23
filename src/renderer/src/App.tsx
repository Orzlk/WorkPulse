import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { BarChart3, ClipboardList, Columns3, FileText, FolderGit2, FolderKanban, Inbox, Plus, Search, Settings } from 'lucide-react'
import { QuickCreate } from './components/QuickCreate'
import { GlobalSearch } from './components/GlobalSearch'
import { useToast } from './components/Toast'
import { useThemeStore } from './stores/themeStore'
import { useLanguageStore } from './stores/languageStore'
import { useProjectStore } from './stores/projectStore'
import { useRepositoryStore } from './stores/repositoryStore'
import { useI18n } from './stores/languageStore'
import type { SearchResult } from './lib/workspaceTypes'
import brandSeal from './assets/brand-seal.png'

const WorkLogPage = lazy(() => import('./pages/WorkLogPage'))
const KanbanPage = lazy(() => import('./pages/KanbanPage'))
const ReportPage = lazy(() => import('./pages/ReportPage'))
const StatsPage = lazy(() => import('./pages/StatsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const InboxPage = lazy(() => import('./pages/InboxPage'))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'))
const RepositoriesPage = lazy(() => import('./pages/RepositoriesPage'))

type Page = 'worklog' | 'kanban' | 'report' | 'stats' | 'settings' | 'inbox' | 'projects' | 'repositories'
type QuickCreateMode = 'log' | 'task' | 'inbox' | null

const navigation: Array<{ page: Exclude<Page, 'settings'>; Icon: typeof ClipboardList }> = [
  { page: 'worklog', Icon: ClipboardList },
  { page: 'inbox', Icon: Inbox },
  { page: 'kanban', Icon: Columns3 },
  { page: 'projects', Icon: FolderKanban },
  { page: 'repositories', Icon: FolderGit2 },
  { page: 'report', Icon: FileText },
  { page: 'stats', Icon: BarChart3 }
]

function App(): JSX.Element {
  const [currentPage, setCurrentPage] = useState<Page>('worklog')
  const [quickCreate, setQuickCreate] = useState<QuickCreateMode>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [inboxFocusId, setInboxFocusId] = useState<string | null>(null)
  const [reportProjectId, setReportProjectId] = useState<string | null>(null)
  const initTheme = useThemeStore((state) => state.init)
  const initLanguage = useLanguageStore((state) => state.init)
  const projects = useProjectStore((state) => state.items)
  const repositories = useRepositoryStore((state) => state.items)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const fetchRepositories = useRepositoryStore((state) => state.fetch)
  const toast = useToast()
  const { t } = useI18n()
  const quickCreateTriggerRef = useRef<HTMLButtonElement>(null)
  const updateDownloadedNotifiedRef = useRef(false)

  useEffect(() => { void initTheme(); void initLanguage(); void fetchProjects(); void fetchRepositories() }, [initTheme, initLanguage, fetchProjects, fetchRepositories])
  useEffect(() => {
    const unsubscribe = window.api.on.updateStatus((state) => {
      if (state.status === 'downloaded' && !updateDownloadedNotifiedRef.current) {
        updateDownloadedNotifiedRef.current = true
        toast.success(t('settings.updateDownloaded'))
      }
    })
    return unsubscribe
  }, [toast])
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (quickCreate) return
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen((open) => !open); return }
      if (mod && event.key === '1') { event.preventDefault(); setCurrentPage('worklog') }
      else if (mod && event.key === '2') { event.preventDefault(); setCurrentPage('kanban') }
      else if (mod && event.key === '3') { event.preventDefault(); setCurrentPage('report') }
      else if (mod && event.key === '4') { event.preventDefault(); setCurrentPage('stats') }
      else if (mod && event.key === '5') { event.preventDefault(); setCurrentPage('inbox') }
      else if (mod && event.key === ',') { event.preventDefault(); setCurrentPage('settings') }
      else if (event.key === 'Escape') { setSearchOpen(false); if (currentPage === 'settings') setCurrentPage('worklog') }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentPage, quickCreate])
  useEffect(() => {
    const unsubCreate = window.api.on.quickCreate((type) => setQuickCreate(type))
    const unsubNav = window.api.on.navigate((page) => setCurrentPage(page))
    return () => { unsubCreate(); unsubNav() }
  }, [])

  const openSearchResult = useCallback((result: SearchResult) => {
    if (result.source === 'inbox') {
      setInboxFocusId(result.public_id)
      setCurrentPage('inbox')
    } else if (result.source === 'work_log') {
      setCurrentPage('worklog')
    } else if (result.source === 'task') {
      setCurrentPage('kanban')
    } else if (result.source === 'git_commit') {
      setCurrentPage('repositories')
    } else {
      setReportProjectId(result.project_id)
      setCurrentPage('report')
    }
    setSearchOpen(false)
  }, [])
  const renderPage = (): JSX.Element => {
    if (currentPage === 'worklog') return <WorkLogPage />
    if (currentPage === 'kanban') return <KanbanPage />
    if (currentPage === 'report') return <ReportPage projectId={reportProjectId} onProjectChange={setReportProjectId} />
    if (currentPage === 'stats') return <StatsPage />
    if (currentPage === 'settings') return <SettingsPage onBack={() => setCurrentPage('worklog')} />
    if (currentPage === 'inbox') return <InboxPage focusId={inboxFocusId} />
    if (currentPage === 'projects') return <ProjectsPage onOpenReports={(projectId) => { setReportProjectId(projectId); setCurrentPage('report') }} />
    return <RepositoriesPage />
  }

  return <div className="hallmark-app workspace-shell h-screen flex flex-col">
    <header className="app-header workspace-header">
      <div className="app-header-main"><button className="app-brand" onClick={() => setCurrentPage('worklog')} aria-label={t('nav.home')}><img src={brandSeal} alt="" className="app-brand-mark" /><h1>WorkPulse</h1></button><nav className="app-nav workspace-nav" aria-label={t('nav.main')}>{navigation.map(({ page, Icon }) => <button key={page} onClick={() => setCurrentPage(page)} className={`app-nav-button ${currentPage === page ? 'is-active' : ''}`} aria-current={currentPage === page ? 'page' : undefined}><Icon aria-hidden="true" />{t(`nav.${page}` as Parameters<typeof t>[0])}</button>)}</nav></div>
      <div className="header-actions"><button className="header-icon-button" onClick={() => setSearchOpen((open) => !open)} aria-label={t('nav.search')} aria-expanded={searchOpen}><Search aria-hidden="true" /></button><button ref={quickCreateTriggerRef} className="header-create-button" onClick={() => setQuickCreate('inbox')}><Plus aria-hidden="true" />{t('nav.quickCreate')}</button><button onClick={() => setCurrentPage('settings')} className="app-settings-button settings-spin" aria-label={t('nav.settings')}><Settings aria-hidden="true" /></button></div>
      {searchOpen && <GlobalSearch onOpenResult={openSearchResult} />}
    </header>
    <main className="app-main flex-1 overflow-auto"><div className={`page-container workspace-content ${currentPage === 'kanban' ? 'page-container-wide' : ''}`}><Suspense fallback={<div className="page-loading" role="status">{t('common.loading')}</div>}>{renderPage()}</Suspense></div></main>
    {quickCreate && <QuickCreate initialMode={quickCreate} returnFocusRef={quickCreateTriggerRef} onClose={() => setQuickCreate(null)} />}
  </div>
}

export default App
