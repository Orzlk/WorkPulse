import { Download, FileText, Upload } from 'lucide-react'
import { useState } from 'react'
import { useToast } from './Toast'
import { useI18n } from '../stores/languageStore'

type TransferAction = 'import' | 'csv' | 'markdown' | null

export function WorkLogTransferCard(): JSX.Element {
  const { t } = useI18n()
  const toast = useToast()
  const [busy, setBusy] = useState<TransferAction>(null)

  const importLogs = async (): Promise<void> => {
    if (busy) return
    setBusy('import')
    try {
      const result = await window.api.import.logs()
      if (!result) return

      const message = result.source === 'flomo'
        ? result.skipped > 0
          ? t('worklog.importedFlomoSkipped', { imported: result.imported, skipped: result.skipped })
          : t('worklog.importedFlomo', { count: result.imported })
        : result.skipped > 0
          ? t('worklog.importedSkipped', { imported: result.imported, skipped: result.skipped })
          : t('worklog.imported', { count: result.imported })
      const attachmentMessages = result.source === 'flomo'
        ? [
            result.attachmentsImported > 0
              ? t('worklog.flomoAttachmentsImported', { count: result.attachmentsImported })
              : '',
            result.attachmentsSkipped > 0
              ? t('worklog.flomoAttachmentsSkipped', { count: result.attachmentsSkipped })
              : ''
          ].filter(Boolean)
        : []
      const attachmentMessage = attachmentMessages.length > 0 ? ` · ${attachmentMessages.join(' · ')}` : ''
      toast.success(`${message}${attachmentMessage}`)
    } catch {
      toast.error(t('worklog.importFailed'))
    } finally {
      setBusy(null)
    }
  }

  const exportLogs = async (format: 'csv' | 'markdown'): Promise<void> => {
    if (busy) return
    setBusy(format)
    try {
      const path = await window.api.export.logs(format)
      if (path) toast.success(t(format === 'csv' ? 'worklog.exportedCsv' : 'worklog.exportedMarkdown'))
    } catch {
      toast.error(t('worklog.exportFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="settings-data-card">
      <div className="settings-data-card-header">
        <div className="settings-data-card-icon" aria-hidden="true"><FileText /></div>
        <div>
          <h3>{t('settings.noteTransferTitle')}</h3>
          <p>{t('settings.noteTransferHelp')}</p>
        </div>
      </div>
      <div className="settings-data-card-actions">
        <button type="button" onClick={() => { void importLogs() }} disabled={Boolean(busy)}>
          <Upload aria-hidden="true" />
          {busy === 'import' ? t('common.importing') : t('common.import')}
        </button>
        <button type="button" onClick={() => { void exportLogs('csv') }} disabled={Boolean(busy)}>
          <Download aria-hidden="true" />
          {busy === 'csv' ? t('common.exporting') : t('worklog.exportCsv')}
        </button>
        <button type="button" onClick={() => { void exportLogs('markdown') }} disabled={Boolean(busy)}>
          <Download aria-hidden="true" />
          {busy === 'markdown' ? t('common.exporting') : t('worklog.exportMarkdown')}
        </button>
      </div>
    </div>
  )
}
