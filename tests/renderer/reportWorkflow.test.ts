import { describe, expect, it } from 'vitest'

import {
  buildReportExportName,
  getHistoryReportState,
  getLatestCompleteReportAnchor,
  getReportGenerationError,
  getRetryReportRequest,
  hasReportPreviewData,
  toggleReportScope
} from '../../src/renderer/src/lib/reportWorkflow'
import { appendGenerationChunk, createReportContentState, selectHistoricalReport } from '../../src/renderer/src/pages/ReportPage'

describe('report workflow helpers', () => {
  it('uses the latest complete Monday-to-Sunday week in the user timezone', () => {
    expect(getLatestCompleteReportAnchor('weekly', 'Asia/Shanghai', new Date('2026-08-24T00:30:00.000Z')))
      .toBe('2026-08-23')
    expect(getLatestCompleteReportAnchor('weekly', 'America/Los_Angeles', new Date('2026-08-24T00:30:00.000Z')))
      .toBe('2026-08-16')
  })

  it('uses the previous natural month in the user timezone', () => {
    expect(getLatestCompleteReportAnchor('monthly', 'Asia/Shanghai', new Date('2026-09-01T00:30:00.000Z')))
      .toBe('2026-08-01')
    expect(getLatestCompleteReportAnchor('monthly', 'America/New_York', new Date('2026-09-01T00:30:00.000Z')))
      .toBe('2026-07-01')
  })

  it('builds a local-date report export name', () => {
    expect(buildReportExportName({
      type: 'weekly',
      display_start: '2026-08-17',
      display_end_inclusive: '2026-08-23'
    })).toBe('workpulse-weekly-2026-08-17-to-2026-08-23')
  })

  it('maps known AI failures to stable user-facing states', () => {
    expect(getReportGenerationError(new Error('API key is not configured'))).toBe('no_key')
    expect(getReportGenerationError(new Error('Request timed out after 60 seconds'))).toBe('timeout')
    expect(getReportGenerationError(new Error('AI provider response is invalid'))).toBe('invalid_response')
    expect(getReportGenerationError(new Error('other failure'))).toBe('unknown')
  })

  it('keeps both project ids when a second project is selected', () => {
    expect(toggleReportScope(['project-a'], 'project-b')).toEqual(['project-a', 'project-b'])
    expect(toggleReportScope(['project-a', 'project-b'], 'project-a')).toEqual(['project-b'])
  })

  it('restores a historical error report with retry metadata and its original request', () => {
    const report = {
      type: 'weekly',
      display_start: '2026-08-17',
      display_end_inclusive: '2026-08-23',
      timezone: 'Asia/Shanghai',
      project_scope: ['project-a', 'project-b'],
      repository_scope: ['repo-a'],
      status: 'error' as const,
      error_message: 'AI request timed out',
      retry_count: 2
    }
    expect(getHistoryReportState(report)).toEqual({
      status: 'error',
      errorMessage: 'AI request timed out',
      retryCount: 2
    })
    expect(getRetryReportRequest(report)).toEqual({
      type: 'weekly',
      anchorDate: '2026-08-17',
      timeZone: 'Asia/Shanghai',
      projectIds: ['project-a', 'project-b'],
      repositoryIds: ['repo-a']
    })
  })

  it('recognizes an empty preview before generation', () => {
    expect(hasReportPreviewData({ work_log_count: 0, task_count: 0, inbox_count: 0, git_commit_count: 0 })).toBe(false)
    expect(hasReportPreviewData({ work_log_count: 1, task_count: 0, inbox_count: 0, git_commit_count: 0 })).toBe(true)
  })

  it('keeps old generation chunks out of a selected historical report', () => {
    const generating = appendGenerationChunk(createReportContentState(), 'partial generation')
    const historical = selectHistoricalReport(generating, 'saved history')
    const staleChunk = appendGenerationChunk(historical, ' stale')

    expect(staleChunk.generationContent).toBe('partial generation stale')
    expect(staleChunk.viewContent).toBe('saved history')
  })
})
