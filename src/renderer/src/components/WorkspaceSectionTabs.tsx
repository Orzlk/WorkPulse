import type { ReactNode } from 'react'

export interface WorkspaceSectionTabItem {
  id: string
  label: string
  active?: boolean
  onClick?: () => void
  badge?: ReactNode
}

interface WorkspaceSectionTabsProps {
  ariaLabel: string
  items: WorkspaceSectionTabItem[]
  actions?: ReactNode
}

export function WorkspaceSectionTabs({ ariaLabel, items, actions }: WorkspaceSectionTabsProps): JSX.Element {
  return (
    <nav className="workspace-section-tabs" aria-label={ariaLabel}>
      <div className="workspace-section-tab-list">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`workspace-section-tab ui-tab ${item.active ? 'is-active' : ''}`}
            aria-current={item.active ? 'page' : undefined}
            onClick={item.onClick}
          >
            <span>{item.label}</span>
            {item.badge}
          </button>
        ))}
      </div>
      {actions && <div className="workspace-section-tab-actions">{actions}</div>}
    </nav>
  )
}
