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
  parseTagNames
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
    expect(() => parseTagNames('技术/前端')).toThrow('INVALID_ARGUMENT')
    expect(() => parseTagNames([{}])).toThrow('INVALID_ARGUMENT')
    expect(() => parseTagNames(Array.from({ length: 51 }, () => 'tag'))).toThrow('INVALID_ARGUMENT')
    expect(() => parseTagNames(['x'.repeat(201)])).toThrow('INVALID_ARGUMENT')
    expect(() => parseSearchQueryInput({ tag_names: null })).toThrow('INVALID_ARGUMENT')
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
})
