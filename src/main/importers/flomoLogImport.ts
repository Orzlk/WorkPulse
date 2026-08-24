import type { FlomoMemo } from './flomoHtmlImporter'

export interface FlomoLogWriter {
  addWorkLog: (
    content: string,
    category?: string,
    taskId?: number | null,
    createdAt?: string,
    associations?: { tagNames?: string[] }
  ) => unknown
  workLogExists: (content: string, category: string, dateStr?: string) => boolean
}

export interface FlomoLogImportSummary {
  imported: number
  skipped: number
}

export function importFlomoMemos(memos: FlomoMemo[], writer: FlomoLogWriter): FlomoLogImportSummary {
  let imported = 0
  let skipped = 0

  for (const memo of memos) {
    if (writer.workLogExists(memo.content, '', memo.createdAt)) {
      skipped++
      continue
    }

    writer.addWorkLog(memo.content, '', null, memo.createdAt, { tagNames: memo.tagNames })
    imported++
  }

  return { imported, skipped }
}
