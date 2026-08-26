# Findings & Decisions

## 2026-08-26 图片按钮文案

- 新建笔记和独立编辑窗口的图片选择逻辑、拖拽和粘贴逻辑均已存在。
- 图片按钮误用了 `common.save` 文案，容易让用户误以为是保存笔记；应使用独立的 `worklog.insertImage` 文案。

## 2026-08-26 Flomo 图片显示问题

- 实际导入记录、附件文件和数据库内容均正常，正文包含 `![memo image](workpulse-attachment://attachment/...)`，附件也存在于 `userData/attachments`。
- 根因是 `react-markdown` 默认 URL 转换器会过滤 `workpulse-attachment://` 自定义协议，导致图片请求被清理后只显示 alt 文本。
- 仅放行 `workpulse-attachment://`，其他链接继续交给 `defaultUrlTransform`，避免扩大 Markdown URL 安全范围。

## 2026-08-26 数据库迁移压缩

- 当前源码数据库最终结构由迁移 001～014 逐步构建，v14 用于修复 `kanban_columns` 缺表。
- 软件尚未发布且用户允许清空并重新导入，因此可以将现有迁移步骤合并到单一 v1 初始化迁移。
- 不能只修改版本常量；必须让 v1 初始化完整创建项目、标签、Git、报告、FTS5 和看板结构。
- 旧本地数据库不再兼容，重置后应删除数据库文件并重新启动，再执行数据导入。

## Requirements

- 支持导入 Flomo HTML 导出文件。
- 导入目标是 WorkPulse 工作日志。
- 保留原始时间、正文和 `#标签`。
- 导入 Flomo 时复制图片附件并改写为 WorkPulse 本地附件协议；音频、视频、缺失和不支持格式只统计并提示跳过。
- 支持重复导入时跳过重复记录。

## 2026-08-26 UI 视觉系统审计与实施决策

- `src/renderer/src/index.css` 约 3490 行，存在旧版基础规则、Hallmark/Swiss 规则、Flomo 风格覆盖和 Settings 页面 Tailwind 样式多套并存。
- 当前语义色为绿色主操作、蓝色标签、青绿色项目、橙色选中、红色危险，但 Settings 仍大量使用 `zinc/blue/red` 直接颜色，导致同类控件跨页面不一致。
- 页面导航同时使用一级顶部导航、面包屑、二级 Tab、记录侧边栏和设置侧边栏；应明确一级导航、页面内 Tab、内容筛选三种层级，避免同一层级混用。
- 采用“Flomo 风格安静工作台”：浅灰画布、白色卡片、柔和边框、轻阴影、绿色主操作；保留现有 WorkPulse 蓝色 Logo，不改变业务逻辑和数据结构。
- 本轮先建立共享 UI Token 和 CSS 公共控件基线，再逐页迁移；不继续新增无组织的页面末尾覆盖规则。
- 保留 Tailwind 依赖以减少无关变更，但新 UI 控件统一使用语义 Token/公共类，逐步移除页面级硬编码颜色。

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
| 图片附件复制，其余格式统计跳过 | 复用现有本地附件存储和安全协议，避免引入新的附件数据库模型 |
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

## Architecture Review Findings: 2026-08-24

- `src/main/db.ts` 当前约 672 行，包含 work log、task、report、stats 和 settings 等多类操作；项目已有 repository/service 分层，适合渐进迁移，不适合一次性重写。
- SQLite 当前是单连接模型，不存在连接池；`db.ts` 的目标应是连接、迁移、生命周期管理，跨表事务和同步 outbox 由 Service 协调。
- `src/main/database/migrations.ts` 已创建 `content_search` FTS5 虚拟表；目前索引维护只覆盖 `inbox_item`，`src/main/services/searchService.ts` 和 `src/main/db.ts` 仍对部分实体使用 `LIKE`。
- FTS5 修正应覆盖 work_logs、tasks、inbox_items 和 git_commits，包含已有数据回填、新增/修改/删除同步、`MATCH` 查询和可验证的中文检索策略；不能直接承诺“毫秒级”。
- 报告已通过 `reportService`、`reportQueryService` 和 `periodReportAi` 分层，当前报告生成接口为 `Promise<string>`，AI Provider 一次性读取 JSON；流式输出应保持在主进程请求链路，并通过带 requestId 的 IPC 推送临时内容。
- Inbox 已有 `ai_suggestion` 字段和 UI，但没有后台自动分析管线；自动分拣应默认可选、可取消，并且必须经过用户确认后改变任务/日志归属。
- `sync_operations` 是操作记录/outbox 基础，不等于可直接 WebDAV 或多人协作；在线同步还需要设备、版本、幂等、冲突、认证、权限和加密设计。
- 当前统计数据不足以计算真实“工时/精力占比”，只能先做项目活动量和标签排行；真实工时需要时长或时间区间字段。

