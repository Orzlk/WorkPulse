import { describe, expect, it } from 'vitest'

import {
  IpcContractError,
  parseReportListInput,
  parsePagination,
  parseReportRequest,
  parseAiConnectionTestInput,
  parseRepositoryCreateInput,
  parseRepositoryUpdateInput,
  parseSearchQueryInput,
  parseInboxListInput,
  parseTagNames,
  parseWorkItemAssociations,
  parseWorkLogCreateArgs,
  parseWorkLogUpdateArgs,
  parseTaskCreateArgs,
  parseTaskUpdateArgs,
  parseTaskReorderArgs,
  parseSettingUpdateArgs,
  parseShortcutUpdateArgs,
  parseInboxInput,
  parseInboxOrganizeArgs
} from '../../src/main/ipcContracts'

describe('IPC contract validation', () => {
  it('rejects unknown report fields and invalid period input', () => {
    expect(() => parseReportRequest({
      type: 'weekly',
      anchorDate: '2026-08-23',
      timeZone: 'Asia/Shanghai',
      dateFrom: '2026-08-01'
    })).toThrow(IpcContractError)

    expect(() => parseReportRequest({
      type: 'custom',
      anchorDate: '2026-08-23',
      timeZone: 'Asia/Shanghai'
    })).toThrow('INVALID_ARGUMENT')
  })

  it('accepts only bounded pagination and repository creation fields', () => {
    expect(parsePagination({ limit: 20, offset: 0 })).toEqual({ limit: 20, offset: 0 })
    expect(() => parsePagination({ limit: 201 })).toThrow('INVALID_ARGUMENT')
    expect(() => parseRepositoryCreateInput({ name: 'repo', local_path: 'C:/repo', command: 'reset' }))
      .toThrow('INVALID_ARGUMENT')
  })

  it('accepts an inbox state filter without allowing unknown list fields', () => {
    expect(parseInboxListInput({ limit: 20, offset: 4, state: 'unorganized' })).toEqual({
      limit: 20,
      offset: 4,
      state: 'unorganized'
    })
    expect(parseInboxListInput(undefined)).toEqual({ limit: 50, offset: 0 })
    expect(() => parseInboxListInput({ state: 'unknown' })).toThrow('INVALID_ARGUMENT')
    expect(() => parseInboxListInput({ state: 'unorganized', extra: true })).toThrow('INVALID_ARGUMENT')
  })

  it('accepts editable repository metadata and rejects empty repository names', () => {
    expect(parseRepositoryUpdateInput({
      name: '新名称',
      local_path: 'D:/new-repo',
      remote_url: null,
      project_id: null
    })).toMatchObject({ name: '新名称', local_path: 'D:/new-repo', remote_url: null, project_id: null })
    expect(() => parseRepositoryUpdateInput({ name: '' })).toThrow('INVALID_ARGUMENT')
  })

  it('validates legacy numeric report pagination through the same parser', () => {
    expect(parseReportListInput(20)).toEqual({ limit: 20, offset: 0 })
    expect(() => parseReportListInput(0)).toThrow('INVALID_ARGUMENT')
    expect(() => parseReportListInput(201)).toThrow('INVALID_ARGUMENT')
    expect(() => parseReportListInput({ limit: 20, offset: 4, extra: true })).toThrow('INVALID_ARGUMENT')
  })

  it('normalizes and bounds search tag names before calling the service', () => {
    expect(parseTagNames(['  技术  /  前端 ', '#技术/前端'])).toEqual(['技术/前端'])
    expect(parseTagNames(['#Vue3', 'vue3'])).toEqual(['Vue3', 'vue3'])
    expect(() => parseTagNames('技术/前端')).toThrow('INVALID_ARGUMENT')
    expect(() => parseTagNames([{}])).toThrow('INVALID_ARGUMENT')
    expect(() => parseTagNames(Array.from({ length: 51 }, () => 'tag'))).toThrow('INVALID_ARGUMENT')
    expect(() => parseTagNames(['x'.repeat(201)])).toThrow('INVALID_ARGUMENT')
    expect(() => parseSearchQueryInput({ tag_names: null })).toThrow('INVALID_ARGUMENT')
  })

  it('rejects repository ownership fields for work items', () => {
    expect(parseWorkItemAssociations({ project_id: '11111111-1111-4111-8111-111111111111', tag_names: ['工作'] }))
      .toEqual({ projectId: '11111111-1111-4111-8111-111111111111', tagNames: ['工作'] })
    expect(() => parseWorkItemAssociations({ repository_id: 'repo-a' })).toThrow('INVALID_ARGUMENT')
  })

  it('rejects normalized dates that do not exist in the calendar', () => {
    for (const anchorDate of ['2026-02-30', '2025-02-29', '2026-04-31', '2026-00-10', '2026-13-01']) {
      expect(() => parseReportRequest({ type: 'monthly', anchorDate, timeZone: 'Asia/Shanghai' }))
        .toThrow('INVALID_ARGUMENT')
    }
    expect(parseReportRequest({ type: 'monthly', anchorDate: '2024-02-29', timeZone: 'Asia/Shanghai' }).anchorDate)
      .toBe('2024-02-29')
  })

  it('validates AI connection test input without accepting unknown providers or fields', () => {
    expect(parseAiConnectionTestInput({
      provider: 'openai',
      api_key: 'test-key',
      base_url: 'https://provider.test/v1',
      model: 'test-model'
    })).toEqual({
      provider: 'openai',
      api_key: 'test-key',
      base_url: 'https://provider.test/v1',
      model: 'test-model'
    })
    expect(() => parseAiConnectionTestInput({ provider: 'ollama', api_key: 'test-key' })).toThrow('INVALID_ARGUMENT')
    expect(() => parseAiConnectionTestInput({ provider: 'openai', api_key: '' })).toThrow('INVALID_ARGUMENT')
    expect(() => parseAiConnectionTestInput({ provider: 'openai', api_key: 'test-key', extra: true })).toThrow('INVALID_ARGUMENT')
  })

  it('validates task and work log write payloads at runtime', () => {
    expect(parseWorkLogCreateArgs({ content: '完成契约校验', category: '开发', associations: {} })).toMatchObject({
      content: '完成契约校验',
      category: '开发'
    })
    expect(() => parseWorkLogCreateArgs({ content: 123 })).toThrow('INVALID_ARGUMENT')
    expect(() => parseWorkLogCreateArgs({ content: 'x'.repeat(10001) })).toThrow('INVALID_ARGUMENT')
    expect(() => parseWorkLogUpdateArgs({ id: '1', content: '日志', category: '' })).toThrow('INVALID_ARGUMENT')

    expect(parseTaskCreateArgs({ title: '任务', description: '说明', status: 'todo', checklist: [] })).toMatchObject({
      title: '任务',
      description: '说明',
      status: 'todo'
    })
    expect(() => parseTaskCreateArgs({ title: '' })).toThrow('INVALID_ARGUMENT')
    expect(() => parseTaskCreateArgs({ title: '任务', description: 'x'.repeat(10001) })).toThrow('INVALID_ARGUMENT')
    expect(() => parseTaskUpdateArgs({ id: 1, updates: { position: -1 } })).toThrow('INVALID_ARGUMENT')
    expect(() => parseTaskReorderArgs({ taskIds: ['1'], boardColumn: 'todo' })).toThrow('INVALID_ARGUMENT')
  })

  it('bounds suggestion tags and validates settings and shortcut keys', () => {
    expect(() => parseInboxInput({
      content: '整理',
      ai_suggestion: {
        target: 'task', title: '', summary: '', project_id: null,
        tag_names: Array.from({ length: 51 }, () => 'tag'), include_in_reports: true
      }
    })).toThrow('INVALID_ARGUMENT')
    expect(parseSettingUpdateArgs({ key: 'theme', value: 'dark' })).toEqual({ key: 'theme', value: 'dark' })
    expect(() => parseSettingUpdateArgs({ key: 'unknown_key', value: 'x' })).toThrow('INVALID_ARGUMENT')
    expect(parseShortcutUpdateArgs({ key: 'shortcut_quick_task', value: 'Ctrl+Shift+T' })).toEqual({ key: 'shortcut_quick_task', value: 'Ctrl+Shift+T' })
    expect(() => parseShortcutUpdateArgs({ key: 'shortcut_hijack', value: 'x' })).toThrow('INVALID_ARGUMENT')
    expect(() => parseShortcutUpdateArgs({ key: 'shortcut_quick_task', value: 'x'.repeat(201) })).toThrow('INVALID_ARGUMENT')
    expect(parseInboxOrganizeArgs({ target: 'task', project_id: null, tag_names: ['#人工'] }))
      .toEqual({ target: 'task', project_id: null, tag_names: ['人工'] })
    expect(() => parseInboxOrganizeArgs({ target: 'task', tag_names: Array.from({ length: 51 }, () => 'tag') }))
      .toThrow('INVALID_ARGUMENT')
  })
})
