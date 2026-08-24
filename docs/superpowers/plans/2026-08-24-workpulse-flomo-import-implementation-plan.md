# WorkPulse Flomo HTML 导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Flomo HTML 导出文件导入 WorkPulse 工作日志，保留原始时间、正文和标签，并提示未导入附件。

**Architecture:** 新增无副作用的 Flomo HTML 解析器，输出标准化 memo 数据；主进程 IPC 复用现有日志写入、标签关联和重复检测；Renderer 只扩展文件类型和导入结果提示，不增加数据库表。

**Tech Stack:** Electron、TypeScript、better-sqlite3、React、Vitest、现有 IPC/Preload 契约。

## Global Constraints

- 导入目标固定为工作日志，不进入收件箱。
- 时间保留 Flomo 的 `YYYY-MM-DD HH:mm:ss` 原始本地时间。
- 标签写入 WorkPulse 标签关联，独占首行标签不重复保留在正文中。
- 附件不复制、不入库，只统计并提示未导入数量。
- 不新增 npm 依赖、不新增数据库迁移。
- 不执行 `git add`、`git commit` 或 `git push`。

---

### Task 1: 新增 Flomo HTML 解析器

**Files:**
- Create: `src/main/importers/flomoHtmlImporter.ts`
- Test: `tests/main/flomoHtmlImporter.test.ts`

**Interfaces:**
- Produces `FlomoMemo`, `FlomoImportParseResult` 和 `parseFlomoHtml(html: string)`。
- Parser 不访问数据库、不读取文件系统、不执行脚本。

- [ ] **Step 1: Write the failing tests**

在 `tests/main/flomoHtmlImporter.test.ts` 覆盖：

```ts
it('parses memo time, removes a standalone tag line, and keeps tags', () => {
  const result = parseFlomoHtml(`
    <div class="memo">
      <div class="time">2026-08-19 09:45:51</div>
      <div class="content"><p>#工作/三峡 #设计</p><ol><li><p>方案 A</p></li><li><p>方案 B</p></li></ol></div>
      <div class="files"></div>
    </div>
  `)
  expect(result.memos).toEqual([{ createdAt: '2026-08-19 09:45:51', content: '- 方案 A\n- 方案 B', tagNames: ['工作/三峡', '设计'], attachmentCount: 0 }])
})

it('decodes entities, preserves inline hashtags, and counts attachments', () => {
  const result = parseFlomoHtml(`
    <div class="memo"><div class="time">2026-08-20 10:00:00</div>
      <div class="content"><p>需求 &amp; 验证 #保留</p><p><br>下一行</p></div>
      <div class="files"><img src="file/a.png"><img src="file/b.png"></div>
    </div>
  `)
  expect(result.memos[0]).toMatchObject({ content: '需求 & 验证 #保留\n下一行', tagNames: ['保留'], attachmentCount: 2 })
  expect(result.attachmentCount).toBe(2)
})

it('skips memo blocks without a valid time or content', () => {
  const result = parseFlomoHtml('<div class="memo"><div class="time">bad</div><div class="content"><p>x</p></div></div>')
  expect(result.memos).toEqual([])
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/main/flomoHtmlImporter.test.ts`

Expected: FAIL because `src/main/importers/flomoHtmlImporter.ts` and `parseFlomoHtml` do not exist.

- [ ] **Step 3: Implement the minimal parser**

