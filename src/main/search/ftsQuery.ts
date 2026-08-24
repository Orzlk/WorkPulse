export function buildFtsQuery(input: string): string {
  const terms = input
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/^"+|"+$/g, '').replace(/"/g, '""'))
    .filter(Boolean)

  if (terms.length === 0) throw new Error('Search text is empty')
  return terms.map((term) => `"${term}"`).join(' AND ')
}
