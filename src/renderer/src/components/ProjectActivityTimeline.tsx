import { Archive, FileText, GitCommitHorizontal, ListChecks, NotebookPen } from 'lucide-react'
import type { AsyncStatus, ProjectActivityItem } from '../lib/workspaceTypes'
import { useI18n } from '../stores/languageStore'
import { InteractiveMarkdown } from './InteractiveMarkdown'

interface ProjectActivityTimelineProps {
  items: ProjectActivityItem[]
  status: AsyncStatus
  onRetry: () => void
  onTaskClick?: (publicId: string) => void
}

function formatActivityTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function statusLabel(status: string, t: ReturnType<typeof useI18n>['t']): string {
  if (status === 'todo') return t('kanban.todo')
  if (status === 'in_progress') return t('kanban.inProgress')
  if (status === 'done') return t('kanban.done')
  return status
}

export function ProjectActivityTimeline({ items, status, onRetry, onTaskClick }: ProjectActivityTimelineProps): JSX.Element {
  const { t } = useI18n()

  return <section className="project-activity" aria-label={t('workspace.projectActivity')}>
    <div className="project-activity-header">
      <div><p className="workspace-kicker">{t('workspace.projectTimeline')}</p><h4>{t('workspace.projectActivity')}</h4></div>
      {status === 'success' && <span className="project-activity-count">{items.length}</span>}
    </div>
    {status === 'running' && <p className="project-activity-state">{t('workspace.projectActivityLoading')}</p>}
    {status === 'error' && <div className="project-activity-state"><p>{t('workspace.projectActivityFailed')}</p><button type="button" onClick={onRetry}>{t('common.retry')}</button></div>}
    {status === 'success' && items.length === 0 && <p className="project-activity-state">{t('workspace.projectActivityEmpty')}</p>}
    {status === 'success' && items.length > 0 && <ol className="project-activity-list">
      {items.map((item) => <li className={`project-activity-item project-activity-${item.type}`} key={`${item.type}-${item.public_id}`}>
        <span className="project-activity-icon" aria-hidden="true">
          {item.type === 'task' ? <ListChecks /> : item.type === 'work_log' ? <NotebookPen /> : item.type === 'inbox' ? <Archive /> : item.type === 'git_commit' ? <GitCommitHorizontal /> : <FileText />}
        </span>
        <div className="project-activity-body">
          <div className="project-activity-meta"><span>{item.type === 'task' ? t('workspace.sourceTask') : item.type === 'work_log' ? t('workspace.sourceLog') : item.type === 'inbox' ? t('workspace.sourceInbox') : item.type === 'git_commit' ? t('workspace.sourceCommit') : t('workspace.sourceReport')}</span><time dateTime={item.occurred_at}>{formatActivityTime(item.occurred_at)}</time></div>
          {item.type === 'work_log' ? <div className="project-activity-markdown log-content-markdown"><InteractiveMarkdown content={item.content || item.title} /></div> : <>
            {item.type === 'task' && onTaskClick ? <button type="button" className="project-activity-task-link" onClick={() => onTaskClick(item.public_id)}>{item.title}</button> : <h5>{item.title}</h5>}
            {item.content && item.content !== item.title && <p className="project-activity-content">{item.content}</p>}
          </>}
          <div className="project-activity-details">
            {item.status && <span>{t('workspace.activityStatus')}: {statusLabel(item.status, t)}</span>}
            {item.category && <span>{item.category}</span>}
            {item.repository_name && <span>{item.repository_name}</span>}
            {item.author_name && <span>{t('workspace.activityAuthor')}: {item.author_name}</span>}
            {item.commit_hash && <span>{t('workspace.activityHash')}: {item.commit_hash.slice(0, 8)}</span>}
            {item.branch && <span>{item.branch}</span>}
            {item.type === 'git_commit' && <span>{t('workspace.activityChanges', { files: item.files_changed ?? 0, additions: item.additions ?? 0, deletions: item.deletions ?? 0 })}</span>}
            {item.due_date && <span>{t('kanban.dueDate')}: {item.due_date}</span>}
          </div>
        </div>
      </li>)}
    </ol>}
  </section>
}
