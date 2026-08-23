# WorkPulse 本地优先工作记录与周期报告实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 WorkPulse 从日志、任务和基础 AI 月报原型升级为支持项目归属、收件箱、标签检索、本地 Git 扫描、自然周周报、自然月月报以及在线化预留的本地优先工作活动工具。

**Architecture:** 第一阶段继续以 Electron 主进程中的 SQLite 为本地数据源，但将 IPC 处理器限制为输入校验和调用 Application Service。Application Service 通过 Repository 接口访问数据，Git、AI、报告和同步分别使用独立服务；这样第二阶段可以在不重写 Renderer 业务逻辑的情况下增加云端同步，第三阶段再增加团队空间和权限。

**Tech Stack:** Electron 43、React 18、TypeScript 5.5、better-sqlite3 13、Zustand 5、date-fns 3、date-fns-tz、Tailwind CSS 3、Vitest。

## Global Constraints

- 所有时间字段统一保存为 UTC ISO 字符串；报告周期根据工作区时区计算。
- 周报周期必须是周一 00:00 至下周一 00:00 的左闭右开区间，不得使用最近 7 天替代。
- 月报周期必须是自然月第一天 00:00 至下月第一天 00:00 的左闭右开区间，不得使用最近 30 天替代。
- Git 采集只能执行只读命令，不读取完整 diff、文件路径或源代码内容。
- AI 只能接收用户选择的记录快照，不能直接访问 SQLite、API Key 或未授权项目数据。
- 收件箱 AI 整理和 AI 报告都只生成建议稿，用户确认或保存后才成为正式结果。
- 一个记录最多归属一个项目；仓库可以关联一个项目，仓库历史提交在报告中跟随仓库当前项目。
- 核心实体使用稳定 UUID；本地整数 ID 在第一阶段仅作为兼容字段保留。
- 删除优先使用 `deleted_at` 软删除，不物理删除参与过报告或同步的数据。
- 不执行 `git add`、`git commit`、`git push`，除非用户明确授权本次 Git 操作。

---

## 现状与实施边界

当前实现集中在以下文件：

- `src/main/db.ts`：SQLite 建表、迁移、日志/任务/报告 CRUD 和设置。
- `src/main/ipc.ts`：直接注册 IPC 并直接调用数据库函数。
- `src/main/ai.ts`：OpenAI、Anthropic、DeepSeek 文本请求和当前报告 Prompt。
- `src/preload/index.ts`、`src/preload/index.d.ts`：Renderer 可用 API 与类型。
- `src/renderer/src/App.tsx`：顶部导航和页面切换。
- `src/renderer/src/pages/WorkLogPage.tsx`、`KanbanPage.tsx`、`ReportPage.tsx`：当前主要界面。
- `src/renderer/src/stores/worklogStore.ts`、`taskStore.ts`：当前 Zustand 状态。

现有仓库没有测试脚本，且当前环境没有安装 `node_modules`。实施第一步必须补齐测试脚本和依赖，然后再运行类型检查和测试；不要把缺少依赖误判为代码通过。

## 阶段一：本地优先单用户版

阶段一交付完整可用的本地功能，同时写入未来同步所需的身份、工作区、软删除和操作队列字段。阶段一完成后，用户可以在没有网络的情况下记录内容、扫描 Git、搜索和生成周报/月报。

### Task 1: 建立测试基线与周期计算模块

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/main/lib/period.ts`
- Create: `tests/main/period.test.ts`

**Interfaces:**
- Produces `ReportType = 'weekly' | 'monthly'`。
- Produces `ReportPeriod = { type: ReportType; startDate: string; endDateExclusive: string; fromUtc: string; toUtc: string; label: string }`。
- Produces `resolveReportPeriod(type: ReportType, anchorDate: string, timeZone: string): ReportPeriod`。

- [ ] **Step 1: 增加测试依赖和脚本**

在 `package.json` 增加 `vitest` 开发依赖和以下脚本：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

增加 `date-fns-tz` 运行时依赖，用于把工作区本地日历边界转换为 UTC。

- [ ] **Step 2: 写失败测试验证自然周和自然月边界**

```ts
it('returns Monday through next Monday for a weekly period', () => {
  expect(resolveReportPeriod('weekly', '2026-08-23', 'Asia/Shanghai')).toMatchObject({
    startDate: '2026-08-17',
    endDateExclusive: '2026-08-24',
    label: '2026-08-17 至 2026-08-23'
  })
})