### WorkLog Composer UI Findings: 2026-08-24

- 原生 textarea 无法只给部分字符着色，因此采用“不可交互的高亮层 + 透明文字原生 textarea”叠层方案；输入法、光标、选区和键盘行为仍由原生 textarea 负责。
- 高亮层只渲染结构化文本片段，不使用 `dangerouslySetInnerHTML`，避免用户输入被当作 HTML 执行。
- 图片附件和文字格式按钮目前没有对应的数据模型或编辑器能力，先以禁用态呈现，避免用户误以为功能已可用。
- 项目归属按钮仅聚焦现有项目选择控件，继续复用已有项目、仓库和标签保存链路，不改变数据结构。

### Implementation Findings

- SQLite schema version advanced from 11 to 12 with `012_content_search_completion`.
- FTS5 maintenance uses 15 triggers across five entity tables; soft-deleted rows are removed from the index and restored rows are re-indexed by the update trigger.
- Existing Inbox Service manual index writes were removed so the database trigger is the single maintenance path.
- Focused migration/index tests pass in the authorized environment; the default sandbox cannot start Vitest because esbuild returns `spawn EPERM`.
- `SearchService` now uses FTS5 as the first text candidate query and reruns once with parameterized LIKE when FTS has no result; Chinese substring and quoted input regression tests pass.
- The legacy `worklog:search` path now uses the same FTS-first behavior without changing its IPC contract.

### Tags, Rich Text & Project Ownership Findings: 2026-08-24

- Flomo 正文中的 `p`、`br`、`ol`、`ul`、`strong`、`em` 等标签已转换为 Markdown；渲染端使用 `react-markdown`，不启用原始 HTML，避免导入内容执行脚本。
- 标签树按路径段构建，例如 `工作/三峡` 会显示为“工作 → 三峡”；父节点的数量为自身及子标签日志数量之和。
- 标签筛选使用路径前缀匹配，因此选择 `工作` 会包含 `工作/三峡`，但不会误匹配 `工作流`。
- 项目和标签保持正交：日志最多属于一个项目，但可以关联多个层级标签；标签树只改变筛选条件，不会改变项目归属。
- 手动记录中的 `#标签` 继续保留在原文，同时写入标签关联表；旧的 `category` 字段仅作为兼容字段展示和编辑，不再自动从首个标签生成。

### Safe Business Data Clearing Findings: 2026-08-24

- 数据库已有可靠的 SQLite backup API 和完整性校验逻辑，可以在清除前复用，不需要新增备份格式。
- 清除不能直接删除整个数据库文件，否则会同时删除 AI 配置、快捷键和主题等应用设置；当前实现只删除业务数据并保留 workspace/user/settings/schema。
- 外键删除顺序必须先处理日志、任务、报告、收件箱、Git 提交、仓库绑定和各类关联表，再删除项目、仓库和标签。
- FTS5 内容索引有实体删除触发器，但清除流程仍显式清理当前 workspace 的 `content_search`，保证索引不会残留。
- 设置页的精确确认词校验独立成纯函数并覆盖中英文、大小写和额外空格场景。

### Adaptive WorkLog Editing Findings: 2026-08-24

- 编辑框原先固定 `rows={4}`，长日志只能在较小的 textarea 内滚动，导致导入的多段 Markdown 日志编辑体验较差。
- 只依赖 CSS `height: auto` 不足以随内容变化稳定收缩/增长，因此使用 `scrollHeight` 在布局阶段重算。
- 采用 96px 最小高度和 480px 最大高度，避免短日志过小，也避免长日志把时间线页面无限撑高。

### P0-P3 Roadmap Findings: 2026-08-24

