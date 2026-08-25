import { describe, expect, it } from 'vitest'

import { parseInboxSuggestion } from '../../src/main/inbox/inboxAi'

describe('Inbox AI suggestion parser', () => {
  it('parses fenced JSON and preserves only valid project and repository references', () => {
    expect(parseInboxSuggestion('```json\n{"target":"task","title":"整理接口","summary":"需要补充测试","project_id":"project-a","repository_id":"repo-a","tag_names":["#开发","开发"],"include_in_reports":true}\n```', {
      projectIds: ['project-a'], repositoryIds: ['repo-a']
    })).toEqual({
      target: 'task', title: '整理接口', summary: '需要补充测试', project_id: 'project-a', repository_id: 'repo-a', tag_names: ['开发'], include_in_reports: true
    })
  })

  it('drops unknown references instead of creating invalid associations', () => {
    expect(parseInboxSuggestion('{"target":"work_log","project_id":"unknown","repository_id":"unknown","tag_names":[]}', {
      projectIds: [], repositoryIds: []
    })).toMatchObject({ target: 'work_log', project_id: null, repository_id: null })
  })
})
