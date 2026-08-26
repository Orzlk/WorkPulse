import { resolveProjectReference } from './workspaceInteractions'

export interface ProjectMentionCandidate {
  public_id: string
  name: string
}

const PROJECT_MENTION_PATTERN = /(^|\s)@([^\s@#，。；、,.!?！？:：;；\]）)]+)/g

export function extractProjectMentionNames(content: string): string[] {
  const names: string[] = []
  let match = PROJECT_MENTION_PATTERN.exec(content)
  while (match) {
    const name = match[2].trim()
    if (name && !names.some((current) => current.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      names.push(name)
    }
    match = PROJECT_MENTION_PATTERN.exec(content)
  }
  return names
}

export function findUnresolvedProjectMentionNames(content: string, projects: ProjectMentionCandidate[]): string[] {
  const knownNames = new Set(projects.map((project) => project.name.trim().toLocaleLowerCase()))
  return extractProjectMentionNames(content).filter((name) => !knownNames.has(name.toLocaleLowerCase()))
}

export async function resolveOrCreateProjectReference(
  content: string,
  projects: ProjectMentionCandidate[],
  createProject: (input: { name: string; description: string; color: string }) => Promise<ProjectMentionCandidate>
): Promise<string | null> {
  const existingProjectId = resolveProjectReference(content, projects)
  if (existingProjectId) return existingProjectId

  const name = findUnresolvedProjectMentionNames(content, projects)[0]
  if (!name) return null
  const project = await createProject({ name, description: '', color: '#4d7de8' })
  return project.public_id
}
