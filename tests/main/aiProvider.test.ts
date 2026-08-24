import { describe, expect, it } from 'vitest'

import {
  AI_PROVIDER_RESPONSE_ERROR,
  callAnthropic,
  callDeepSeek,
  callOpenAI,
  testAiConnection,
  type ProviderRequest
} from '../../src/main/reports/aiProvider'

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response
}

const request: ProviderRequest = {
  apiKey: 'test-key',
  baseUrl: 'https://provider.test',
  model: 'test-model',
  messages: [{ role: 'user', content: '生成报告' }]
}

describe('AI provider response validation', () => {
  it.each([
    ['OpenAI', callOpenAI, { choices: [] }, 'choices 为空'],
    ['OpenAI', callOpenAI, { choices: [{ message: {} }] }, 'content 缺失'],
    ['OpenAI', callOpenAI, { choices: [{ message: { content: 123 } }] }, 'content 非字符串'],
    ['Anthropic', callAnthropic, { content: [] }, 'content 数组为空'],
    ['Anthropic', callAnthropic, { content: [{}] }, 'text 缺失'],
    ['Anthropic', callAnthropic, { content: [{ text: 123 }] }, 'text 非字符串'],
    ['DeepSeek', callDeepSeek, { choices: [] }, 'choices 为空'],
    ['DeepSeek', callDeepSeek, { choices: [{ message: {} }] }, 'content 缺失'],
    ['DeepSeek', callDeepSeek, { choices: [{ message: { content: 123 } }] }, 'content 非字符串']
  ])('%s 对%s抛出稳定响应错误', async (_name, provider, body) => {
    await expect(provider({ ...request, fetchImpl: async () => response(body) }))
      .rejects.toThrow(AI_PROVIDER_RESPONSE_ERROR)
  })

  it.each([
    ['OpenAI', callOpenAI, { choices: [{ message: { content: '   ' } }] }],
    ['Anthropic', callAnthropic, { content: [{ type: 'text', text: '   ' }] }],
    ['DeepSeek', callDeepSeek, { choices: [{ message: { content: '   ' } }] }]
  ])('%s 对空白内容抛出稳定响应错误', async (_name, provider, body) => {
    await expect(provider({ ...request, fetchImpl: async () => response(body) }))
      .rejects.toThrow(AI_PROVIDER_RESPONSE_ERROR)
  })

  it('保留三个 provider 的正常文本响应', async () => {
    const fetchImpl = async () => response({ choices: [{ message: { content: '核心功能已完成' } }] })
    const anthropicFetch = async () => response({ content: [{ type: 'text', text: '核心功能已完成' }] })

    await expect(callOpenAI({ ...request, fetchImpl })).resolves.toBe('核心功能已完成')
    await expect(callAnthropic({ ...request, fetchImpl: anthropicFetch })).resolves.toBe('核心功能已完成')
    await expect(callDeepSeek({ ...request, fetchImpl })).resolves.toBe('核心功能已完成')
  })
})

describe('AI provider connection test', () => {
  it.each([
    ['openai', callOpenAI, { choices: [{ message: { content: 'OK' } }] }],
    ['anthropic', callAnthropic, { content: [{ type: 'text', text: 'OK' }] }],
    ['deepseek', callDeepSeek, { choices: [{ message: { content: 'OK' } }] }]
  ] as const)('returns a successful result for %s', async (provider, _call, body) => {
    const result = await testAiConnection({
      provider,
      apiKey: 'test-key',
      baseUrl: 'https://provider.test',
      model: 'test-model'
    }, { fetchImpl: async () => response(body) })

    expect(result).toMatchObject({ ok: true, provider, model: 'test-model' })
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('returns a bounded error and never exposes the API key', async () => {
    const result = await testAiConnection({
      provider: 'openai',
      apiKey: 'secret-test-key',
      baseUrl: 'https://provider.test',
      model: 'test-model'
    }, {
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({}),
        text: async () => 'invalid secret-test-key'
      } as Response)
    })

    expect(result.ok).toBe(false)
    expect(result.error).not.toContain('secret-test-key')
    expect(result.error?.length).toBeLessThanOrEqual(500)
  })

  it('returns a timeout result when the provider does not respond', async () => {
    const result = await testAiConnection({
      provider: 'openai',
      apiKey: 'test-key',
      baseUrl: 'https://provider.test',
      model: 'test-model'
    }, {
      timeoutMs: 5,
      fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })

    expect(result).toMatchObject({ ok: false, error: 'AI provider request timed out' })
  })
})
