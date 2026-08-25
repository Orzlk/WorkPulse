import { describe, expect, it } from 'vitest'

import { callOpenAI, extractAiStreamText } from '../../src/main/reports/aiProvider'

describe('AI streaming chunks', () => {
  it('extracts OpenAI-compatible delta text', () => {
    expect(extractAiStreamText({ choices: [{ delta: { content: '核心功能' } }] })).toBe('核心功能')
  })

  it('extracts Anthropic content delta text', () => {
    expect(extractAiStreamText({ type: 'content_block_delta', delta: { type: 'text_delta', text: '已完成' } })).toBe('已完成')
  })

  it('reads SSE response chunks and forwards them to the caller', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"核心"}}]}\n\n'))
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"功能"}}]}\n\ndata: [DONE]\n\n'))
        controller.close()
      }
    })
    const chunks: string[] = []
    const result = await callOpenAI({
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      model: 'test-model',
      messages: [{ role: 'user', content: 'test' }],
      onChunk: (chunk) => chunks.push(chunk),
      fetchImpl: async () => ({ ok: true, status: 200, body, json: async () => ({}), text: async () => '' } as Response)
    })
    expect(result).toBe('核心功能')
    expect(chunks).toEqual(['核心', '功能'])
  })

  it('falls back to a normal JSON response when a provider ignores stream mode', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"choices":[{"message":{"content":"普通响应"}}]}'))
        controller.close()
      }
    })
    await expect(callOpenAI({
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      model: 'test-model',
      messages: [{ role: 'user', content: 'test' }],
      onChunk: () => undefined,
      fetchImpl: async () => ({ ok: true, status: 200, body, json: async () => ({}), text: async () => '' } as Response)
    })).resolves.toBe('普通响应')
  })
})
