import { describe, expect, it } from 'vitest'

import {
  AI_PROVIDER_PRESETS,
  buildAiEndpoint,
  createAiProviderConfig,
  validateAiProviderConfig,
  type AiProviderConfig
} from '../../src/shared/aiProviderConfig'

describe('AI provider configuration', () => {
  it('provides practical presets for hosted and local providers', () => {
    expect(AI_PROVIDER_PRESETS.map((preset) => preset.id)).toEqual([
      'openai',
      'anthropic',
      'deepseek',
      'opencode-go',
      'openrouter',
      'ollama',
      'lm-studio',
      'custom-openai',
      'custom-anthropic'
    ])
    expect(createAiProviderConfig('ollama')).toMatchObject({
      authMode: 'none',
      protocol: 'openai-chat',
      baseUrl: 'http://127.0.0.1:11434/v1'
    })
  })

  it('normalizes protocol endpoints without duplicating paths', () => {
    expect(buildAiEndpoint('https://api.example.test/v1', 'openai-chat')).toBe('https://api.example.test/v1/chat/completions')
    expect(buildAiEndpoint('https://api.example.test/v1/chat/completions', 'openai-chat')).toBe('https://api.example.test/v1/chat/completions')
    expect(buildAiEndpoint('https://api.example.test/v1', 'anthropic-messages')).toBe('https://api.example.test/v1/messages')
    expect(buildAiEndpoint('https://api.example.test/v1/responses', 'openai-responses')).toBe('https://api.example.test/v1/responses')
  })

  it('allows local no-auth endpoints and rejects unsafe remote HTTP endpoints', () => {
    const local = createAiProviderConfig('ollama')
    expect(validateAiProviderConfig(local, null)).toBeNull()

    const remote: AiProviderConfig = { ...local, baseUrl: 'http://api.example.test/v1' }
    expect(validateAiProviderConfig(remote, null)).toContain('HTTPS')
  })

  it('requires credentials only for authenticated configurations', () => {
    const config = { ...createAiProviderConfig('custom-openai'), baseUrl: 'https://api.example.test/v1', model: 'test-model' }
    expect(validateAiProviderConfig(config, null)).toContain('API key')
    expect(validateAiProviderConfig(config, 'secret')).toBeNull()
  })
})
