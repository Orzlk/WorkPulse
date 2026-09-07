import { describe, expect, it } from 'vitest'
import { formatDate, formatTime, getLocalDateKey, groupLogsByDate } from '../../src/renderer/src/lib/dateUtils'

describe('work log local date formatting', () => {
  const timeZone = 'Asia/Shanghai'

  it('uses the supplied time zone for grouping and display', () => {
    const logs = [{ id: 1, created_at: '2026-09-01T23:30:00.000Z' }, { id: 2, created_at: '2026-09-02T00:30:00.000Z' }]
    const groups = groupLogsByDate(logs, timeZone)

    expect([...groups.keys()]).toEqual(['2026-09-02'])
    expect(getLocalDateKey('2026-09-01T23:30:00.000Z', timeZone)).toBe('2026-09-02')
    expect(formatTime('2026-09-01T23:30:00.000Z', timeZone)).toBe('07:30')
    expect(formatDate('2026-09-01T23:30:00.000Z', 'zh', timeZone)).toBe('9月2日 星期三')
  })
})
