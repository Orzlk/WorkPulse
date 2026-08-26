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
}

export function WorkspaceSectionTabs({ ariaLabel, items }: WorkspaceSectionTabsProps): JSX.Element {
  return (
    <nav className="workspace-section-tabs" aria-label={ariaLabel}>
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
    </nav>
  )
}
