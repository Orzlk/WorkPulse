export interface TagTreeSource {
  public_id: string
  name: string
  path: string
  parent_id: string | null
  usage_count?: number
}

export interface TagTreeNode {
  path: string
  label: string
  public_id: string | null
  usage_count: number
  children: TagTreeNode[]
}

export function buildTagTree(tags: TagTreeSource[]): TagTreeNode[] {
  const nodes = new Map<string, TagTreeNode>()

  for (const tag of tags) {
    const segments = tag.path.split('/').map((segment) => segment.trim()).filter(Boolean)
    const displaySegments = tag.name.split('/').map((segment) => segment.trim()).filter(Boolean)
    let path = ''
    segments.forEach((segment, index) => {
      path = path ? `${path}/${segment}` : segment
      if (!nodes.has(path)) {
        nodes.set(path, {
          path,
          label: displaySegments[index] ?? segment,
          public_id: null,
          usage_count: 0,
          children: []
        })
      }
      const node = nodes.get(path)!
      if (displaySegments[index]) node.label = displaySegments[index]
      if (index === segments.length - 1) {
        const leaf = node
        leaf.public_id = tag.public_id
        leaf.usage_count += tag.usage_count ?? 0
      }
    })
  }

  Array.from(nodes.values()).forEach((node) => { node.children = [] })
  const roots: TagTreeNode[] = []
  Array.from(nodes.values()).forEach((node) => {
    const separator = node.path.lastIndexOf('/')
    const parentPath = separator >= 0 ? node.path.slice(0, separator) : ''
    const parent = parentPath ? nodes.get(parentPath) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  })

  const sortAndAggregate = (node: TagTreeNode): number => {
    node.children.sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'))
    node.usage_count += node.children.reduce((sum, child) => sum + sortAndAggregate(child), 0)
    return node.usage_count
  }

  roots.sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'))
  roots.forEach(sortAndAggregate)
  return roots
}
