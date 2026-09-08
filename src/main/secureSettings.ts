import { safeStorage } from 'electron'
import { deleteSetting, getSetting, setSetting } from './db'

const API_KEY_KEY = 'api_key'
const API_KEY_ENCRYPTED_KEY = 'api_key_encrypted'
const AI_HEADERS_KEY = 'ai_custom_headers'
const AI_HEADERS_ENCRYPTED_KEY = 'ai_custom_headers_encrypted'

export function getStoredApiKey(): string | null {
  const encrypted = getSetting(API_KEY_ENCRYPTED_KEY)
  if (encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      const decrypted = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
      deleteSetting(API_KEY_KEY)
      return decrypted
    } catch {
      // Fall through to the legacy plaintext value if decryption fails.
    }
  }

  const plain = getSetting(API_KEY_KEY)
  if (plain && safeStorage.isEncryptionAvailable()) {
    try {
      setSetting(API_KEY_ENCRYPTED_KEY, safeStorage.encryptString(plain).toString('base64'))
      deleteSetting(API_KEY_KEY)
    } catch {
      // Keep using the legacy value if migration fails.
    }
  }

  return plain
}

export function setStoredApiKey(value: string): void {
  if (safeStorage.isEncryptionAvailable()) {
    setSetting(API_KEY_ENCRYPTED_KEY, safeStorage.encryptString(value).toString('base64'))
    deleteSetting(API_KEY_KEY)
    return
  }

  setSetting(API_KEY_KEY, value)
}

export function deleteStoredApiKey(): void {
  deleteSetting(API_KEY_KEY)
  deleteSetting(API_KEY_ENCRYPTED_KEY)
}

function parseHeaders(value: string | null): Record<string, string> {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, headerValue]) => typeof headerValue === 'string'))
  } catch {
    return {}
  }
}

export function getStoredAiCustomHeaders(): Record<string, string> {
  const encrypted = getSetting(AI_HEADERS_ENCRYPTED_KEY)
  if (encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return parseHeaders(safeStorage.decryptString(Buffer.from(encrypted, 'base64')))
    } catch {
      // Fall through to the legacy plaintext value if decryption fails.
    }
  }
  return parseHeaders(getSetting(AI_HEADERS_KEY))
}

export function setStoredAiCustomHeaders(value: Record<string, string>): void {
  const serialized = JSON.stringify(value)
  if (safeStorage.isEncryptionAvailable()) {
    setSetting(AI_HEADERS_ENCRYPTED_KEY, safeStorage.encryptString(serialized).toString('base64'))
    deleteSetting(AI_HEADERS_KEY)
    return
  }
  setSetting(AI_HEADERS_KEY, serialized)
}

export function deleteStoredAiCustomHeaders(): void {
  deleteSetting(AI_HEADERS_KEY)
  deleteSetting(AI_HEADERS_ENCRYPTED_KEY)
}
