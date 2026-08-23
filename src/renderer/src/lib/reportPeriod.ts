import { subMilliseconds } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'

export interface ReportDisplayPeriod {
  startDate: string
  endDateInclusive: string
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
