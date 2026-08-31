import type { TranslationKey } from './i18n'

export interface ProjectColorOption {
  value: string
  labelKey: TranslationKey
}

// A compact palette inspired by the semantic colors used in GitHub Primer and Tailwind UI.
export const PROJECT_COLOR_OPTIONS: readonly ProjectColorOption[] = [
  { value: '#d94f3d', labelKey: 'workspace.colorCoral' },
  { value: '#ef4444', labelKey: 'workspace.colorRed' },
  { value: '#f97316', labelKey: 'workspace.colorOrange' },
  { value: '#eab308', labelKey: 'workspace.colorAmber' },
  { value: '#22c55e', labelKey: 'workspace.colorGreen' },
  { value: '#14b8a6', labelKey: 'workspace.colorTeal' },
  { value: '#06b6d4', labelKey: 'workspace.colorCyan' },
  { value: '#3b82f6', labelKey: 'workspace.colorBlue' },
  { value: '#6366f1', labelKey: 'workspace.colorIndigo' },
  { value: '#8b5cf6', labelKey: 'workspace.colorViolet' },
  { value: '#ec4899', labelKey: 'workspace.colorPink' },
  { value: '#64748b', labelKey: 'workspace.colorSlate' }
]
