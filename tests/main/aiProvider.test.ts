import { describe, expect, it } from 'vitest'

import {
  AI_PROVIDER_RESPONSE_ERROR,
  callAnthropic,
  callDeepSeek,
  callOpenAI,
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