it('returns the first day through the first day of next month', () => {
  expect(resolveReportPeriod('monthly', '2026-08-23', 'Asia/Shanghai')).toMatchObject({
    startDate: '2026-08-01',
    endDateExclusive: '2026-09-01'
  })
})

it('uses the configured timezone when converting calendar boundaries', () => {
  const shanghai = resolveReportPeriod('weekly', '2026-08-23', 'Asia/Shanghai')
  const losAngeles = resolveReportPeriod('weekly', '2026-08-23', 'America/Los_Angeles')
  expect(shanghai.fromUtc).not.toBe(losAngeles.fromUtc)
})
```

运行：`npm install`，然后 `npm test -- tests/main/period.test.ts`。预期：首次运行因 `resolveReportPeriod` 尚未实现而失败。

- [ ] **Step 3: 实现周期计算**

使用 `date-fns` 的 `startOfWeek({ weekStartsOn: 1 })` 和 `startOfMonth` 计算本地日历日，再使用 `date-fns-tz` 的 `fromZonedTime` 转为 UTC。`endDateExclusive` 永远是下一个周期的起点，数据库查询只使用 `>= fromUtc AND < toUtc`。

- [ ] **Step 4: 运行测试并锁定周期契约**

运行：`npm test -- tests/main/period.test.ts`。预期：周期测试全部通过；将 `ReportPeriod` 作为后续报告查询和 UI 选择器的唯一输入格式。

### Task 2: 重建可重复执行的 SQLite 迁移与备份基础

**Files:**
- Create: `src/main/database/types.ts`
- Create: `src/main/database/connection.ts`
- Create: `src/main/database/migrations.ts`
- Create: `tests/main/migrations.test.ts`
- Modify: `src/main/db.ts`

**Interfaces:**
- `openDatabase(path: string): Database.Database`
- `runMigrations(database: Database.Database): void`
- `backupDatabase(database: Database.Database, targetPath: string): Promise<void>`
- `getDatabaseVersion(database: Database.Database): number`

- [ ] **Step 1: 为迁移执行器写失败测试**

测试使用临时 SQLite 文件，验证：新数据库执行全部迁移；旧版只含 `work_logs/tasks/reports/settings` 的数据库保留原记录；迁移重复执行不会重复建表；迁移失败回滚事务；备份包含 WAL 中已提交数据。

关键断言：

```ts
expect(getDatabaseVersion(database)).toBe(CURRENT_SCHEMA_VERSION)
expect(database.prepare('SELECT COUNT(*) AS count FROM work_logs').get()).toEqual({ count: 1 })
expect(database.prepare('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = \'sync_operations\'').get()).toBeTruthy()
```

- [ ] **Step 2: 定义迁移版本和兼容策略**

`schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)` 使用事务逐版本执行。迁移拆分为：

1. `001_core_schema`：为新数据库建立当前旧版基础表；已有旧库检测到旧表后只登记基线，不重建数据。
2. `002_workspace_identity`：建立默认个人工作区和本地用户，给核心表增加 `public_id`、`workspace_id`、`created_by`、`updated_by`、`updated_at`、`deleted_at`，为旧行回填 UUID 和默认工作区。
3. `003_projects_inbox_repositories`：建立项目、收件箱、Git 仓库、仓库本地绑定和 Git 提交表，为日志/任务/收件箱增加 `project_id`、`repository_id`。
4. `004_tags_search`：建立标签及五张关联表和 FTS5 索引表。
5. `005_reports_periods`：扩展报告类型为 `weekly/monthly/custom`，增加工作区、周期类型、周期左闭右开边界、输入快照、版本和报告项目/仓库筛选关系。
6. `006_sync_outbox`：建立 `sync_operations`，记录实体、操作类型、幂等操作 ID、payload、状态和重试次数。

- [ ] **Step 3: 实现迁移和数据回填**

迁移每一步都包在 `database.transaction(() => ...)` 中。SQLite 无法直接修改旧 `CHECK` 约束时，使用 `tasks_new` 完整迁移，再通过 `ALTER TABLE` 替换；禁止使用 `DROP TABLE` 作为无备份的常规升级步骤。

所有核心表新增 `public_id TEXT` 后先回填，再创建唯一索引；现有整数 `id` 保留，旧 IPC 在阶段一继续可用。旧 `created_at` 为本地时间的记录按首次启动时区转换为 UTC，并在迁移日志中保存转换时区。

- [ ] **Step 4: 替换不安全备份逻辑**

将 `copyFileSync(getDbPath(), backupPath)` 替换为 better-sqlite3 backup API 或等价安全备份流程，备份前执行 checkpoint，备份后执行完整性检查。备份文件按日期和序号保留，迁移前强制创建一次独立备份。

- [ ] **Step 5: 运行迁移测试和类型检查**

运行：`npm test -- tests/main/migrations.test.ts`、`npm run typecheck:node`。预期：迁移、回滚、WAL 备份测试通过，Node 类型检查无错误。

### Task 3: 建立领域类型、Repository 和项目/收件箱/标签服务

**Files:**
- Create: `src/main/domain/types.ts`
- Create: `src/main/repositories/contracts.ts`
- Create: `src/main/repositories/localProjectRepository.ts`
- Create: `src/main/repositories/localInboxRepository.ts`
- Create: `src/main/repositories/localTagRepository.ts`
- Create: `src/main/services/projectService.ts`
- Create: `src/main/services/inboxService.ts`
- Create: `src/main/services/searchService.ts`
- Create: `tests/main/inboxService.test.ts`
- Modify: `src/main/db.ts`

**Interfaces:**

```ts
export interface Project {
  public_id: string
  name: string
  description: string
  color: string
  archived_at: string | null
}

