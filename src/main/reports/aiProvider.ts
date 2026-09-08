import { randomUUID } from 'node:crypto'
import {
  buildAiEndpoint,
  buildAiModelsEndpoint,
  createAiProviderConfig,
  getAiProviderPreset,
  validateAiProviderConfig,
  type AiAuthMode,
  type AiProtocol,
  type AiProviderConfig,
  type AiProviderName
} from '../../shared/aiProviderConfig'

export type { AiAuthMode, AiProtocol, AiProviderConfig, AiProviderName } from '../../shared/aiProviderConfig'

export const AI_PROVIDER_RESPONSE_ERROR = 'AI provider response is invalid'
const WORKPULSE_USER_AGENT = 'WorkPulse/0.0.1'

export interface AiConnectionTestInput {
  provider: AiProviderName
  apiKey: string | null
  baseUrl?: string
  model?: string
  protocol?: AiProtocol
  authMode?: AiAuthMode
  customHeaders?: Record<string, string>
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

export interface AiModelListInput {
  provider: AiProviderName
  apiKey: string | null
  baseUrl?: string
  model?: string
  protocol?: AiProtocol
  authMode?: AiAuthMode
  customHeaders?: Record<string, string>
}

export interface AiModelListResult {
  ok: boolean
  provider: AiProviderName
  models: string[]
  latency_ms: number
  error?: string
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ProviderRequest {
  apiKey?: string | null
  baseUrl: string
  model: string
  messages: ProviderMessage[]
  protocol?: AiProtocol
  authMode?: AiAuthMode
  customHeaders?: Record<string, string>
  config?: AiProviderConfig
  sessionId?: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  onChunk?: (chunk: string) => void
}

interface ProviderResponse {
  ok: boolean
  status: number
  body?: ReadableStream<Uint8Array> | null
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

function responsesContent(data: unknown): string {
  if (!data || typeof data !== 'object') throw responseError()
  const response = data as { output_text?: unknown; output?: unknown }
  if (typeof response.output_text === 'string' && response.output_text.trim()) return response.output_text
  if (!Array.isArray(response.output)) throw responseError()
  const content = response.output
    .filter((item): item is { type?: unknown; content?: unknown } => Boolean(item) && typeof item === 'object')
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter((item): item is { type?: unknown; text?: unknown } => Boolean(item) && typeof item === 'object')
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('')
  return requireContent(content)
}

export function extractAiStreamText(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const value = data as { choices?: unknown; type?: unknown; delta?: unknown }
  if (Array.isArray(value.choices)) {
    const choice = value.choices[0]
    if (!choice || typeof choice !== 'object') return ''
    const delta = (choice as { delta?: unknown }).delta
    if (delta && typeof delta === 'object' && typeof (delta as { content?: unknown }).content === 'string') {
      return (delta as { content: string }).content
    }
    const message = (choice as { message?: unknown }).message
    if (message && typeof message === 'object' && typeof (message as { content?: unknown }).content === 'string') {
      return (message as { content: string }).content
    }
  }
  if (value.type === 'content_block_delta' && value.delta && typeof value.delta === 'object' && typeof (value.delta as { text?: unknown }).text === 'string') {
    return (value.delta as { text: string }).text
  }
  if (value.type === 'response.output_text.delta' && typeof (value as { delta?: unknown }).delta === 'string') {
    return (value as { delta: string }).delta
  }
  return ''
}

async function readStreamingResponse(response: ProviderResponse, onChunk: (chunk: string) => void, parseFallback: (data: unknown) => string): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let raw = ''
  let content = ''
  const consumeLine = (line: string): void => {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    try {
      const chunk = extractAiStreamText(JSON.parse(payload))
      if (chunk) {
        content += chunk
        onChunk(chunk)
      }
    } catch {
      // Ignore incomplete or provider-specific SSE metadata lines.
    }
  }

  while (true) {
    const result = await reader.read()
    const decoded = decoder.decode(result.value, { stream: !result.done })
    raw += decoded
    buffer += decoded
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    lines.forEach(consumeLine)
    if (result.done) break
  }
  consumeLine(buffer)
  if (!content.trim() && raw.trim()) {
    try {
      content = parseFallback(JSON.parse(raw.trim()))
    } catch {
      // Keep the common invalid-response error below.
    }
  }
  if (!content.trim()) throw responseError()
  return content
}

async function request(
  input: ProviderRequest,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  parse: (data: unknown) => string
): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch
  const requestBody = input.onChunk && body && typeof body === 'object'
    ? { ...(body as Record<string, unknown>), stream: true }
    : body
  const response = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    signal: input.signal
  }) as unknown as ProviderResponse
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`AI provider request failed: ${response.status} - ${error}`)
  }
  if (input.onChunk && response.body) return readStreamingResponse(response, input.onChunk, parse)
  return parse(await readResponse(response))
}

