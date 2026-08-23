import { subMilliseconds } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'

export interface ReportDisplayPeriod {
  startDate: string
  endDateInclusive: string
}

export function getReportAnchorDate(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now)
  const values = new Map(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  const year = values.get('year')
  const month = values.get('month')
  const day = values.get('day')
  if (!year || !month || !day) throw new RangeError('Unable to determine calendar date')
  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

export function getReportDisplayPeriod(
  periodStartUtc: string,
  periodEndExclusiveUtc: string,
  timeZone: string
): ReportDisplayPeriod {
  return {
    startDate: formatInTimeZone(periodStartUtc, timeZone, 'yyyy-MM-dd'),
    endDateInclusive: formatInTimeZone(subMilliseconds(new Date(periodEndExclusiveUtc), 1), timeZone, 'yyyy-MM-dd')
  }
}
