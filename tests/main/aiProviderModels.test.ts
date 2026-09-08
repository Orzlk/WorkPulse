import { describe, expect, it } from 'vitest'

import { buildAiModelsEndpoint } from '../../src/shared/aiProviderConfig'
import { listAiModels } from '../../src/main/reports/aiProvider'

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response
}

describe('AI provider model discovery', () => {
  it('normalizes a compatible base URL to the models endpoint', () => {
    expect(buildAiModelsEndpoint('https://provider.test/v1')).toBe('https://provider.test/v1/models')
    expect(buildAiModelsEndpoint('https://provider.test/v1/models')).toBe('https://provider.test/v1/models')
    expect(buildAiModelsEndpoint('https://provider.test/v1/chat/completions')).toBe('https://provider.test/v1/models')
  })

  it('fetches and deduplicates model IDs with the configured authentication', async () => {
    let requestedUrl = ''
    let requestedMethod = ''
    let headers: Headers | undefined
    const result = await listAiModels({
      provider: 'custom-openai',
      apiKey: 'test-key',
      baseUrl: 'https://provider.test/v1',
      model: 'manual-model'
    }, {
      fetchImpl: async (url, init) => {
        requestedUrl = String(url)
        requestedMethod = init?.method ?? ''
        headers = new Headers(init?.headers)
        return response({ data: [{ id: 'gpt-a' }, { id: 'gpt-a' }, { id: 'gpt-b' }] })
      }
    })

    expect(result).toMatchObject({ ok: true, models: ['gpt-a', 'gpt-b'] })
    expect(requestedUrl).toBe('https://provider.test/v1/models')
    expect(requestedMethod).toBe('GET')
    expect(headers?.get('authorization')).toBe('Bearer test-key')
  })

  it('supports local providers without an API key and model name responses', async () => {
    const result = await listAiModels({
      provider: 'ollama',
      apiKey: null,
      baseUrl: 'http://127.0.0.1:11434/v1'
    }, {
      fetchImpl: async () => response({ models: [{ name: 'llama3.2' }, { name: 'qwen3:8b' }] })
    })

    expect(result).toMatchObject({ ok: true, models: ['llama3.2', 'qwen3:8b'] })
  })

  it('keeps provider errors bounded and redacts secrets', async () => {
    const result = await listAiModels({
      provider: 'custom-openai',
      apiKey: 'secret-key',
      baseUrl: 'https://provider.test/v1',
      customHeaders: { 'X-Workspace-Token': 'header-secret' }
    }, {
      fetchImpl: async () => response({ error: 'secret-key header-secret' }, 401)
    })

    expect(result.ok).toBe(false)
    expect(result.error).not.toContain('secret-key')
    expect(result.error).not.toContain('header-secret')
    expect(result.error?.length).toBeLessThanOrEqual(500)
  })
})
