import { randomUUID } from 'node:crypto'

import { IpcContractError } from '../ipcContracts'

interface ImportToken<T> {
  payload: T
  createdAt: number
  owner: string
}

export class ImportTokenStore<T> {
  private readonly tokens = new Map<string, ImportToken<T>>()

  constructor(private readonly ttlMs: number) {}

  get size(): number {
    return this.tokens.size
  }

  put(payload: T, owner: string, createdAt = Date.now()): string {
    this.cleanup(createdAt)
    const token = randomUUID()
    this.tokens.set(token, { payload, owner, createdAt })
    return token
  }

  take(token: string, owner: string, now = Date.now()): T {
    this.cleanup(now)
    const entry = this.tokens.get(token)
    if (!entry) throw new IpcContractError('IMPORT_NOT_READY', 'Import preview is expired or unavailable')
    if (entry.owner !== owner) throw new IpcContractError('INVALID_ARGUMENT', 'Import owner is invalid')
    this.tokens.delete(token)
    return entry.payload
  }

  cleanup(now = Date.now()): void {
    this.tokens.forEach((entry, token) => {
      if (now - entry.createdAt >= this.ttlMs) this.tokens.delete(token)
    })
  }
}
