export interface ComposerTagUpdate {
  text: string
  autoPrefix: string
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const hasTagToken = (content: string, path: string): boolean => {
  const tagPattern = new RegExp(`(^|\\s)#${escapeRegExp(path)}(?=\\s|$)`)
  return tagPattern.test(content)
}

export function applySelectedTagToComposer(content: string, selectedPath: string, previousAutoPrefix = ''): ComposerTagUpdate {
  const normalizedPath = selectedPath.trim().replace(/^#/, '')

  if (!normalizedPath) {
    return previousAutoPrefix && content.startsWith(previousAutoPrefix)
      ? { text: content.slice(previousAutoPrefix.length), autoPrefix: '' }
      : { text: content, autoPrefix: '' }
  }

  const nextPrefix = `#${normalizedPath} `
  if (previousAutoPrefix && !content.startsWith(previousAutoPrefix) && /^#[^\s#]+\s*$/.test(content)) {
    return { text: nextPrefix, autoPrefix: nextPrefix }
  }
  if (previousAutoPrefix && content.startsWith(previousAutoPrefix)) {
    return { text: `${nextPrefix}${content.slice(previousAutoPrefix.length)}`, autoPrefix: nextPrefix }
  }
  if (hasTagToken(content, normalizedPath)) {
    return { text: content, autoPrefix: '' }
  }
  return { text: content.trim() ? `${nextPrefix}${content}` : nextPrefix, autoPrefix: nextPrefix }
}
