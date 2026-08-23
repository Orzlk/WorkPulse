export const DEFAULT_STATS_DAYS = 30
export const MAX_STATS_DAYS = 366

export function isValidStatsDays(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= MAX_STATS_DAYS
}

export function assertStatsDays(value: number): number {
  if (!isValidStatsDays(value)) {
    throw new RangeError(`days must be an integer between 1 and ${MAX_STATS_DAYS}`)
  }
  return value
}
