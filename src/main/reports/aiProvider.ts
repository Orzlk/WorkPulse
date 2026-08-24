export const AI_PROVIDER_RESPONSE_ERROR = 'AI provider response is invalid'

export type AiProviderName = 'openai' | 'anthropic' | 'deepseek'

export interface AiConnectionTestInput {
  provider: AiProviderName
  apiKey: string
  baseUrl: string
  model: string
}

export interface AiConnectionTestResult {
  ok: boolean
  provider: AiProviderName
  model: string
  latency_ms: number
  error?: string
}

export interface AiConnectionTestDependencies {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ProviderRequest {
  apiKey: string
  baseUrl: string
  model: string
  messages: ProviderMessage[]
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

interface ProviderResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
}

function responseError(): Error {
  return new Error(AI_PROVIDER_RESPONSE_ERROR)
}

async function readResponse(response: ProviderResponse): Promise<unknown> {
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`AI provider request failed: ${response.status} - ${error}`)
  }
  try {
    return await response.json()
  } catch {
    throw responseError()
  }
}

function requireContent(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw responseError()
  return value
}

function chatContent(data: unknown): string {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { choices?: unknown }).choices)) {
    throw responseError()
  }
  const first = (data as { choices: unknown[] }).choices[0]
  if (!first || typeof first !== 'object') throw responseError()
  const message = (first as { message?: unknown }).message
  if (!message || typeof message !== 'object') throw responseError()
  return requireContent((message as { content?: unknown }).content)
}

function anthropicContent(data: unknown): string {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { content?: unknown }).content)) {
    throw responseError()
  }
  const first = (data as { content: unknown[] }).content[0]
  if (!first || typeof first !== 'object') throw responseError()
  return requireContent((first as { text?: unknown }).text)
}

async function request(
  input: ProviderRequest,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  parse: (data: unknown) => string
): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch
  const response = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: input.signal
  }) as unknown as ProviderResponse
  return parse(await readResponse(response))
}

export function callOpenAI(input: ProviderRequest): Promise<string> {
  const url = input.baseUrl
    ? `${input.baseUrl.replace(/\/+$/, '')}/chat/completions`
    : 'https://api.openai.com/v1/chat/completions'
  return request(input, url, {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${input.apiKey}`
  }, {
    model: input.model || 'gpt-4o-mini',
    messages: input.messages,
    temperature: 0.7,
    max_tokens: 2000
  }, chatContent)
}

export function callAnthropic(input: ProviderRequest): Promise<string> {
  const systemMsg = input.messages.find((message) => message.role === 'system')
  const userMsg = input.messages.find((message) => message.role === 'user')
  const url = input.baseUrl
    ? `${input.baseUrl.replace(/\/+$/, '')}/v1/messages`
    : 'https://api.anthropic.com/v1/messages'
  return request(input, url, {
    'Content-Type': 'application/json',
    'x-api-key': input.apiKey,
    'anthropic-version': '2023-06-01'
  }, {
    model: input.model || 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: systemMsg?.content || '',
    messages: [{ role: 'user', content: userMsg?.content || '' }]
  }, anthropicContent)
}

export function callDeepSeek(input: ProviderRequest): Promise<string> {
  const url = input.baseUrl
    ? `${input.baseUrl.replace(/\/+$/, '')}/chat/completions`
    : 'https://api.deepseek.com/chat/completions'
  return request(input, url, {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${input.apiKey}`
  }, {
    model: input.model || 'deepseek-chat',
    messages: input.messages,
    temperature: 0.7,
    max_tokens: 2000
  }, chatContent)
}

function defaultModel(provider: AiProviderName): string {
  if (provider === 'anthropic') return 'claude-sonnet-4-20250514'
  if (provider === 'deepseek') return 'deepseek-chat'
  return 'gpt-4o-mini'
}

function sanitizeError(error: unknown, apiKey: string): string {
  const raw = error instanceof Error ? error.message : 'AI provider request failed'
  const withoutKey = apiKey ? raw.split(apiKey).join('[REDACTED]') : raw
  return withoutKey.slice(0, 500) || 'AI provider request failed'
}

export async function testAiConnection(
  input: AiConnectionTestInput,
  dependencies: AiConnectionTestDependencies = {}
): Promise<AiConnectionTestResult> {
  const model = input.model || defaultModel(input.provider)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 10_000)
  const startedAt = Date.now()
  const request: ProviderRequest = {
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    model,
    messages: [{ role: 'user', content: 'Reply with OK only.' }],
    signal: controller.signal,
    fetchImpl: dependencies.fetchImpl
  }

  try {
    if (input.provider === 'anthropic') await callAnthropic(request)
    else if (input.provider === 'deepseek') await callDeepSeek(request)
    else await callOpenAI(request)
    return {
      ok: true,
      provider: input.provider,
      model,
      latency_ms: Math.max(0, Date.now() - startedAt)
    }
  } catch (error) {
    return {
      ok: false,
      provider: input.provider,
      model,
      latency_ms: Math.max(0, Date.now() - startedAt),
      error: controller.signal.aborted ? 'AI provider request timed out' : sanitizeError(error, input.apiKey)
    }
  } finally {
    clearTimeout(timeout)
  }
}
