import { Database, Download, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useToast } from './Toast'
import { useI18n } from '../stores/languageStore'
import { useOverlayStack } from './OverlayStack'

interface DatabaseImportPreview {
  schema_version: number
  records: Record<string, number>
  total_records: number
}

interface DatabaseImportReview {
  token: string
  preview: DatabaseImportPreview
  archive: boolean
  attachments?: number
}

interface DatabaseImportResult {
  inserted: number
  conflicts: number
  skipped: number
  conflict_public_ids: string[]
}

function isImportReview(value: unknown): value is DatabaseImportReview {
  if (!value || typeof value !== 'object' || !('token' in value) || !('preview' in value)) return false
  const candidate = value as { token?: unknown; preview?: unknown }
  return typeof candidate.token === 'string' && Boolean(candidate.preview && typeof candidate.preview === 'object')
}

function isImportResult(value: unknown): value is DatabaseImportResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DatabaseImportResult>
  return typeof candidate.inserted === 'number' && typeof candidate.conflicts === 'number' && typeof candidate.skipped === 'number'
}

export function DatabaseTransferCard(): JSX.Element {
  const { t } = useI18n()
  const toast = useToast()
  const [preview, setPreview] = useState<DatabaseImportReview | null>(null)
  const [busy, setBusy] = useState<'export' | 'import' | 'merge' | 'archive-export' | 'archive-import' | 'archive-merge' | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const overlayStack = useOverlayStack()
  const requestClose = (): boolean => {
    if (busy === 'merge' || busy === 'archive-merge') return false
    setPreview(null)
    return true
  }

  useEffect(() => {
    if (!preview) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      previousFocusRef.current?.focus()
    }
  }, [preview])

  useEffect(() => {
    if (!preview) return
    return overlayStack.register({ id: 'database-import-preview', priority: 200, requestClose })
  }, [overlayStack, preview, requestClose])

  const exportDatabase = async (): Promise<void> => {
    if (busy) return
    setBusy('export')
    try {
      const result = await window.api.database.export()
      if (result) toast.success(t('settings.databaseExported', { path: result.filePath }))
    } catch {
      toast.error(t('settings.databaseExportFailed'))
    } finally {
      setBusy(null)
    }
  }

  const previewDatabase = async (): Promise<void> => {
    if (busy) return
    setBusy('import')
    try {
      const result = await window.api.database.import({ action: 'preview' })
      if (isImportReview(result)) setPreview({ token: result.token, preview: result.preview as DatabaseImportPreview, archive: false })
    } catch {
      toast.error(t('settings.databaseImportFailed'))
    } finally {
      setBusy(null)
    }
  }

  const exportArchive = async (): Promise<void> => {
    if (busy) return
    setBusy('archive-export')
    try {
      const result = await window.api.database.archiveExport()
      if (result) toast.success(t('settings.databaseArchiveExported', { path: result.filePath, count: result.attachments }))
    } catch {
      toast.error(t('settings.databaseArchiveExportFailed'))
    } finally {
      setBusy(null)
    }
  }

  const previewArchive = async (): Promise<void> => {
    if (busy) return
    setBusy('archive-import')
    try {
      const result = await window.api.database.archiveImport({ action: 'preview' })
      if (isImportReview(result)) {
        const archiveResult = result as { token: string; preview: DatabaseImportPreview; attachments?: number }
        setPreview({ token: archiveResult.token, preview: archiveResult.preview, archive: true, attachments: archiveResult.attachments })
      }
    } catch {
      toast.error(t('settings.databaseArchiveImportFailed'))
    } finally {
      setBusy(null)
    }
  }

  const mergeDatabase = async (): Promise<void> => {
    if (!preview || busy) return
    setBusy(preview.archive ? 'archive-merge' : 'merge')
    try {
      const result = preview.archive
        ? await window.api.database.archiveImport({ action: 'merge', token: preview.token })
        : await window.api.database.import({ action: 'merge', token: preview.token })
      if (!isImportResult(result)) throw new Error('Invalid import result')
      setPreview(null)
      toast.success(t('settings.databaseImportMerged', {
        inserted: result.inserted,
        conflicts: result.conflicts,
        skipped: result.skipped
      }))
      window.setTimeout(() => window.location.reload(), 700)
    } catch {
      toast.error(t(preview?.archive ? 'settings.databaseArchiveImportFailed' : 'settings.databaseImportFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="settings-data-card">
      <div className="settings-data-card-header">
        <div className="settings-data-card-icon" aria-hidden="true"><Database /></div>
        <div>
          <h3>{t('settings.databaseTransferTitle')}</h3>
          <p>{t('settings.databaseTransferHelp')}</p>
        </div>
      </div>
      <div className="settings-data-card-actions">
        <button type="button" onClick={() => { void exportDatabase() }} disabled={Boolean(busy)}>
          <Download aria-hidden="true" />
          {busy === 'export' ? t('settings.databaseExporting') : t('settings.databaseExport')}
        </button>
        <button type="button" onClick={() => { void exportArchive() }} disabled={Boolean(busy)}>
          <Download aria-hidden="true" />
          {busy === 'archive-export' ? t('settings.databaseArchiveExporting') : t('settings.databaseArchiveExport')}
        </button>
        <button type="button" onClick={() => { void previewDatabase() }} disabled={Boolean(busy)}>
          <Upload aria-hidden="true" />
          {busy === 'import' ? t('settings.databaseImporting') : t('settings.databaseImport')}
        </button>
        <button type="button" onClick={() => { void previewArchive() }} disabled={Boolean(busy)}>
          <Upload aria-hidden="true" />
          {busy === 'archive-import' ? t('settings.databaseArchiveImporting') : t('settings.databaseArchiveImport')}
        </button>
      </div>

      {preview && (
        <div className="settings-transfer-backdrop" role="presentation">
          <div ref={dialogRef} tabIndex={-1} className="settings-transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="database-import-preview-title">
            <h3 id="database-import-preview-title">{t('settings.databaseImportPreview')}</h3>
            <p>{t('settings.databaseImportPreviewHelp')}</p>
            <div className="settings-transfer-summary">
              <strong>{t('settings.databaseImportRecords', { count: preview.preview.total_records })}</strong>
              <span>{t('settings.databaseImportSchema', { version: preview.preview.schema_version })}</span>
              {preview.archive && <span>{t('settings.databaseArchiveAttachments', { count: preview.attachments ?? 0 })}</span>}
            </div>
            <div className="settings-transfer-dialog-actions">
              <button type="button" onClick={requestClose} disabled={busy === 'merge'}>{t('common.cancel')}</button>
              <button type="button" className="primary-action" onClick={() => { void mergeDatabase() }} disabled={busy === 'merge' || busy === 'archive-merge'}>
                {busy === 'merge' || busy === 'archive-merge' ? t('settings.databaseMerging') : t('settings.databaseImportConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
