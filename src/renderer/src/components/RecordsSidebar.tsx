import type { InboxFilter } from '../lib/workspaceTypes'
import { TagTreeSidebar } from './TagTreeSidebar'
import type { TagTreeNode } from '../lib/tagTree'

interface RecordsSidebarProps {
  mode: 'notes' | 'inbox'
  notesLabel: string
  inboxLabel: string
  tagNodes?: TagTreeNode[]
  selectedTagPath?: string
  allNotesLabel?: string
  noTagsLabel?: string
  tagSidebarId?: string
  onSelectTag?: (path: string) => void
  inboxFilter?: InboxFilter
  inboxFilterLabels?: Record<InboxFilter, string>
  onInboxFilter?: (filter: InboxFilter) => void
}

export function RecordsSidebar({
  mode,
  notesLabel,
  inboxLabel,
  tagNodes = [],
  selectedTagPath = '',
  allNotesLabel = '全部笔记',
  noTagsLabel = '暂无标签',
  tagSidebarId,
  onSelectTag,
  inboxFilter = 'all',
  inboxFilterLabels,
  onInboxFilter
}: RecordsSidebarProps): JSX.Element {
  return (
    <aside className="records-sidebar" aria-label={mode === 'notes' ? notesLabel : inboxLabel}>
      <div className="records-sidebar-heading">{mode === 'notes' ? notesLabel : inboxLabel}</div>
      {mode === 'notes' ? (
        <TagTreeSidebar
          id={tagSidebarId}
          nodes={tagNodes}
          selectedPath={selectedTagPath}
          allLabel={allNotesLabel}
          emptyLabel={noTagsLabel}
          onSelect={onSelectTag ?? (() => undefined)}
        />
      ) : (
        <nav className="records-sidebar-filters" aria-label={inboxLabel}>
          {(['all', 'unorganized', 'confirmed', 'ignored', 'archived'] as InboxFilter[]).map((filter) => (
            <button
              key={filter}
              type="button"
              className={`records-sidebar-filter ${inboxFilter === filter ? 'is-selected' : ''}`}
              aria-current={inboxFilter === filter ? 'page' : undefined}
              onClick={() => onInboxFilter?.(filter)}
            >
              {inboxFilterLabels?.[filter] ?? filter}
            </button>
          ))}
        </nav>
      )}
    </aside>
  )
}
