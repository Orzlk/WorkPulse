import { describe, expect, it } from 'vitest'
import { extractProjectMentionNames, findUnresolvedProjectMentionNames, resolveOrCreateProjectReference } from '../../src/renderer/src/lib/projectMentions'

describe('project mention auto creation', () => {
  it('extracts unique project names from @ references', () => {
    expect(extractProjectMentionNames('@客户端 @客户端 继续验证 @设备，完成')).toEqual(['客户端', '设备'])
  })

  it('keeps existing references and returns only new project names', () => {
    const projects = [{ public_id: 'project-1', name: '客户端' }]
    expect(findUnresolvedProjectMentionNames('@客户端 @新项目', projects)).toEqual(['新项目'])
  })

  it('creates and returns the project id for a new @ reference', async () => {
    const created = await resolveOrCreateProjectReference('@新项目', [], async (input) => ({ public_id: 'project-2', name: input.name }))
    expect(created).toBe('project-2')
  })
})
