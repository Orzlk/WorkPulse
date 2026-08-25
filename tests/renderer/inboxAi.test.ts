import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/InboxPage.tsx'), 'utf8')
const store = readFileSync(resolve(root, 'src/renderer/src/stores/inboxStore.ts'), 'utf8')
const preload = readFileSync(resolve(root, 'src/preload/index.ts'), 'utf8')

describe('Inbox AI organization UI', () => {
  it('exposes a batch AI organize action and refreshes suggestions', () => {
    expect(page).toContain('suggestAi')
    expect(page).toContain('workspace.aiSuggestion')
    expect(store).toContain('window.api.inbox.aiOrganize')
  })

  it('declares the AI organize preload method', () => {
    expect(preload).toContain('aiOrganize')
  })
})
