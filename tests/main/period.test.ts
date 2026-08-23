import { describe, expect, it } from 'vitest'

import { resolveReportPeriod } from '../../src/main/lib/period'

describe('resolveReportPeriod', () => {
  it('按周一到下周一计算自然周', () => {
    const period = resolveReportPeriod('weekly', '2026-08-23', 'Asia/Shanghai')

    expect(period).toMatchObject({
      type: 'weekly',
      startDate: '2026-08-17',
      endDateExclusive: '2026-08-24',
      label: '2026-08-17 至 2026-08-23'
    })
  })

  it('按月初到下月初计算自然月', () => {
    const period = resolveReportPeriod('monthly', '2026-08-23', 'Asia/Shanghai')

    expect(period).toMatchObject({
      type: 'monthly',
      startDate: '2026-08-01',
      endDateExclusive: '2026-09-01',
      label: '2026-08-01 至 2026-08-31'
    })
  })

  it('输出上海时区自然周的具体 UTC 左闭右开边界', () => {
    const period = resolveReportPeriod('weekly', '2026-08-23', 'Asia/Shanghai')

    expect(period.fromUtc).toBe('2026-08-16T16:00:00.000Z')
    expect(period.toUtc).toBe('2026-08-23T16:00:00.000Z')
    expect(period.fromUtc < period.toUtc).toBe(true)
  })

  it('支持周一输入以及跨月、跨年周期', () => {
    const monday = resolveReportPeriod('weekly', '2026-08-17', 'Asia/Shanghai')
    const newYear = resolveReportPeriod('weekly', '2027-01-01', 'Asia/Shanghai')
    const yearEnd = resolveReportPeriod('monthly', '2026-12-31', 'Asia/Shanghai')

    expect(monday.startDate).toBe('2026-08-17')
    expect(monday.endDateExclusive).toBe('2026-08-24')
    expect(newYear.startDate).toBe('2026-12-28')
    expect(newYear.endDateExclusive).toBe('2027-01-04')
    expect(yearEnd.endDateExclusive).toBe('2027-01-01')
    expect(yearEnd.label).toBe('2026-12-01 至 2026-12-31')
  })

  it('处理洛杉矶冬令时切换时的自然周边界', () => {
    const period = resolveReportPeriod('weekly', '2026-10-26', 'America/Los_Angeles')

    expect(period.fromUtc).toBe('2026-10-26T07:00:00.000Z')
    expect(period.toUtc).toBe('2026-11-02T08:00:00.000Z')
    expect(period.fromUtc < period.toUtc).toBe(true)
  })

  it('对非法日期和时区抛出明确的 RangeError', () => {
    expect(() => resolveReportPeriod('weekly', 'not-a-date', 'Asia/Shanghai')).toThrow(
      new RangeError('Invalid anchorDate: not-a-date')
    )
    expect(() => resolveReportPeriod('monthly', '2026-02-30', 'Asia/Shanghai')).toThrow(
      new RangeError('Invalid anchorDate: 2026-02-30')
    )
    expect(() => resolveReportPeriod('weekly', '2026-08-23', 'Not/AZone')).toThrow(
      new RangeError('Invalid timeZone: Not/AZone')
    )
  })
})
