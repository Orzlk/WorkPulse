export type AiProviderName =
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'opencode-go'
  | 'openrouter'
  | 'ollama'
  | 'lm-studio'
  | 'custom-openai'
  | 'custom-anthropic'

export type AiProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages'
export type AiAuthMode = 'bearer' | 'x-api-key' | 'none'

export interface AiProviderPreset {
  id: AiProviderName
  protocol: AiProtocol
  authMode: AiAuthMode
  baseUrl: string
  model: string
}

export interface AiProviderConfig {
  presetId: AiProviderName
  displayName: string
  protocol: AiProtocol
  authMode: AiAuthMode
  baseUrl: string
  model: string
  customHeaders: Record<string, string>
}

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  { id: 'openai', protocol: 'openai-chat', authMode: 'bearer', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'anthropic', protocol: 'anthropic-messages', authMode: 'x-api-key', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-20250514' },
  { id: 'deepseek', protocol: 'openai-chat', authMode: 'bearer', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { id: 'opencode-go', protocol: 'openai-chat', authMode: 'bearer', baseUrl: 'https://opencode.ai/zen/go/v1', model: 'glm-5.3-flash' },
  { id: 'openrouter', protocol: 'openai-chat', authMode: 'bearer', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { id: 'ollama', protocol: 'openai-chat', authMode: 'none', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.2' },
  { id: 'lm-studio', protocol: 'openai-chat', authMode: 'none', baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-model' },
  { id: 'custom-openai', protocol: 'openai-chat', authMode: 'bearer', baseUrl: '', model: '' },
  { id: 'custom-anthropic', protocol: 'anthropic-messages', authMode: 'x-api-key', baseUrl: '', model: '' }
]

export function getAiProviderPreset(id: string | undefined): AiProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === id)
}

export function createAiProviderConfig(id: string): AiProviderConfig {
  const preset = getAiProviderPreset(id) ?? AI_PROVIDER_PRESETS[0]
  return {
    presetId: preset.id,
    displayName: preset.id,
    protocol: preset.protocol,
    authMode: preset.authMode,
    baseUrl: preset.baseUrl,
    model: preset.model,
    customHeaders: {}
  }
}

export function configRequiresApiKey(config: Pick<AiProviderConfig, 'authMode'>): boolean {
  return config.authMode !== 'none'
}

export function buildAiEndpoint(baseUrl: string, protocol: AiProtocol): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) return ''

  if (protocol === 'anthropic-messages') {
    if (base.endsWith('/messages')) return base
    return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`
  }

  const path = protocol === 'openai-responses' ? '/responses' : '/chat/completions'
  return base.endsWith(path) ? base : `${base}${path}`
}

export function buildAiModelsEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) return ''
  if (base.endsWith('/models')) return base
  return `${base.replace(/\/(?:chat\/completions|responses)$/, '')}/models`
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

export function validateAiProviderConfig(config: AiProviderConfig, apiKey?: string | null): string | null {
  if (!config.baseUrl.trim()) return 'Base URL is required'
  if (config.baseUrl.length > 2048) return 'Base URL is too long'
  if (!config.model.trim()) return 'Model name is required'
  if (config.model.length > 200) return 'Model name is too long'

  let url: URL
  try {
    url = new URL(config.baseUrl)
  } catch {
    return 'Base URL is invalid'
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) {
    return 'Remote endpoints must use HTTPS'
  }
  if (configRequiresApiKey(config) && !apiKey?.trim()) return 'API key is required'
  const headerNames = Object.keys(config.customHeaders)
  if (headerNames.length > 20) return 'Too many custom headers'
  for (const name of headerNames) {
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || name.length > 100) return 'Custom header name is invalid'
    if (/^(authorization|x-api-key|content-type|x-opencode-session|user-agent)$/i.test(name)) return 'Custom header is reserved'
    if (typeof config.customHeaders[name] !== 'string' || config.customHeaders[name].length > 2000) return 'Custom header value is invalid'
  }
  return null
}
