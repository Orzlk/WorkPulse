import type { ReactNode } from 'react'
import { WorkspaceBreadcrumb, type WorkspaceBreadcrumbItem } from './WorkspaceBreadcrumb'

interface WorkspacePageHeaderProps {
  ariaLabel: string
  items: WorkspaceBreadcrumbItem[]
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  onHome?: () => void
}

export function WorkspacePageHeader({ ariaLabel, items, title, description, actions, onHome }: WorkspacePageHeaderProps): JSX.Element {
  return (
    <header className="workspace-page-heading">
      <WorkspaceBreadcrumb ariaLabel={ariaLabel} items={items} onHome={onHome} />
      <div className="workspace-page-heading-row">
        <div className="workspace-page-heading-copy">
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="workspace-page-heading-actions">{actions}</div>}
      </div>
    </header>
  )
}
