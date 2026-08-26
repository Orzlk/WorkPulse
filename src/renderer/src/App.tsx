import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { BarChart3, ClipboardList, Columns3, FolderKanban, Plus, Search, Settings } from 'lucide-react'
import { QuickCreate } from './components/QuickCreate'
import { GlobalSearch } from './components/GlobalSearch'
import { useToast } from './components/Toast'
import { useThemeStore } from './stores/themeStore'
import { useLanguageStore } from './stores/languageStore'
import { useProjectStore } from './stores/projectStore'
import { useRepositoryStore } from './stores/repositoryStore'
import { useI18n } from './stores/languageStore'
import type { SearchResult } from './lib/workspaceTypes'
import { parseWorkLogEditorRoute } from './lib/workLogEditorRoute'
import workpulseMark from './assets/workpulse-mark.png'

const WorkLogPage = lazy(() => import('./pages/WorkLogPage'))
const KanbanPage = lazy(() => import('./pages/KanbanPage'))
const ReportPage = lazy(() => import('./pages/ReportPage'))
const StatsPage = lazy(() => import('./pages/StatsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const InboxPage = lazy(() => import('./pages/InboxPage'))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'))
const RepositoriesPage = lazy(() => import('./pages/RepositoriesPage'))
const WorkLogEditorPage = lazy(() => import('./pages/WorkLogEditorPage'))

type Page = 'worklog' | 'kanban' | 'report' | 'stats' | 'settings' | 'inbox' | 'projects' | 'repositories'
type QuickCreateMode = 'log' | 'task' | 'inbox' | null

const primaryNavigation: Array<{
  id: string
  labelKey: 'nav.records' | 'nav.tasks' | 'nav.projects' | 'nav.review'
  Icon: typeof ClipboardList
  defaultPage: Exclude<Page, 'settings'>
  pages: Array<Exclude<Page, 'settings'>>
}> = [
  { id: 'records', labelKey: 'nav.records', Icon: ClipboardList, defaultPage: 'worklog', pages: ['worklog', 'inbox'] },
  { id: 'tasks', labelKey: 'nav.tasks', Icon: Columns3, defaultPage: 'kanban', pages: ['kanban'] },
  { id: 'projects', labelKey: 'nav.projects', Icon: FolderKanban, defaultPage: 'projects', pages: ['projects', 'repositories'] },
  { id: 'review', labelKey: 'nav.review', Icon: BarChart3, defaultPage: 'report', pages: ['report', 'stats'] }
]

function MainApp(): JSX.Element {
  const [currentPage, setCurrentPage] = useState<Page>('worklog')
  const [quickCreate, setQuickCreate] = useState<QuickCreateMode>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [inboxFocusId, setInboxFocusId] = useState<string | null>(null)
  const [workLogFocusId, setWorkLogFocusId] = useState<string | null>(null)
  const [taskFocusId, setTaskFocusId] = useState<string | null>(null)
  const [repositoryFocusId, setRepositoryFocusId] = useState<string | null>(null)
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
      else if (mod && event.key === '3') { event.preventDefault(); setCurrentPage('projects') }
      else if (mod && event.key === '4') { event.preventDefault(); setCurrentPage('report') }
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
      setWorkLogFocusId(result.public_id)
      setCurrentPage('worklog')
    } else if (result.source === 'task') {
      setTaskFocusId(result.public_id)
      setCurrentPage('kanban')
    } else if (result.source === 'git_commit') {
      setRepositoryFocusId(result.repository_id)
      setCurrentPage('repositories')
    } else {
      setReportProjectId(result.project_id)
      setCurrentPage('report')
    }
    setSearchOpen(false)
  }, [])
  const renderPage = (): JSX.Element => {
    if (currentPage === 'worklog') return <WorkLogPage focusPublicId={workLogFocusId} onOpenInbox={() => setCurrentPage('inbox')} />
    if (currentPage === 'kanban') return <KanbanPage focusPublicId={taskFocusId} />
    if (currentPage === 'report') return <ReportPage projectId={reportProjectId} onProjectChange={setReportProjectId} onOpenInbox={() => setCurrentPage('inbox')} onOpenStats={() => setCurrentPage('stats')} />
    if (currentPage === 'stats') return <StatsPage onOpenReports={() => setCurrentPage('report')} />
    if (currentPage === 'settings') return <SettingsPage onBack={() => setCurrentPage('worklog')} />
    if (currentPage === 'inbox') return <InboxPage focusId={inboxFocusId} onOpenRecords={() => setCurrentPage('worklog')} />
    if (currentPage === 'projects') return <ProjectsPage onOpenReports={(projectId) => { setReportProjectId(projectId); setCurrentPage('report') }} onOpenRepositories={() => setCurrentPage('repositories')} />
    return <RepositoriesPage focusPublicId={repositoryFocusId} onOpenProjects={() => setCurrentPage('projects')} />
  }

  return <div className="hallmark-app workspace-shell h-screen flex flex-col">
    <header className="app-header workspace-header">
      <div className="app-header-main"><button className="app-brand" onClick={() => setCurrentPage('worklog')} aria-label={t('nav.home')}><img src={workpulseMark} alt="" className="app-brand-mark" /><h1>WorkPulse</h1></button><nav className="app-nav workspace-nav" aria-label={t('nav.main')}>{primaryNavigation.map((group) => { const active = group.pages.includes(currentPage as Exclude<Page, 'settings'>); return <button key={group.id} onClick={() => setCurrentPage(group.defaultPage)} className={`app-nav-button ui-nav-item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined} data-navigation-group={group.id}><group.Icon aria-hidden="true" />{t(group.labelKey)}</button> })}</nav></div>
      <div className="header-actions"><button className="header-icon-button ui-icon-button" onClick={() => setSearchOpen((open) => !open)} aria-label={t('nav.search')} aria-expanded={searchOpen}><Search aria-hidden="true" /></button><button ref={quickCreateTriggerRef} className="header-create-button ui-button ui-button--primary" onClick={() => setQuickCreate('inbox')}><Plus aria-hidden="true" />{t('nav.quickCreate')}</button><button onClick={() => setCurrentPage('settings')} className="app-settings-button ui-icon-button settings-spin" aria-label={t('nav.settings')}><Settings aria-hidden="true" /></button></div>
      {searchOpen && <GlobalSearch onOpenResult={openSearchResult} />}
    </header>
    <main className="app-main flex-1 overflow-auto"><div className={`page-container workspace-content ${currentPage === 'kanban' ? 'page-container-wide' : ''}`}><Suspense fallback={<div className="page-loading" role="status">{t('common.loading')}</div>}>{renderPage()}</Suspense></div></main>
    {quickCreate && <QuickCreate initialMode={quickCreate} returnFocusRef={quickCreateTriggerRef} onClose={() => setQuickCreate(null)} />}
  </div>
}

function App(): JSX.Element {
  const route = parseWorkLogEditorRoute(window.location.search)
  if (route.isEditor && route.publicId) {
    return (
      <div className="hallmark-app workspace-shell h-screen">
        <Suspense fallback={<div className="page-loading" role="status">加载中...</div>}>
          <WorkLogEditorPage publicId={route.publicId} />
        </Suspense>
      </div>
    )
  }
  return <MainApp />
}

export default App
