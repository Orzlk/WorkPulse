export function findReportByPublicId<T extends { public_id: string }>(reports: T[], publicId: string | null | undefined): T | null {
  if (!publicId) return null
  return reports.find((report) => report.public_id === publicId) ?? null
}
