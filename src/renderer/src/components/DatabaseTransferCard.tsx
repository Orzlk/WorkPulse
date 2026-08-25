import { Database, Download, Upload } from 'lucide-react'
import { useState } from 'react'
import { useToast } from './Toast'
import { useI18n } from '../stores/languageStore'

interface DatabaseImportPreview {
  schema_version: number
  records: Record<string, number>
  total_records: number
}

interface DatabaseImportReview {
  token: string
  preview: DatabaseImportPreview
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
  const [busy, setBusy] = useState<'export' | 'import' | 'merge' | null>(null)

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
      if (isImportReview(result)) setPreview({ token: result.token, preview: result.preview as DatabaseImportPreview })
    } catch {
      toast.error(t('settings.databaseImportFailed'))
    } finally {
      setBusy(null)
    }
  }

  const mergeDatabase = async (): Promise<void> => {
    if (!preview || busy) return
    setBusy('merge')
    try {
      const result = await window.api.database.import({ action: 'merge', token: preview.token })
      if (!isImportResult(result)) throw new Error('Invalid import result')
      setPreview(null)
      toast.success(t('settings.databaseImportMerged', {
        inserted: result.inserted,
        conflicts: result.conflicts,
        skipped: result.skipped
      }))
      window.setTimeout(() => window.location.reload(), 700)
    } catch {
      toast.error(t('settings.databaseImportFailed'))
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
        <button type="button" onClick={() => { void previewDatabase() }} disabled={Boolean(busy)}>
          <Upload aria-hidden="true" />
          {busy === 'import' ? t('settings.databaseImporting') : t('settings.databaseImport')}
        </button>
      </div>

      {preview && (
        <div className="settings-transfer-backdrop" role="presentation">
          <div className="settings-transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="database-import-preview-title">
            <h3 id="database-import-preview-title">{t('settings.databaseImportPreview')}</h3>
            <p>{t('settings.databaseImportPreviewHelp')}</p>
            <div className="settings-transfer-summary">
              <strong>{t('settings.databaseImportRecords', { count: preview.preview.total_records })}</strong>
              <span>{t('settings.databaseImportSchema', { version: preview.preview.schema_version })}</span>
            </div>
            <div className="settings-transfer-dialog-actions">
              <button type="button" onClick={() => setPreview(null)} disabled={busy === 'merge'}>{t('common.cancel')}</button>
              <button type="button" className="primary-action" onClick={() => { void mergeDatabase() }} disabled={busy === 'merge'}>
                {busy === 'merge' ? t('settings.databaseMerging') : t('settings.databaseImportConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
