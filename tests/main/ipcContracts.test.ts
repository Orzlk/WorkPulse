import { describe, expect, it } from 'vitest'

import {
  IpcContractError,
  parsePagination,
  parseReportRequest,
  parseRepositoryCreateInput
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
})