export interface InboxItem {
  public_id: string
  content: string
  project_id: string | null
  repository_id: string | null
  state: 'unorganized' | 'confirmed' | 'ignored' | 'archived'
  include_in_reports: boolean
  ai_suggestion: InboxSuggestion | null
  created_at: string
  updated_at: string
}

export interface InboxSuggestion {
  target: 'work_log' | 'task' | 'ignore'
  title: string
  summary: string
  project_id: string | null
  repository_id: string | null
  tag_names: string[]
  include_in_reports: boolean
}

export interface GitRepository {
  public_id: string
  name: string
  project_id: string | null
  enabled: boolean
  scan_interval_minutes: number
  last_scanned_at: string | null
  last_error: string | null
}

export interface RepositoryBinding {
  repository_id: string
  local_path: string
  machine_id: string
  is_valid: boolean
}
```

Repository 接口至少提供 `list`, `get`, `create`, `update`, `softDelete` 和分页查询；Service 负责校验项目/仓库归属、保留原始收件箱内容和写入 `sync_operations`，IPC 不再直接拼装 SQL。

- [ ] **Step 1: 写收件箱和项目归属测试**

覆盖以下行为：收件箱内容创建后状态为 `unorganized`；确认建议前不会创建日志/任务；确认后只创建一个目标实体；原始内容保持不变；项目不存在时拒绝归属；软删除后默认列表不返回但历史查询可读取。

- [ ] **Step 2: 实现项目和收件箱 Repository**

所有查询显式带 `workspace_id` 和 `deleted_at IS NULL`。项目归属更新只写 `project_id`，不删除记录；确认收件箱使用事务同时写入目标实体、标签关联和收件箱状态。

- [ ] **Step 3: 实现标签规范化**

提供 `normalizeTagName(name: string): string`：去掉一个开头 `#`、压缩连续空白、统一大小写比较值、保留 `/` 层级。标签表保存 `name`、`normalized_name`、`parent_id`；搜索父标签时使用前缀匹配 `normalized_name = parent OR normalized_name LIKE parent || '/%'`。

- [ ] **Step 4: 运行服务测试**

运行：`npm test -- tests/main/inboxService.test.ts`。预期：事务、原始内容保护、项目校验和软删除测试全部通过。