实现 memo 边界扫描、time/content 提取、HTML 实体解码、列表/段落换行、标签提取和附件计数。只接受合法的 `YYYY-MM-DD HH:mm:ss` 时间，空正文或无效时间的 memo 跳过。

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- tests/main/flomoHtmlImporter.test.ts`

Expected: all parser tests pass。

- [ ] **Step 5: Refactor only after green**

提取小型纯函数以保持 `parseFlomoHtml` 可读；再次运行同一测试。

### Task 2: 接入主进程日志导入

**Files:**
- Modify: `src/main/ipc.ts:410-472`
- Create: `src/main/importers/flomoLogImport.ts`
- Modify: `src/preload/index.ts:280-286`
- Modify: `src/preload/index.d.ts:279-285`
- Test: `tests/main/flomoImportIntegration.test.ts`

**Interfaces:**
- Consumes `parseFlomoHtml` 和现有 `addWorkLog`、`workLogExists`。
- Produces `{ imported, skipped, filePath, source, attachmentsSkipped }` for Flomo HTML; existing CSV/Markdown return shape remains compatible。

- [ ] **Step 1: Write the failing integration test**

使用临时 SQLite 数据库和最小 Flomo HTML，验证同一条记录导入两次时第一次写入、第二次跳过，且标签关联存在、附件数量返回为 1。

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/main/flomoImportIntegration.test.ts`

Expected: FAIL because the Flomo import helper/branch is not available。

- [ ] **Step 3: Implement the import branch**

将文件选择器扩展为 `CSV / Markdown / Flomo HTML`；HTML 分支读取文本、解析 memo，并逐条通过现有工作日志写入逻辑保存。保留 CSV/Markdown 分支行为。

- [ ] **Step 4: Update the preload contract**

将 `window.api.import.logs()` 返回类型扩展为可区分 `source` 和 `attachmentsSkipped` 的联合结果，不允许 Renderer 使用 `any`。

- [ ] **Step 5: Run focused tests and verify they pass**

Run: `npm test -- tests/main/flomoHtmlImporter.test.ts tests/main/flomoImportIntegration.test.ts`

Expected: all focused tests pass。

### Task 3: 更新日志导入 UI 和多语言文案

**Files:**
- Modify: `src/renderer/src/pages/WorkLogPage.tsx:200-214`
- Modify: `src/renderer/src/lib/i18n.ts:56-60,458-462`
- Test: `tests/renderer/flomoImportFeedback.test.ts` if existing UI helper boundary permits; otherwise verify with typecheck and manual Electron flow。

**Interfaces:**
- Consumes the typed result from `window.api.import.logs()`。
- Produces localized feedback for normal import, duplicate skipping, Flomo import and unimported attachments。

- [ ] **Step 1: Add a failing pure feedback test if a pure helper is extracted**

若现有组件逻辑无法直接单测，先提取 `formatLogImportFeedback(result, t)`，测试 Flomo 附件提示和普通导入提示的分支。

- [ ] **Step 2: Implement UI and translation changes**

保持现有导入按钮位置；导入完成后在有附件时追加未导入附件提示，无附件时使用简洁成功提示。补充中文和英文文案。

- [ ] **Step 3: Verify renderer behavior**

Run: `npm run typecheck:web`

Expected: Renderer 类型检查通过。

### Task 4: Use the provided Flomo export and verify the full feature

**Files:**
- Modify: `README.zh-CN.md` only if the existing import documentation needs the supported Flomo format.
- Modify: `task_plan.md`, `findings.md`, `progress.md`

- [ ] **Step 1: Run the parser against the provided export in a disposable read-only check**

确认 `C:\Users\KAN\OneDrive\文档\flomo@orzlk-20260824\orzlk的笔记.html` 能解析出约 85 条 memo，并统计 6 个附件；不直接写入用户数据库。

- [ ] **Step 2: Run the complete verification suite**

Run: `npm test`

Expected: all existing and new tests pass。

Run: `npm run typecheck`

Expected: Node 和 Web 类型检查通过。

Run: `npm run build`

Expected: main、preload、renderer 构建通过。

Run: `git diff --check`

Expected: no whitespace errors。

- [ ] **Step 3: Manual Electron acceptance**

Run: `npm run dev`；在日志页点击导入，选择 Flomo HTML，确认日志时间、标签和列表文本正确，重复导入只增加跳过数量，并提示 6 个附件未导入。

- [ ] **Step 4: Record verification results**

更新 `progress.md`，记录测试结果、实际解析数量和任何非阻塞限制；保持工作区不执行 Git 提交。
