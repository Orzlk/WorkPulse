# Findings & Decisions

## Requirements

- 支持导入 Flomo HTML 导出文件。
- 导入目标是 WorkPulse 工作日志。
- 保留原始时间、正文和 `#标签`。
- 附件暂不导入，只提示未导入数量。
- 支持重复导入时跳过重复记录。

## Research Findings

- Flomo 导出目录：`C:\Users\KAN\OneDrive\文档\flomo@orzlk-20260824`。
- 主文件：`orzlk的笔记.html`，大小约 70 KB。
- HTML 使用多个 `<div class="memo">` 节点。
- 时间在 `<div class="time">YYYY-MM-DD HH:mm:ss</div>`。
- 正文在 `<div class="content">`，包含 `p`、`ol`、`ul`、`li`、`br` 等标签。
- 标签通常位于正文第一段，例如 `#工作/三峡`。
- 附件位于 `<div class="files">` 下，当前导出包含 6 个 PNG。
- WorkPulse 已有 `import:logs` IPC，当前支持 CSV 和 Markdown。
- `addWorkLog` 已支持传入 `createdAt` 和 `tagNames`，并通过 `workLogExists` 做重复检测。
- 数据库已经有 `work_log_tags`，无需迁移。

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| 新增 `src/main/importers/flomoHtmlImporter.ts` | 将格式解析与数据库、IPC 解耦 |
| 用纯文本保留列表层次 | 当前日志模型不是富文本，避免新增编辑器或字段 |
| 独占首行标签转为关联标签并从正文移除 | 避免正文和标签 UI 重复，同时保留检索能力 |
| 附件只统计 | 与用户选择一致，且避免复制用户文件和新增附件模型 |
| HTML 选择继续使用文件对话框 | 用户可直接选择导出目录中的 `orzlk的笔记.html`，无需扫描目录 |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| planning-with-files 文档的初始路径不存在 | 使用插件实际存在的 `.codex/skills/planning-with-files/SKILL.md` |

## Resources

- `docs/superpowers/specs/2026-08-24-workpulse-flomo-import-design.md`
- `docs/superpowers/plans/2026-08-24-workpulse-flomo-import-implementation-plan.md`
- `src/main/ipc.ts`
- `src/main/db.ts`
- `src/renderer/src/pages/WorkLogPage.tsx`

## Visual/Browser Findings

- 本功能不需要新增视觉设计；复用现有日志导入按钮和 Toast 反馈。