### Task 4: 实现本地 Git 只读扫描和定时调度

**Files:**
- Create: `src/main/git/gitCommand.ts`
- Create: `src/main/git/gitScanner.ts`
- Create: `src/main/services/repositoryService.ts`
- Create: `tests/main/gitScanner.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/db.ts`

**Interfaces:**

```ts
export interface GitCommitSummary {
  repository_id: string
  commit_hash: string
  author_name: string
  author_email: string
  committed_at: string
  branch: string
  subject: string
  file_count: number
  additions: number
  deletions: number
}

export interface GitScanner {
  scan(repository: GitRepository, binding: RepositoryBinding, options: { since?: string; until?: string }): Promise<ScanResult>
}
```

- [ ] **Step 1: 写临时 Git 仓库测试**

测试创建临时仓库并写入三个提交，验证首次扫描只返回最近 30 天、重复扫描按 `repository_id + commit_hash` 去重、`--numstat` 正确汇总文件数/增删行、二进制文件不产生 `NaN`、无效路径返回可展示错误且不影响其他仓库。

- [ ] **Step 2: 封装安全 Git 命令执行**

使用 `child_process.execFile('git', args, { cwd, timeout })`，参数数组传递路径，禁止拼接 shell 字符串。先执行 `rev-parse --show-toplevel` 校验仓库，再读取当前分支和日志。扫描只使用 `log`、`rev-parse` 等只读命令，不执行 checkout、fetch、reset 或写入操作。

- [ ] **Step 3: 实现首次和增量扫描**

首次添加仓库使用 `now - 30 days`；后续从最近扫描时间前移一个安全重叠窗口读取，再通过唯一索引去重。扫描结果写入 Git 提交摘要和扫描状态；仓库更换项目后不更新提交归属字段，报告查询通过仓库当前 `project_id` 归类。

- [ ] **Step 4: 接入调度器和手动扫描**

在 `src/main/index.ts` 的 `app.whenReady()` 完成数据库初始化后启动 `setInterval` 调度，默认 30 分钟，读取设置覆盖并允许关闭；每个仓库使用串行锁，避免同一仓库重叠扫描。新增手动扫描服务支持单仓库和全部启用仓库，并返回成功数、提交数和错误列表。

- [ ] **Step 5: 运行 Git 测试**

运行：`npm test -- tests/main/gitScanner.test.ts`。预期：提交解析、最近 30 天、增量去重、错误隔离和只读命令测试通过。

### Task 5: 实现统一周报/月报查询、AI 输入快照和版本保存

**Files:**
- Create: `src/main/reports/reportTypes.ts`
- Create: `src/main/reports/reportQueryService.ts`
- Create: `src/main/reports/reportService.ts`
- Create: `tests/main/reportQuery.test.ts`
- Modify: `src/main/ai.ts`
- Modify: `src/main/db.ts`

**Interfaces:**

```ts
export interface ReportRequest {
  type: 'weekly' | 'monthly'
  anchorDate: string
  timeZone: string
  projectIds: string[]
  repositoryIds: string[]
}

export interface Report {
  public_id: string
  type: 'weekly' | 'monthly'
  period_start: string
  period_end: string
  timezone: string
  status: 'generating' | 'ready' | 'error'
  content: string
  version: number
  generated_at: string
  updated_at: string
}

export interface ReportSourceSnapshot {
  period: ReportPeriod
  projects: Array<{
    projectId: string | null
    projectName: string
    logs: Array<{ id: string; content: string; createdAt: string; tagNames: string[] }>
    tasks: Array<{ id: string; title: string; description: string; status: string; completedAt: string | null }>
    commits: GitCommitSummary[]
  }>
}

export async function generatePeriodReport(request: ReportRequest): Promise<Report>
```

- [ ] **Step 1: 写周期严格取数测试**

构造边界前一秒、起点、周期内最后一秒、结束点四组记录，分别验证周报和月报只包含 `[fromUtc, toUtc)` 内的数据；验证任务按创建时间、完成时间分别取数；验证项目/仓库筛选和未归属项目分组。

- [ ] **Step 2: 实现 ReportQueryService**

