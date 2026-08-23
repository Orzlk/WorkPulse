export const AI_PROVIDER_RESPONSE_ERROR = 'AI provider response is invalid'

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
