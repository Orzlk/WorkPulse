import type { InboxSuggestion } from '../domain/types'

export interface InboxAiReferences {
  projects: Array<{ public_id: string; name: string }>
  repositories: Array<{ public_id: string; name: string }>
  tags: string[]
}

interface AllowedInboxReferences {
  projectIds: readonly string[]
  repositoryIds: readonly string[]
}

export function buildInboxSuggestionPrompt(content: string, references: InboxAiReferences): string {
  return JSON.stringify({
    content,
    allowed_projects: references.projects,
    allowed_repositories: references.repositories,
    existing_tags: references.tags,
    output: {
      target: 'work_log | task | ignore',
      title: '任务标题，日志或 ignore 可为空',
      summary: '一句话说明判断依据',
      project_id: '只能填写 allowed_projects 中的 public_id，否则为 null',
      repository_id: '只能填写 allowed_repositories 中的 public_id，否则为 null',
      tag_names: ['标签路径，不含 #'],
      include_in_reports: true
    }
  })
}

export function parseInboxSuggestion(value: string, allowed: AllowedInboxReferences): InboxSuggestion {
  const normalized = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = normalized.indexOf('{')
  const end = normalized.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI inbox suggestion is invalid')
  let parsed: unknown
  try {
    parsed = JSON.parse(normalized.slice(start, end + 1))
  } catch {
    throw new Error('AI inbox suggestion is invalid')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('AI inbox suggestion is invalid')
  const input = parsed as Record<string, unknown>
  if (input.target !== 'work_log' && input.target !== 'task' && input.target !== 'ignore') throw new Error('AI inbox target is invalid')
  const projectId = typeof input.project_id === 'string' && allowed.projectIds.includes(input.project_id) ? input.project_id : null
  const repositoryId = typeof input.repository_id === 'string' && allowed.repositoryIds.includes(input.repository_id) ? input.repository_id : null
  const tagNames = Array.isArray(input.tag_names)
    ? input.tag_names.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean).slice(0, 20)
    : []
  return {
    target: input.target,
    title: typeof input.title === 'string' ? input.title.trim().slice(0, 200) : '',
    summary: typeof input.summary === 'string' ? input.summary.trim().slice(0, 1000) : '',
    project_id: projectId,
    repository_id: repositoryId,
    tag_names: Array.from(new Set(tagNames)),
    include_in_reports: input.include_in_reports !== false
  }
}