报告查询只选择用户授权的字段：日志文本、任务必要字段、Git 提交摘要和标签名称。Git 查询按仓库当前项目归属动态分组；未整理收件箱默认排除，只有 `include_in_reports = 1` 且用户选择时才进入快照。快照保存为 JSON，便于日后查看报告依据。

- [ ] **Step 3: 扩展 AI 输入和 Prompt**

把 `generateReport(logs, dateFrom, dateTo, tasks)` 替换为 `generatePeriodReportContent(snapshot, reportType, period)`。Prompt 必须要求：按项目分组、提炼核心功能/缺陷/重构维护、标注阻塞和待跟进、无证据不推断，不逐条复制 commit。周报使用“下周待跟进”，月报使用“下月建议”。

保留现有 provider 配置，新增 `AbortController` 60 秒超时、响应结构校验和空内容错误；AI 请求失败时不写入成功报告，报告状态保存为 `error` 和可重试信息。

- [ ] **Step 4: 保存报告版本**

报告表字段至少包括 `public_id`、`workspace_id`、`type`、`period_start`、`period_end`、`timezone`、`project_scope`、`repository_scope`、`source_snapshot`、`content`、`version`、`status`、`generated_at`、`updated_at`。编辑报告创建新版本或显式更新当前版本，不能覆盖其他版本。

- [ ] **Step 5: 运行报告测试**

运行：`npm test -- tests/main/reportQuery.test.ts`。预期：周/月边界、项目归类、筛选范围、快照字段和版本保存测试通过。

### Task 6: 收敛 IPC、Preload 类型和迁移/导入导出入口

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/main/i18n.ts`
- Modify: `src/renderer/src/lib/i18n.ts`
- Modify: `src/main/db.ts`

**Interfaces:**

新增 IPC：

```text
project:list/create/update/archive
inbox:list/create/update/organize/ignore/archive
tag:list/create/rename/search
search:query
repository:list/create/update/scan/scanAll
report:generate/list/get/update
database:export/import
```

`report.generate` 只接受 `ReportRequest`，由主进程重新计算周期边界，不信任 Renderer 传入的任意日期范围。所有 ID、枚举、分页大小、项目/仓库筛选在 IPC 入口做运行时校验。

- [ ] **Step 1: 先更新 Preload 类型测试契约**

在 `src/preload/index.d.ts` 定义项目、收件箱、标签、仓库、Git 提交、报告请求和分页结果；`src/preload/index.ts` 的 API 实现必须与声明一一对应，禁止继续使用 `Record<string, unknown>` 作为任务更新的逃生类型。

- [ ] **Step 2: 把 IPC 改为调用 Service**

删除报告处理器中直接调用 `getWorkLogsByDateRange/getTasks` 的逻辑，改为调用 `generatePeriodReport`；删除、更新和归属操作统一经过 Service，写入软删除和同步操作。错误转换为稳定的错误码，Renderer 只根据错误码显示文案。

- [ ] **Step 3: 增加迁移和迁移包入口**

导出包括 SQLite 安全备份、schema version、工作区/项目/仓库绑定元数据；导入前显示记录概览，支持合并模式并按 `public_id` 去重。路径失效时只标记未绑定，不尝试自动访问未知路径。

- [ ] **Step 4: 补齐中英文文案并运行类型检查**

运行：`npm run typecheck:node`、`npm run typecheck:web`。预期：所有 IPC 返回类型和 Renderer 调用一致；新增错误码、周报/月报标签和提醒文案均有中英文键值。

### Task 7: 实现现代高性能 Renderer 工作区

**Files:**
- Create: `src/renderer/src/pages/InboxPage.tsx`
- Create: `src/renderer/src/pages/ProjectsPage.tsx`
- Create: `src/renderer/src/pages/RepositoriesPage.tsx`
- Create: `src/renderer/src/components/GlobalSearch.tsx`
- Create: `src/renderer/src/stores/projectStore.ts`
- Create: `src/renderer/src/stores/inboxStore.ts`
- Create: `src/renderer/src/stores/repositoryStore.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/pages/WorkLogPage.tsx`
- Modify: `src/renderer/src/pages/KanbanPage.tsx`
- Modify: `src/renderer/src/components/QuickCreate.tsx`
- Modify: `src/renderer/src/index.css`

**Interfaces:**

- 导航页面增加 `inbox`、`projects`、`repositories`，保留原有 `worklog`、`kanban`、`report`、`stats`、`settings`。
- `GlobalSearch` 输入关键词后以 250–300ms 防抖调用 `search:query`，结果包含来源、项目、标签和时间。
- `QuickCreate` 支持 `log`、`task`、`inbox` 三种入口；输入 `#技术/前端` 时解析标签并保留原始文本。

