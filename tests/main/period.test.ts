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
      endDateExclusive: '2026-09-01'
    })
  })

  it('根据工作区时区输出不同的 UTC 边界', () => {
    const shanghaiPeriod = resolveReportPeriod('weekly', '2026-08-23', 'Asia/Shanghai')
    const losAngelesPeriod = resolveReportPeriod('weekly', '2026-08-23', 'America/Los_Angeles')

    expect(shanghaiPeriod.fromUtc).not.toBe(losAngelesPeriod.fromUtc)
    expect(shanghaiPeriod.toUtc).not.toBe(losAngelesPeriod.toUtc)
  })
})
