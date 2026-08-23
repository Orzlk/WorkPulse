import { describe, expect, it } from 'vitest'

import { getReportAnchorDate, getReportDisplayPeriod } from '../../src/renderer/src/lib/reportPeriod'

describe('report display period', () => {
  it('converts UTC half-open boundaries to local inclusive calendar dates', () => {
    expect(getReportDisplayPeriod(
      '2026-08-16T16:00:00.000Z',
      '2026-08-23T16:00:00.000Z',
      'Asia/Shanghai'
    )).toEqual({ startDate: '2026-08-17', endDateInclusive: '2026-08-23' })
  })

  it('uses the positive timezone calendar date at month boundaries', () => {
    expect(getReportAnchorDate('Asia/Shanghai', new Date('2025-12-31T16:30:00.000Z'))).toBe('2026-01-01')
    expect(getReportAnchorDate('Asia/Shanghai', new Date('2026-02-28T16:30:00.000Z'))).toBe('2026-03-01')
  })

  it('uses the negative timezone calendar date at month boundaries', () => {
    expect(getReportAnchorDate('America/New_York', new Date('2026-02-01T04:30:00.000Z'))).toBe('2026-01-31')
    expect(getReportAnchorDate('America/New_York', new Date('2026-03-01T04:30:00.000Z'))).toBe('2026-02-28')
  })
})
