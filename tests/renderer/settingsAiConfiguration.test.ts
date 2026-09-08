import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/SettingsPage.tsx'), 'utf8')
const i18n = readFileSync(resolve(root, 'src/renderer/src/lib/i18n.ts'), 'utf8')

describe('AI provider configuration UI', () => {
  it('exposes presets, protocol, authentication and advanced headers', () => {
    expect(page).toContain('AI_PROVIDER_PRESETS')
    expect(page).toContain('settings.protocol')
    expect(page).toContain('settings.authMode')
    expect(page).toContain('settings.customHeaders')
    expect(page).toContain('settings.addHeader')
  })

  it('supports local providers without forcing an API key', () => {
    expect(page).toContain("authMode === 'none'")
    expect(page).toContain('settings.noApiKeyRequired')
  })

  it('provides bilingual labels for the provider form', () => {
    expect(i18n).toContain("'settings.providerOpenAI'")
    expect(i18n).toContain("'settings.providerOpenCodeGo'")
    expect(i18n).toContain("'settings.protocolOpenAiChat'")
    expect(i18n).toContain("'settings.authNone'")
  })

  it('keeps the endpoint and model controls aligned when help text wraps', () => {
    expect(page).toContain('settings-ai-core-fields')
    expect(page).toContain('settings-ai-field-help')
    expect(readFileSync(resolve(root, 'src/renderer/src/styles/ui-system.css'), 'utf8'))
      .toContain('.settings-ai-core-fields .settings-ai-field-help')
  })

  it('offers a refreshable editable model picker', () => {
    expect(page).toContain('window.api.ai.listModels')
    expect(page).toContain('list="ai-model-options"')
    expect(page).toContain('settings.refreshModels')
    expect(i18n).toContain("'settings.modelsLoaded'")
  })
})