function isOpenCodeEndpoint(url: string): boolean {
  try {
    const hostname = new URL(url).hostname
    return hostname === 'opencode.ai' || hostname.endsWith('.opencode.ai')
  } catch {
    return false
  }
}

function resolveConfig(input: ProviderRequest, presetId: AiProviderName): AiProviderConfig {
  if (input.config) return input.config
  const preset = getAiProviderPreset(presetId)
  if (!preset) {
    const custom = createAiProviderConfig('custom-openai')
    return {
      ...custom,
      protocol: input.protocol ?? custom.protocol,
      authMode: input.authMode ?? custom.authMode,
      baseUrl: input.baseUrl || custom.baseUrl,
      model: input.model || custom.model,
      customHeaders: input.customHeaders ?? {}
    }
  }
  return {
    ...preset,
    presetId: preset.id,
    displayName: preset.id,
    protocol: input.protocol ?? preset.protocol,
    authMode: input.authMode ?? preset.authMode,
    baseUrl: input.baseUrl || preset.baseUrl,
    model: input.model || preset.model,
    customHeaders: input.customHeaders ?? {}
  }
}

function providerHeaders(input: ProviderRequest, config: AiProviderConfig, url: string): Record<string, string> {
  const headers: Record<string, string> = {
    ...config.customHeaders,
    'Content-Type': 'application/json'
  }
  if (config.authMode === 'bearer' && input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`
  if (config.authMode === 'x-api-key' && input.apiKey) headers['x-api-key'] = input.apiKey
  if (config.protocol === 'anthropic-messages') headers['anthropic-version'] = '2023-06-01'
  if (isOpenCodeEndpoint(url)) {
    headers['User-Agent'] = WORKPULSE_USER_AGENT
    headers['x-opencode-session'] = input.sessionId ?? randomUUID()
  }
  return headers
}

function parseModelIds(data: unknown): string[] {
  if (!data || typeof data !== 'object') throw responseError()
  const payload = data as { data?: unknown; models?: unknown }
  const items = Array.isArray(payload.data) ? payload.data : payload.models
  if (!Array.isArray(items)) throw responseError()

  const ids = items.map((item) => {
    if (typeof item === 'string') return item
    if (!item || typeof item !== 'object') return null
    const value = item as { id?: unknown; name?: unknown; model?: unknown; key?: unknown }
    const candidate = value.id ?? value.name ?? value.model ?? value.key
    return typeof candidate === 'string' ? candidate : null
  }).filter((id): id is string => Boolean(id?.trim())).map((id) => id.trim())
  return Array.from(new Set(ids)).slice(0, 500)
}

function buildOllamaTagsEndpoint(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    url.pathname = '/api/tags'
    url.search = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

async function requestModelList(input: ProviderRequest, url: string, headers: Record<string, string>): Promise<string[]> {
  const fetchImpl = input.fetchImpl ?? fetch
  const response = await fetchImpl(url, {
    method: 'GET',
    headers,
    signal: input.signal
  }) as unknown as ProviderResponse
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`AI model list request failed: ${response.status} - ${error}`)
  }
  try {
    return parseModelIds(await response.json())
  } catch {
    throw responseError()
  }
}

export async function listAiModels(
  input: AiModelListInput,
  dependencies: AiConnectionTestDependencies = {}
): Promise<AiModelListResult> {
  const preset = getAiProviderPreset(input.provider)
  const presetConfig = createAiProviderConfig(preset?.id ?? 'custom-openai')
  const config: AiProviderConfig = {
    ...presetConfig,
    protocol: input.protocol ?? preset?.protocol ?? 'openai-chat',
    authMode: input.authMode ?? preset?.authMode ?? 'bearer',
    baseUrl: input.baseUrl?.trim() || preset?.baseUrl || '',
    model: input.model?.trim() || preset?.model || '',
    customHeaders: input.customHeaders ?? {}
  }
  const validationError = validateAiProviderConfig({ ...config, model: config.model || 'model-list' }, input.apiKey)
  const startedAt = Date.now()
  if (validationError) {
    return { ok: false, provider: input.provider, models: [], latency_ms: 0, error: validationError }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 10_000)
  const request: ProviderRequest = {
    apiKey: input.apiKey,
    baseUrl: config.baseUrl,
    model: config.model || 'model-list',
    messages: [],
    config,
    signal: controller.signal,
    fetchImpl: dependencies.fetchImpl
  }
  const url = buildAiModelsEndpoint(config.baseUrl)

  try {
    if (!url) throw new Error('Base URL is required')
    const headers = providerHeaders(request, config, url)
    let models: string[]
    try {
      models = await requestModelList(request, url, headers)
    } catch (error) {
      if (input.provider !== 'ollama') throw error
      const fallbackUrl = buildOllamaTagsEndpoint(config.baseUrl)
      if (!fallbackUrl || fallbackUrl === url) throw error
      models = await requestModelList(request, fallbackUrl, headers)
    }
    return {
      ok: true,
      provider: input.provider,
      models,
      latency_ms: Math.max(0, Date.now() - startedAt)
    }
  } catch (error) {
    return {
      ok: false,
      provider: input.provider,
      models: [],
      latency_ms: Math.max(0, Date.now() - startedAt),
      error: controller.signal.aborted
        ? 'AI provider request timed out'
        : sanitizeError(error, [input.apiKey, ...Object.values(config.customHeaders)])
    }
  } finally {
    clearTimeout(timeout)
  }
}

export function callAiProvider(input: ProviderRequest): Promise<string> {
  const config = input.config ?? resolveConfig(input, 'custom-openai')
  const validationError = validateAiProviderConfig(config, input.apiKey)
  if (validationError) return Promise.reject(new Error(validationError))
  const url = buildAiEndpoint(config.baseUrl, config.protocol)
  if (!url) return Promise.reject(new Error('Base URL is required'))

  if (config.protocol === 'anthropic-messages') {
    const system = input.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n')
    const messages = input.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content }))
    return request(input, url, providerHeaders(input, config, url), {
      model: config.model,
      max_tokens: 2000,
      system,
      messages
    }, anthropicContent)
  }

  if (config.protocol === 'openai-responses') {
    return request(input, url, providerHeaders(input, config, url), {
      model: config.model,
      input: input.messages,
      temperature: 0.7,
      max_output_tokens: 2000
    }, responsesContent)
  }

  return request(input, url, providerHeaders(input, config, url), {
    model: config.model,
    messages: input.messages,
    temperature: 0.7,
    max_tokens: 2000
  }, chatContent)
}

export function callOpenAI(input: ProviderRequest): Promise<string> {
  return callAiProvider({ ...input, config: input.config ?? resolveConfig(input, 'openai') })
}

export function callAnthropic(input: ProviderRequest): Promise<string> {
  return callAiProvider({ ...input, config: input.config ?? resolveConfig(input, 'anthropic') })
}

export function callDeepSeek(input: ProviderRequest): Promise<string> {
  return callAiProvider({ ...input, config: input.config ?? resolveConfig(input, 'deepseek') })
}

function sanitizeError(error: unknown, secrets: Array<string | null | undefined> = []): string {
  const raw = error instanceof Error ? error.message : 'AI provider request failed'
  const withoutSecrets = secrets
    .filter((secret): secret is string => Boolean(secret))
    .reduce((message, secret) => message.split(secret).join('[REDACTED]'), raw)
  return withoutSecrets.slice(0, 500) || 'AI provider request failed'
}

export async function testAiConnection(
  input: AiConnectionTestInput,
  dependencies: AiConnectionTestDependencies = {}
): Promise<AiConnectionTestResult> {
  const preset = getAiProviderPreset(input.provider)
  const presetConfig = createAiProviderConfig(preset?.id ?? 'custom-openai')
  const config: AiProviderConfig = {
    ...presetConfig,
    protocol: input.protocol ?? preset?.protocol ?? 'openai-chat',
    authMode: input.authMode ?? preset?.authMode ?? 'bearer',
    baseUrl: input.baseUrl?.trim() || preset?.baseUrl || '',
    model: input.model?.trim() || preset?.model || '',
    customHeaders: input.customHeaders ?? {}
  }
  const model = config.model
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 10_000)
  const startedAt = Date.now()
  const request: ProviderRequest = {
    apiKey: input.apiKey,
    baseUrl: config.baseUrl,
    model,
    messages: [{ role: 'user', content: 'Reply with OK only.' }],
    config,
    signal: controller.signal,
    fetchImpl: dependencies.fetchImpl
  }

  try {
    const validationError = validateAiProviderConfig(config, input.apiKey)
    if (validationError) throw new Error(validationError)
    await callAiProvider(request)
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
      error: controller.signal.aborted
        ? 'AI provider request timed out'
        : sanitizeError(error, [input.apiKey, ...Object.values(config.customHeaders)])
    }
  } finally {
    clearTimeout(timeout)
  }
}
