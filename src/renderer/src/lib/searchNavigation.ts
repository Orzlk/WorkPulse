export function getNextSearchIndex(current: number | null, count: number, direction: 1 | -1): number | null {
  if (count <= 0) return null
  if (current === null) return direction > 0 ? 0 : count - 1
  return (current + direction + count) % count
}
