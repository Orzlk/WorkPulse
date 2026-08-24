export interface MainWindowSize {
  width: number
  height: number
}

export const MAIN_WINDOW_DEFAULT_SIZE: MainWindowSize = { width: 800, height: 600 }
export const MAIN_WINDOW_MIN_SIZE: MainWindowSize = { width: 400, height: 500 }

type SettingReader = (key: string) => string | null
type SettingWriter = (key: string, value: string) => void

function readDimension(value: string | null, fallback: number, minimum: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback
}

function normalizeDimension(value: number, fallback: number, minimum: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.round(value))
}

export function readMainWindowSize(getSetting: SettingReader): MainWindowSize {
  return {
    width: readDimension(getSetting('main_window_width'), MAIN_WINDOW_DEFAULT_SIZE.width, MAIN_WINDOW_MIN_SIZE.width),
    height: readDimension(getSetting('main_window_height'), MAIN_WINDOW_DEFAULT_SIZE.height, MAIN_WINDOW_MIN_SIZE.height)
  }
}

export function saveMainWindowSize(setSetting: SettingWriter, size: MainWindowSize): void {
  setSetting('main_window_width', String(normalizeDimension(size.width, MAIN_WINDOW_DEFAULT_SIZE.width, MAIN_WINDOW_MIN_SIZE.width)))
  setSetting('main_window_height', String(normalizeDimension(size.height, MAIN_WINDOW_DEFAULT_SIZE.height, MAIN_WINDOW_MIN_SIZE.height)))
}