- 当前报告生成链路为 `ReportService -> periodReportAi -> aiProvider`，Provider 使用一次性 `fetch` 读取 JSON；报告正文是 Markdown 字符串，不能直接把“完整 JSON 报告”改成 token JSON 流。
- `ReportPage` 的 `reading/git/grouping/generating` 阶段目前通过 260ms、650ms、1200ms 定时器切换；报告快照读取已在 `ReportQueryService` 中完成，Git 阶段应表述为读取已保存 Git 记录，而不是实时扫描仓库。
- 报告生成会先插入 `generating` 记录，再完成或标记 `error`；取消生成时应避免保存半成品，并妥善清理临时 generating 记录，暂不强制新增 `cancelled` 状态迁移。
- Inbox 已有结构化 `ai_suggestion` 字段、校验和确认整理 API，但没有批量 AI 分析任务、并发限制、取消和结果缓存。
- 数据库已有 SQLite backup API、完整性校验、数据包导出/导入和清空前备份；缺少每日备份轮转、备份索引和安全恢复流程。
- `db.ts` 仍包含日志、任务、统计等旧式直接 SQL；项目已有 Repository/Service 分层。当前 SQLite 是 better-sqlite3 单连接，不应设计连接池重构。
- WorkLog 已支持本地图片附件的文件选择、粘贴和拖拽；Flomo 图片附件导入已复用同一存储和受控协议，音视频等不支持格式仍只统计跳过（原结论已由 Phase 29 更新）。
- 当前模型没有工作时长或时间区间字段；统计页只有活动量/频次数据。真实精力统计应使用独立时间记录，不应把日志条数直接解释为工时。
- Git 提交已有 repository/project 维度和标签关联，但没有任务关联表；自动按标题/分支模糊匹配误关联风险高，应先支持显式任务引用和用户确认。
- WorkLog Store 以 50 条分页加载，虚拟滚动不是 P0-P3 的基础依赖；应等真实性能数据后再引入。

### P0-P3 Roadmap Decisions: 2026-08-24

| Priority | Scope | Decision |
|----------|-------|----------|
| P0 | AI 报告真实进度、取消、流式输出 | 先做真实阶段和取消，再做 Provider 流式，分两个可验收增量 |
| P1 | Prompt 预设、Inbox AI 整理、备份轮转恢复 | 直接提升报告和收集箱闭环；所有 AI 建议必须用户确认 |
| P2 | 本地图片附件、db.ts 渐进拆分 | 附件先限定日志；数据库重构不改变现有 IPC 行为 |
| P3 | 时间记录统计、显式 Git-任务关联 | 先建立可信数据模型，再做高级图表和智能建议 |
| Defer | WebDAV/云盘 SQLite 合并、无条件虚拟滚动 | 在线同步需单独的服务端/冲突方案；虚拟滚动由性能数据触发 |
## 2026-08-26 报告范围按钮黑边审计

- “全部项目”与“全部仓库”共用 `ReportPage.tsx` 的 `Picker`，选中态直接使用 `border-zinc-900` / `dark:border-zinc-100`，因此在浅色主题下会显示深色边框；具体项目/仓库被选中时也会复现。
- 当前 UI 系统已将大部分 `bg-zinc-900` 主操作映射为绿色、将普通 `border-zinc-200/300` 映射为语义边框，但没有覆盖 `border-zinc-900`，且报告范围控件没有使用统一语义类，是现有黑边的直接根因。
- 其他页面仍存在少量旧的深色主操作类（报告生成、看板新增/完成、设置保存等），它们的背景已被兼容层转为绿色；需要同时检查深色边框和选中态，避免只修复“全部项目”而留下同类控件。
## 2026-08-26 控件边框审计结论

- 全部项目、全部仓库以及单个项目/仓库选项共用报告范围 Picker；黑边只来自其选中态旧式 `border-zinc-900`，不是全局按钮默认边框。
- 全局搜索未发现 `border-black`、`border-gray-900`、`border-neutral-900` 或 `border-slate-900`；Settings 的主题选中按钮还存在同类 `border-zinc-900`，已纳入本轮统一。
- 报告类型、报告生成、看板新增/完成、设置保存等旧式深色主操作主要是背景类而不是黑色边框；历史兼容映射已将其背景纳入绿色主操作语义，新增兼容规则也会阻止遗留深色边框回落为黑色。
