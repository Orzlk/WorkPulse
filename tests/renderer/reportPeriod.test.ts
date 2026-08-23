import { describe, expect, it } from 'vitest'

import { getReportDisplayPeriod } from '../../src/renderer/src/lib/reportPeriod'

describe('report display period', () => {
  it('converts UTC half-open boundaries to local inclusive calendar dates', () => {
    expect(getReportDisplayPeriod(
      '2026-08-16T16:00:00.000Z',
      '2026-08-23T16:00:00.000Z',
      'Asia/Shanghai'
    )).toEqual({ startDate: '2026-08-17', endDateInclusive: '2026-08-23' })
  })
})
