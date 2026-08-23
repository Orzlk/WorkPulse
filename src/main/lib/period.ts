import { addMonths, addWeeks, format, isValid, parseISO, startOfMonth, startOfWeek, subDays } from 'date-fns'
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

  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate) || !isValid(anchor)) {
    throw new RangeError(`Invalid anchorDate: ${anchorDate}`)
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format()
  } catch {
    throw new RangeError(`Invalid timeZone: ${timeZone}`)
  }

  const start = type === 'weekly' ? startOfWeek(anchor, { weekStartsOn: 1 }) : startOfMonth(anchor)
  const end = type === 'weekly' ? addWeeks(start, 1) : addMonths(start, 1)
  const startDate = format(start, 'yyyy-MM-dd')
  const endDateExclusive = format(end, 'yyyy-MM-dd')
  const labelEnd = format(subDays(end, 1), 'yyyy-MM-dd')

  return {
    type,
    startDate,
    endDateExclusive,
    fromUtc: fromZonedTime(`${startDate}T00:00:00`, timeZone).toISOString(),
    toUtc: fromZonedTime(`${endDateExclusive}T00:00:00`, timeZone).toISOString(),
    label: `${startDate} 至 ${labelEnd}`
  }
}
