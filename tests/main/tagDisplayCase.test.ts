import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LocalTagRepository } from '../../src/main/repositories/localTagRepository'
import { addWorkLog, getDatabase, getWorkLogs, initDatabase } from '../../src/main/db'

let userDataPath = ''
vi.mock('electron', () => ({ app: { getPath: () => userDataPath } }))

const directories: string[] = []

afterEach(() => {
  try { getDatabase().close() } catch { /* database was not opened */ }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('tag display case', () => {
  it('keeps one lowercase identity per tag and preserves the first-seen display case', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workpulse-tag-case-'))
    directories.push(directory)
    userDataPath = directory
    await initDatabase()

    addWorkLog('使用大写标签', '', null, undefined, { tagNames: ['#Vue3/组件'] })
    const database = getDatabase()
    const first = database.prepare('SELECT name, path, display_path FROM tags').get() as { name: string; path: string; display_path: string }
    expect(first).toEqual({ name: 'Vue3/组件', path: 'vue3/组件', display_path: 'Vue3/组件' })

    // 相同路径不同大小写仍是同一个标签；首见大小写不随后续输入变化
    addWorkLog('再次使用小写', '', null, undefined, { tagNames: ['#vue3/组件'] })
    addWorkLog('全大写输入', '', null, undefined, { tagNames: ['#VUE3/组件'] })
    const rows = database.prepare('SELECT COUNT(*) AS count FROM tags').get() as { count: number }
    expect(rows.count).toBe(1)
    expect(database.prepare('SELECT name FROM tags').get()).toEqual({ name: 'Vue3/组件' })

    const logs = getWorkLogs()
    expect(logs.map((log) => log.tag_names)).toEqual([
      ['Vue3/组件'],
      ['Vue3/组件'],
      ['Vue3/组件']
    ])
  })

  it('preserves display case for tags created through the tag repository', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workpulse-tag-repo-'))
    directories.push(directory)
    userDataPath = directory
    await initDatabase()
    const database = getDatabase()
    const repository = new LocalTagRepository(database)
    const context = { workspace_id: 1, user_id: 1 } as const

    const created = repository.create(context, '#React/Hooks')
    expect(created.path).toBe('react/hooks')
    expect(created.name).toBe('React/Hooks')

    const merged = repository.create(context, 'react/HOOKS')
    expect(merged.public_id).toBe(created.public_id)
    expect(merged.name).toBe('React/Hooks')

    const listed = repository.list(context).items
    expect(listed).toHaveLength(1)
    expect(listed[0].name).toBe('React/Hooks')
  })
})
