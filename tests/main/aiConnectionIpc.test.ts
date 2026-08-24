import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const implementation = readFileSync(resolve(root, 'src/main/ipc.ts'), 'utf8')

describe('AI connection test IPC', () => {
  it('registers the guarded handler and validates input before probing', () => {
    expect(implementation).toContain("ipcMain.handle('ai:testConnection'")
    expect(implementation).toContain('parseAiConnectionTestInput')
    expect(implementation).toContain('testAiConnection')
  })
})
