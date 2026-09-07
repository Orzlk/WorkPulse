import { describe, expect, it } from 'vitest'
import { findReportByPublicId } from '../../src/renderer/src/lib/reportNavigation'

describe('report deep link', () => {
  it('finds the requested report by public id without changing the history order', () => {
    const reports = [{ public_id: 'r-1' }, { public_id: 'r-2' }]
    expect(findReportByPublicId(reports, 'r-2')).toEqual(reports[1])
    expect(findReportByPublicId(reports, 'missing')).toBeNull()
  })
})
