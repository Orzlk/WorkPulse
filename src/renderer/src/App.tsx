import { useState, useEffect, useCallback, useRef } from 'react'
import { Settings, FileText, ClipboardList, Columns3, BarChart3 } from 'lucide-react'
import WorkLogPage from './pages/WorkLogPage'
import ReportPage from './pages/ReportPage'
import KanbanPage from './pages/KanbanPage'
import StatsPage from './pages/StatsPage'
import SettingsPage from './pages/SettingsPage'
import { QuickCreate } from './components/QuickCreate'
import { useToast } from './components/Toast'
import { useThemeStore } from './stores/themeStore'
import { useI18n, useLanguageStore } from './stores/languageStore'
import brandSeal from './assets/brand-seal.png'

type Page = 'worklog' | 'kanban' | 'report' | 'stats' | 'settings'
type QuickCreateMode = 'log' | 'task' | null

function App(): JSX.Element {
  const [currentPage, setCurrentPage] = useState<Page>('worklog')
  const [quickCreate, setQuickCreate] = useState<QuickCreateMode>(null)
  const initTheme = useThemeStore((s) => s.init)
  const initLanguage = useLanguageStore((s) => s.init)
  const { t } = useI18n()
  const toast = useToast()
  const updateDownloadedNotifiedRef = useRef(false)

  useEffect(() => {
    initTheme()
    initLanguage()
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.on.updateStatus((state) => {
      if (state.status === 'downloaded' && !updateDownloadedNotifiedRef.current) {
        updateDownloadedNotifiedRef.current = true
        toast.success(t('settings.updateDownloaded'))
      }
    })

    return unsubscribe
  }, [t, toast])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't handle if quick-create is open (it handles its own keys)
      if (quickCreate) return

      const isMod = e.metaKey || e.ctrlKey

      if (isMod && e.key === '1') {
        e.preventDefault(); setCurrentPage('worklog')
      } else if (isMod && e.key === '2') {
        e.preventDefault(); setCurrentPage('kanban')
      } else if (isMod && e.key === '3') {
        e.preventDefault(); setCurrentPage('report')
      } else if (isMod && e.key === '4') {
        e.preventDefault(); setCurrentPage('stats')
      } else if (isMod && e.key === ',') {
        e.preventDefault(); setCurrentPage('settings')
      } else if (e.key === 'Escape' && currentPage === 'settings') {
        setCurrentPage('worklog')
      }
    },
    [currentPage, quickCreate]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Listen for IPC events from main process (menu bar / global shortcuts)
  useEffect(() => {
    const unsubCreate = window.api.on.quickCreate((type) => {
      setQuickCreate(type)
    })
    const unsubNav = window.api.on.navigate((page) => {
      setCurrentPage(page)
    })
    return () => {
      unsubCreate()
      unsubNav()
    }
  }, [])

  // Track page changes for transition direction
  const prevPageRef = useRef<Page>(currentPage)
  const [pageKey, setPageKey] = useState(0)

  useEffect(() => {
    if (prevPageRef.current !== currentPage) {
      prevPageRef.current = currentPage
      setPageKey((k) => k + 1)
    }
  }, [currentPage])

  if (currentPage === 'settings') {
    return <SettingsPage onBack={() => setCurrentPage('worklog')} />
  }

  const navBtn = (page: Page, icon: JSX.Element, label: string): JSX.Element => (
    <button
      onClick={() => setCurrentPage(page)}
      className={`app-nav-button ${currentPage === page ? 'is-active' : ''}`}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <div className="hallmark-app h-screen flex flex-col">
      {/* Header */}
      <header className="app-header">
        <div className="app-header-main">
          <div className="app-brand" aria-label="WorkPulse">
            <img src={brandSeal} alt="" className="app-brand-mark" />
            <h1>WorkPulse</h1>
          </div>
          <nav className="app-nav" aria-label="Primary navigation">
            {navBtn('worklog', <ClipboardList className="inline-block w-4 h-4 mr-1 -mt-0.5" />, t('nav.worklog'))}
            {navBtn('kanban', <Columns3 className="inline-block w-4 h-4 mr-1 -mt-0.5" />, t('nav.kanban'))}
            {navBtn('report', <FileText className="inline-block w-4 h-4 mr-1 -mt-0.5" />, t('nav.report'))}
            {navBtn('stats', <BarChart3 className="inline-block w-4 h-4 mr-1 -mt-0.5" />, t('nav.stats'))}
          </nav>
        </div>
        <button
          onClick={() => setCurrentPage('settings')}
          className="app-settings-button settings-spin"
          aria-label={t('nav.settings')}
        >
          <Settings className="w-5 h-5" />
        </button>
      </header>

      {/* Content with page transition */}
      <main className="app-main flex-1 overflow-auto">
        <div key={pageKey} className={`page-container page-enter ${currentPage === 'kanban' ? 'page-container-wide' : ''}`}>
          {currentPage === 'worklog' && <WorkLogPage />}
          {currentPage === 'kanban' && <KanbanPage />}
          {currentPage === 'report' && <ReportPage />}
          {currentPage === 'stats' && <StatsPage />}
        </div>
      </main>

      {/* Quick Create overlay */}
      {quickCreate && (
        <QuickCreate
          initialMode={quickCreate}
          onClose={() => setQuickCreate(null)}
        />
      )}
    </div>
  )
}

export default App
