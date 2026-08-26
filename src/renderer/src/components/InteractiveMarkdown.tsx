import { Children, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import { findInlineReferences, type InlineReference } from '../lib/workspaceInteractions'

interface InteractiveMarkdownProps {
  content: string
  projectId?: string | null
  projectName?: string
  selectedProjectId?: string
  selectedTagPath?: string
  onProjectClick: (projectId: string) => void
  onTagClick: (tagPath: string) => void
}

interface InlineRenderContext {
  projectId?: string | null
  projectName?: string
  selectedProjectId?: string
  selectedTagPath?: string
  onProjectClick: (projectId: string) => void
  onTagClick: (tagPath: string) => void
}

function transformMarkdownUrl(url: string): string {
  if (url.startsWith('workpulse-attachment://')) return url
  return defaultUrlTransform(url)
}

function renderInlineText(text: string, context: InlineRenderContext): ReactNode {
  const references = findInlineReferences(text, context.projectName)
  if (references.length === 0) return text

  const parts: ReactNode[] = []
  let cursor = 0
  references.forEach((reference, index) => {
    if (reference.start > cursor) parts.push(text.slice(cursor, reference.start))
    const token = text.slice(reference.start, reference.end)
    if (reference.type === 'tag') {
      parts.push(
        <button
          key={`${reference.start}-${index}`}
          type="button"
          className={`inline-reference inline-hash-reference ${context.selectedTagPath === reference.value ? 'is-selected' : ''}`}
          aria-label={`筛选标签 ${reference.value}`}
          onClick={() => context.onTagClick(reference.value)}
        >
          {token}
        </button>
      )
    } else if (context.projectId) {
      parts.push(
        <button
          key={`${reference.start}-${index}`}
          type="button"
          className={`inline-reference inline-project-reference ${context.selectedProjectId === context.projectId ? 'is-selected' : ''}`}
          aria-label={`筛选项目 ${reference.value}`}
          onClick={() => context.onProjectClick(context.projectId as string)}
        >
          {token}
        </button>
      )
    } else {
      parts.push(token)
    }
    cursor = reference.end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

function renderInteractiveChildren(children: ReactNode, context: InlineRenderContext): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === 'string') return renderInlineText(child, context)
    if (!isValidElement(child)) return child
    if (child.type === 'a') return child
    const element = child as ReactElement<{ children?: ReactNode }>
    return cloneElement(element, undefined, renderInteractiveChildren(element.props.children, context))
  })
}

function createBlockRenderer(tagName: keyof JSX.IntrinsicElements, context: InlineRenderContext) {
  return ({ children, node: _node, ...props }: { children?: ReactNode; node?: unknown }): JSX.Element => (
    createElement(tagName, props, renderInteractiveChildren(children, context))
  )
}

export function InteractiveMarkdown({
  content,
  projectId,
  projectName,
  selectedProjectId,
  selectedTagPath,
  onProjectClick,
  onTagClick
}: InteractiveMarkdownProps): JSX.Element {
  const context: InlineRenderContext = {
    projectId,
    projectName,
    selectedProjectId,
    selectedTagPath,
    onProjectClick,
    onTagClick
  }
  const components: Components = {
    p: createBlockRenderer('p', context),
    li: createBlockRenderer('li', context),
    h1: createBlockRenderer('h1', context),
    h2: createBlockRenderer('h2', context),
    h3: createBlockRenderer('h3', context),
    h4: createBlockRenderer('h4', context),
    h5: createBlockRenderer('h5', context),
    h6: createBlockRenderer('h6', context),
    blockquote: createBlockRenderer('blockquote', context),
    td: createBlockRenderer('td', context),
    th: createBlockRenderer('th', context)
  }

  return <ReactMarkdown components={components} urlTransform={transformMarkdownUrl}>{content}</ReactMarkdown>
}
