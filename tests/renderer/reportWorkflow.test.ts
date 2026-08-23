import { describe, expect, it } from 'vitest'

import {
  buildReportExportName,
  getLatestCompleteReportAnchor,
  getReportGenerationError
} from '../../src/renderer/src/lib/reportWorkflow'

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
})
