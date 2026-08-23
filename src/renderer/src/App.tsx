import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { BarChart3, ClipboardList, Columns3, FileText, FolderGit2, FolderKanban, Inbox, Plus, Search, Settings } from 'lucide-react'
import { QuickCreate } from './components/QuickCreate'
import { GlobalSearch } from './components/GlobalSearch'
import { useToast } from './components/Toast'
import { useThemeStore } from './stores/themeStore'
import { useLanguageStore } from './stores/languageStore'
import { useProjectStore } from './stores/projectStore'
import { useRepositoryStore } from './stores/repositoryStore'
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

const navigation: Array<{ page: Exclude<Page, 'settings'>; label: string; Icon: typeof ClipboardList }> = [
  { page: 'worklog', label: '日志', Icon: ClipboardList },
  { page: 'inbox', label: '收件箱', Icon: Inbox },
  { page: 'kanban', label: '看板', Icon: Columns3 },
  { page: 'projects', label: '项目', Icon: FolderKanban },
  { page: 'repositories', label: '仓库', Icon: FolderGit2 },
  { page: 'report', label: '报告', Icon: FileText },
  { page: 'stats', label: '统计', Icon: BarChart3 }
]

function App(): JSX.Element {
  const [currentPage, setCurrentPage] = useState<Page>('worklog')
  const [quickCreate, setQuickCreate] = useState<QuickCreateMode>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [inboxFocusId, setInboxFocusId] = useState<string | null>(null)
  const initTheme = useThemeStore((state) => state.init)
  const initLanguage = useLanguageStore((state) => state.init)
  const projects = useProjectStore((state) => state.items)
  const repositories = useRepositoryStore((state) => state.items)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const fetchRepositories = useRepositoryStore((state) => state.fetch)
  const toast = useToast()
  const updateDownloadedNotifiedRef = useRef(false)

  useEffect(() => { void initTheme(); void initLanguage(); void fetchProjects(); void fetchRepositories() }, [initTheme, initLanguage, fetchProjects, fetchRepositories])
  useEffect(() => {
    const unsubscribe = window.api.on.updateStatus((state) => {
      if (state.status === 'downloaded' && !updateDownloadedNotifiedRef.current) {
        updateDownloadedNotifiedRef.current = true
        toast.success('更新已下载，重启后安装。')
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

  const openInbox = useCallback((publicId: string) => { setInboxFocusId(publicId); setCurrentPage('inbox'); setSearchOpen(false) }, [])
  const renderPage = (): JSX.Element => {
    if (currentPage === 'worklog') return <WorkLogPage />
    if (currentPage === 'kanban') return <KanbanPage />
    if (currentPage === 'report') return <ReportPage />
    if (currentPage === 'stats') return <StatsPage />
    if (currentPage === 'settings') return <SettingsPage onBack={() => setCurrentPage('worklog')} />
    if (currentPage === 'inbox') return <InboxPage focusId={inboxFocusId} />
    if (currentPage === 'projects') return <ProjectsPage onOpenReports={() => setCurrentPage('report')} />
    return <RepositoriesPage />
  }

  return <div className="hallmark-app workspace-shell h-screen flex flex-col">
    <header className="app-header workspace-header">
      <div className="app-header-main"><button className="app-brand" onClick={() => setCurrentPage('worklog')} aria-label="WorkPulse 首页"><img src={brandSeal} alt="" className="app-brand-mark" /><h1>WorkPulse</h1></button><nav className="app-nav workspace-nav" aria-label="主导航">{navigation.map(({ page, label, Icon }) => <button key={page} onClick={() => setCurrentPage(page)} className={`app-nav-button ${currentPage === page ? 'is-active' : ''}`} aria-current={currentPage === page ? 'page' : undefined}><Icon aria-hidden="true" />{label}</button>)}</nav></div>
      <div className="header-actions"><button className="header-icon-button" onClick={() => setSearchOpen((open) => !open)} aria-label="打开全局搜索" aria-expanded={searchOpen}><Search aria-hidden="true" /></button><button className="header-create-button" onClick={() => setQuickCreate('inbox')}><Plus aria-hidden="true" />记录</button><button onClick={() => setCurrentPage('settings')} className="app-settings-button settings-spin" aria-label="设置"><Settings aria-hidden="true" /></button></div>
      {searchOpen && <GlobalSearch projects={projects} repositories={repositories} onOpenInbox={openInbox} />}
    </header>
    <main className="app-main flex-1 overflow-auto"><div className={`page-container workspace-content ${currentPage === 'kanban' ? 'page-container-wide' : ''}`}><Suspense fallback={<div className="page-loading" role="status">正在加载工作区…</div>}>{renderPage()}</Suspense></div></main>
    {quickCreate && <QuickCreate initialMode={quickCreate} onClose={() => setQuickCreate(null)} />}
  </div>
}

export default App
