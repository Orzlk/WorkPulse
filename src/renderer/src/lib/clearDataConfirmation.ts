const CLEAR_DATA_CONFIRMATION_TEXT = {
  zh: '清除全部数据',
  en: 'CLEAR ALL DATA'
} as const

export function isClearDataConfirmationValid(value: string, language: 'zh' | 'en'): boolean {
  return value === CLEAR_DATA_CONFIRMATION_TEXT[language]
}