- [ ] **Step 1: 写 Store 的异步状态测试**

至少覆盖：搜索请求过期结果不会覆盖新结果；重复加载使用游标/分页；扫描和 AI 生成状态有 `idle/running/success/error`；项目切换只刷新依赖项目的列表。

- [ ] **Step 2: 改造 App 壳和导航**

使用 `React.lazy` 按页面动态加载；将顶部导航迁移为可折叠左侧导航；加入 `Ctrl/Cmd + K` 命令面板入口。首屏只加载当前页面，不等待 Git 扫描、数据库迁移提示之外的后台任务或 AI。

- [ ] **Step 3: 实现收件箱和项目页**

收件箱使用 48–56px 快速输入框、列表和右侧详情抽屉；AI 建议展示类型、项目、仓库和标签，确认按钮明确区分“确认整理”和“忽略”。项目页显示任务、日志、Git 提交、报告入口和项目统计。

- [ ] **Step 4: 为日志/任务增加项目和标签入口**

编辑时支持项目单选、仓库单选、多标签输入、已有标签补全和父级标签筛选；看板保留拖拽，同时提供“移动到……”菜单和键盘可操作按钮。

- [ ] **Step 5: 应用性能与可访问性规则**

活动流、搜索结果、收件箱和 Git 提交使用分页；超过阈值再启用虚拟列表。动画只使用 `transform/opacity`，遵守 `prefers-reduced-motion`；图标按钮带 `aria-label`，焦点状态和颜色之外的文本状态都可见。

- [ ] **Step 6: 运行 Renderer 类型检查和手动验收**

运行：`npm run typecheck:web`。手动验收：400px 宽度可用、键盘可新增记录/搜索/筛选/移动任务/生成报告、后台扫描期间输入不中断、AI 失败后可重试。

### Task 8: 改造周报/月报页面和提醒流程

**Files:**
- Modify: `src/renderer/src/pages/ReportPage.tsx`
- Modify: `src/renderer/src/stores/worklogStore.ts`
- Modify: `src/renderer/src/lib/dateUtils.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/main/index.ts`
- Modify: `src/main/i18n.ts`
- Modify: `src/renderer/src/lib/i18n.ts`

- [ ] **Step 1: 增加报告类型切换和自然周期选择器**

周报选择器显示最近完整周的周一至周日；月报选择器显示自然月。Renderer 只发送 `type + anchorDate + filters`，不自行拼接数据库边界。

- [ ] **Step 2: 接入项目/仓库多选和未整理提醒**

报告生成前显示当前范围、项目数、仓库数和可纳入收件箱数；有未整理记录时显示提醒，但不自动调用 AI。用户确认后才开始生成。

- [ ] **Step 3: 展示 AI 阶段状态和报告版本**

状态至少包括读取数据、分析 Git、按项目归类、生成报告、保存版本和失败重试。历史列表显示周报/月报类型、周期、项目范围、版本和生成时间。

- [ ] **Step 4: 运行报告页面验收**

覆盖 2026-08-17 至 2026-08-23 周报、2026-08 月报、空数据、无 API Key、AI 超时、重新生成、编辑保存和 Markdown 导出。

### Task 9: 完成阶段一集成验证和发布前检查

**Files:**
- Modify: `package.json`
- Create: `docs/superpowers/checklists/stage-1-acceptance.md`
- Modify: `README.md`

- [ ] **Step 1: 运行完整验证命令**

```text
npm test
npm run typecheck
npm run build
git diff --check
```

