import { addMonths, addWeeks, format, parseISO, startOfMonth, startOfWeek, subDays } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'

export type ReportType = 'weekly' | 'monthly'

export interface ReportPeriod {
  type: ReportType
  startDate: string
  endDateExclusive: string
  fromUtc: string
  toUtc: string
  label: string
}

export function resolveReportPeriod(
  type: ReportType,
  anchorDate: string,
  timeZone: string
): ReportPeriod {
  const anchor = parseISO(anchorDate)
  const start = type === 'weekly' ? startOfWeek(anchor, { weekStartsOn: 1 }) : startOfMonth(anchor)
  const end = type === 'weekly' ? addWeeks(start, 1) : addMonths(start, 1)
  const startDate = format(start, 'yyyy-MM-dd')
  const endDateExclusive = format(end, 'yyyy-MM-dd')

  return {
    type,
    startDate,
    endDateExclusive,
    fromUtc: fromZonedTime(`${startDate}T00:00:00`, timeZone).toISOString(),
    toUtc: fromZonedTime(`${endDateExclusive}T00:00:00`, timeZone).toISOString(),
    label:
      type === 'weekly'
        ? `${startDate} 至 ${format(subDays(end, 1), 'yyyy-MM-dd')}`
        : `${startDate} 至 ${format(addMonths(start, 1), 'yyyy-MM-dd')}`
  }
}
