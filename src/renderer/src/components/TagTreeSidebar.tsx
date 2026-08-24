import { ChevronDown, ChevronRight, Hash } from 'lucide-react'
import { useState } from 'react'
import type { TagTreeNode } from '../lib/tagTree'

interface TagTreeSidebarProps {
  nodes: TagTreeNode[]
  selectedPath: string
  allLabel: string
  emptyLabel: string
  onSelect: (path: string) => void
}

interface TagTreeItemProps {
  node: TagTreeNode
  depth: number
  selectedPath: string
  onSelect: (path: string) => void
}

function TagTreeItem({ node, depth, selectedPath, onSelect }: TagTreeItemProps): JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = node.children.length > 0

  return (
    <li role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <div className="tag-tree-row" style={{ paddingLeft: `${depth * 16 + 8}px` }}>
        {hasChildren ? (
          <button
            type="button"
            className="tag-tree-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-label={`${expanded ? '收起' : '展开'} ${node.label}`}
          >
            {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </button>
        ) : (
          <span className="tag-tree-toggle-placeholder" aria-hidden="true" />
        )}
        <button
          type="button"
          className={`tag-tree-label ${selectedPath === node.path ? 'is-selected' : ''}`}
          onClick={() => onSelect(node.path)}
          title={`#${node.path}`}
        >
          <Hash aria-hidden="true" />
          <span className="tag-tree-name">{node.label}</span>
          <span className="tag-tree-count">{node.usage_count}</span>
        </button>
      </div>
      {hasChildren && expanded && (
        <ul role="group">
          {node.children.map((child) => (
            <TagTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function TagTreeSidebar({ nodes, selectedPath, allLabel, emptyLabel, onSelect }: TagTreeSidebarProps): JSX.Element {
  return (
    <aside className="tag-tree-sidebar" aria-label={allLabel}>
      <button
        type="button"
        className={`tag-tree-all ${selectedPath === '' ? 'is-selected' : ''}`}
        onClick={() => onSelect('')}
      >
        <span>{allLabel}</span>
      </button>
      {nodes.length > 0 ? (
        <ul className="tag-tree-list" role="tree">
          {nodes.map((node) => (
            <TagTreeItem
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : (
        <p className="tag-tree-empty">{emptyLabel}</p>
      )}
    </aside>
  )
}