预期：测试无失败，Node/Web 类型检查无错误，Electron 构建成功；若依赖尚未安装，先运行 `npm install` 后重新执行，不能仅记录“命令未找到”。

- [ ] **Step 2: 执行数据安全验收**

使用复制的测试数据库验证旧数据迁移、迁移失败回滚、WAL 备份恢复、导入合并、重复 Git 扫描、无效仓库路径和报告快照恢复；不得在用户真实数据库上进行破坏性测试。

- [ ] **Step 3: 执行产品验收清单**

确认收件箱快速记录、AI 建议确认、项目归属、标签层级搜索、Git 首次 30 天扫描、增量扫描、周报、月报、编辑保存、筛选和导出均可完成；确认未整理记录不会被自动发送给 AI。

- [ ] **Step 4: 更新文档并等待用户评审**

README 增加本地数据库位置、备份/导入、Git 只读扫描、AI 数据边界、周报/月报周期规则和当前阶段不包含登录/团队协作的说明。

## 阶段二：单用户在线同步版

阶段二在阶段一验收通过后单独开发，不改变第一阶段的本地离线能力。第一阶段已经预留 `public_id`、`workspace_id`、UTC 时间、软删除、`RepositoryBinding` 和 `sync_operations`，阶段二直接消费这些字段。

### 阶段二交付任务

1. 新增账号、设备和个人工作区 API；本地 Renderer 仍只调用 Application Service。
2. 新增 `src/main/sync/remoteRepository.ts`、`syncEngine.ts` 和 `syncCursor.ts`，实现本地 outbox 上传、云端变更下载、断点续传和幂等操作 ID。
3. Git 提交按 `repository_id + commit_hash` 去重；日志和项目按版本号/最后修改时间冲突；任务提供冲突提示；报告保留版本，不覆盖其他设备版本。
4. API 使用 HTTPS，工作区隔离；API Key 不同步；AI 发送前保留用户确认和数据范围预览。
5. 增加多设备断网、重连、重复上传、冲突、导出和账号删除测试。

### 阶段二退出条件

- 同一用户在两台设备可离线记录并自动合并。
- 断网期间 Git 扫描和报告草稿不丢失。
- 同步失败可重试且不会产生重复日志、任务或提交。
- 用户可以导出、恢复和删除个人数据。

## 阶段三：团队空间与多人协作版

阶段三在阶段二稳定后开发，团队数据和个人空间严格隔离。团队月报只能读取当前用户有权限访问的项目，仓库本地路径仍是设备绑定，不向其他成员暴露。

### 阶段三交付任务

1. 新增团队空间、成员邀请、移除和 `Owner/Admin/Member/Viewer` 角色。
2. 新增项目成员和项目级权限，区分个人记录、团队共享记录和团队报告。
3. Git 提交作为不可变活动共享；任务状态/排序使用版本控制并提示冲突；日志编辑保存修改者和修改时间；报告使用版本历史。
4. 增加团队 AI 配置、调用额度、数据范围预览、成员可见性和活动通知。
5. 增加权限矩阵、越权访问、成员离职、项目归档、团队报告和个人数据隔离测试。

### 阶段三退出条件

- 未授权成员无法读取项目、日志、任务、Git 提交和报告。
- 个人空间内容不会因加入团队而自动共享。
- 团队报告只包含当前用户可见项目的已授权快照。
- 项目归档和成员移除不会破坏历史报告和审计记录。

## 实施顺序与评审点

1. 先完成 Task 1–2，评审时间格式、迁移策略和备份安全性。
2. 再完成 Task 3–5，评审本地领域服务、Git 摘要和报告输入快照。
3. 完成 Task 6 后评审 IPC 契约，确保 Renderer 不再直接依赖数据库字段细节。
4. 完成 Task 7–8 后进行 UI 和性能验收。
5. 完成 Task 9 后才进入阶段二，不在阶段一混入登录、云端或实时协作。

每个 Task 完成后运行该 Task 的测试，并在进入下一个 Task 前做一次代码评审。实现阶段需要使用 `subagent-driven-development` 或 `executing-plans` 按任务执行，不把多个独立子系统一次性混成一个未验证的大改动。
