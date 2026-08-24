# Task Plan: WorkPulse 结构与搜索修正

## Goal

先修正当前项目评审中确认的高影响问题：扩展现有 FTS5 搜索、明确 SQLite 分层边界，并为后续 AI 流式、统计和在线同步保留正确的架构约束。

## Next Step

P0～P3 产品演进方案已完成，等待用户确认后从 P0-A“真实进度与取消”开始实施；本轮仅写方案，未修改业务代码。

## Current Phase

Phase 19

## Phases

### Phase 1: Requirements & Discovery

- [x] 确认导入目标为工作日志
- [x] 确认保留原始时间和标签
- [x] 确认附件暂不导入，只提示数量
- [x] 分析用户提供的 Flomo 导出格式
- **Status:** complete

### Phase 12: WorkLog Card UI

- [x] 日志行改为固定宽度卡片，悬停只改变背景、边框和阴影，不改变 padding 或宽度。
- [x] 时间显示在卡片左上角，右上角固定显示三个点菜单按钮。
- [x] 编辑、删除操作收纳到菜单，保留键盘/鼠标可访问性和删除二次确认。
- [x] 恢复 Markdown 有序列表编号和无序列表标记，避免展示端样式重置导致内容不完整。
- [x] 完成卡片布局回归测试、类型检查、全量测试和生产构建。
- **Status:** complete

### Phase 13: AI API Connection Test

- [x] 确认测试使用当前表单配置，不保存测试值、不发送工作日志。
- [x] 为 OpenAI、Anthropic、DeepSeek 增加统一最小探测请求、10 秒超时和错误脱敏。
- [x] 增加 AI IPC、preload 类型契约和设置页测试连接按钮。
- [x] 增加 Provider、IPC、preload 和设置页回归测试。
- [x] 完成类型检查、全量测试、生产构建和差异检查。
- **Status:** complete

### Phase 2: Planning & Structure

- [x] 写入设计文档
- [x] 写入实施计划
- [x] 确定不新增数据库迁移和依赖
- **Status:** complete

### Phase 3: Implementation

- [x] 新增 Flomo HTML 纯解析器
- [x] 接入主进程日志导入
- [x] 更新 Preload 类型契约
- [x] 更新日志导入 UI 和多语言文案
- **Status:** complete

### Phase 4: Testing & Verification

- [x] 运行 Flomo 解析器和集成测试
- [x] 使用用户提供的 HTML 做只读解析验收
- [x] 运行完整测试、类型检查和构建
- [ ] 运行 Electron 手动导入验收
- **Status:** in_progress

### Phase 5: Delivery

- [x] 更新使用说明
- [x] 记录变更和验证结果
- [x] 向用户交付，保持 Git 工作区不提交
- **Status:** complete

### Phase 6: Architecture & Search Corrections

- [x] 核实现有 FTS5、LIKE 查询和数据库文件职责
- [x] 核实报告生成、AI Inbox 和同步操作表的当前边界
- [x] 用户确认本轮设计范围
- [x] 写入并自检修正设计文档
- [x] 编写修正实施计划
- [x] 先写失败测试，再实现统一 FTS5 搜索索引
- [x] 更新架构、性能、同步和统计能力的准确表述
- **Status:** complete

### Phase 7: WorkLog Composer UI

- [x] 先写标签高亮分段测试
- [x] 将单行输入升级为多行原生 textarea
- [x] 增加 # 标签即时高亮和滚动同步层
- [x] 增加标签、列表、项目归属、保存等工具按钮
- [x] 保持 Enter 及所有组合键为输入行为，仅允许点击发送按钮提交
- [x] 保留暂未实现的图片/格式按钮为明确禁用态
- [x] 更新中英文文案和多主题样式
- [x] 完成测试、类型检查和 Electron 构建验证
- **Status:** complete

### Phase 8: Tags, Rich Text & Orthogonal Project Ownership

- [x] 先写标签树、Flomo Markdown 和标签子树筛选回归测试
- [x] 导入 Flomo 时保留段落、列表、粗体、斜体等安全 Markdown
- [x] 标签列表返回工作日志使用次数并在界面构建多级树
- [x] 支持按标签及其子标签筛选日志
- [x] 保留正文中的 #标签，不再自动挪入 legacy category 字段
- [x] 日志同时展示项目归属和标签归属，项目与标签保持独立
- [x] 完成类型检查、全量测试和生产构建验证
- **Status:** complete

### Phase 9: Safe Business Data Clearing

- [x] 确认清除范围为业务数据，保留应用设置和数据库结构
- [x] 写入设计文档和实施计划
- [x] 先写失败测试，覆盖备份、事务删除、设置保留和确认词
- [x] 新增数据库清除事务和自动备份
- [x] 新增 `database:clear` IPC/Preload 契约
- [x] 在设置页增加二次确认和中英文文案
- [x] 完成类型检查、全量测试、生产构建和差异检查
- **Status:** complete

### Phase 10: Adaptive WorkLog Editing

- [x] 定位编辑框固定 `rows={4}` 导致长日志显示空间不足
- [x] 先写内容高度边界和 textarea 样式更新测试
- [x] 编辑时自动按内容增长，超过上限后启用内部滚动
- [x] 完成 focused 测试、类型检查和生产构建验证
- **Status:** complete

### Phase 11: WorkLog Editor Window

- [x] 将日志内嵌编辑替换为 Electron 独立窗口，默认 `980×760`，支持调整大小。
- [x] 保留正文、项目、仓库、标签、分类和日期编辑，并复用现有更新 API。
- [x] 增加主窗口刷新、单实例编辑窗口、未保存关闭确认和中英文文案。
- [x] 删除不再使用的内嵌 textarea 自适应 helper。
- [x] 完成 focused 测试、全量测试、类型检查和生产构建。
- **Status:** complete

### Phase 14: Git Repository Management

- [x] 定位扫描分支未回写导致的“未检测分支”问题
- [x] 保存扫描成功后的当前分支，并在仓库路径变更时清空旧分支和扫描游标
- [x] 增加仓库编辑、软删除、IPC/Preload/Store 契约，删除不触碰本地文件
- [x] 将仓库列表改为固定卡片、悬停高亮和右上角编辑/删除菜单
- [x] 完成 Git 服务、IPC、Preload、界面回归测试、类型检查和生产构建
- **Status:** complete

### Phase 15: WorkLog @ 项目快捷归属

- [x] 增加 `@` 触发片段识别和选择后的正文替换纯函数
- [x] 在日志输入框增加项目联想列表，支持名称筛选、上下键、回车选择和 Escape 关闭
- [x] 选择项目后写入现有 `project_id`，未选择的普通 `@内容` 保留在正文
- [x] 增加中英文文案、固定定位菜单样式和输入框回归测试
- [x] 完成全量测试、类型检查、生产构建和差异检查
- **Status:** complete

### Phase 16: 正文标签与项目引用交互

- [x] 日志正文中的 `#标签` 和关联的 `@项目` 保留文本并高亮为可点击引用
- [x] 点击标签和项目使用正交筛选，项目参数贯通 DB、IPC、Preload 和 Store
- [x] 项目联想选择后保留规范化的 `@项目名`，同时保存 `project_id`
- [x] Flomo 导入保留独立标签行、行内标签、Markdown 格式和原始时间
- [x] 完成全量测试 32 个文件、164 个测试，类型检查、生产构建和差异检查
- **Status:** complete

### Phase 17: 标签联想与无内容标签清理

- [x] 先写 `#` 层级标签联想和标签清理失败测试
- [x] 输入框复用 `@` 菜单交互，按完整层级路径筛选和替换 `#标签路径`
- [x] 标签正文保留引用，候选菜单支持鼠标、上下键、回车和 Escape
- [x] 日志、任务及跨内容关联清理不再使用的标签和空父标签
- [x] 软删除标签被重新使用时自动恢复，标签使用计数覆盖五类内容
- [x] 完成定向测试、全量测试、类型检查、生产构建和差异检查
- **Status:** complete

### Phase 18: 主窗口尺寸记忆

- [x] 设计仅持久化主窗口宽度和高度，编辑子窗口继续自适应
- [x] 复用 settings 表保存主窗口尺寸，不新增迁移、IPC 或依赖
- [x] 启动时恢复合法尺寸，非法或过小尺寸回退到 `800×600` / `400×500`
- [x] 关闭时保存 normal bounds，最大化/全屏不覆盖普通窗口尺寸
- [x] 完成定向测试、全量测试、类型检查、生产构建和差异检查
- **Status:** complete

### Phase 19: P0-P3 产品演进方案

- [x] 核对当前报告、Inbox、备份、db.ts、附件、工时和 Git 关联现状
- [x] 明确 P0 AI 报告拆分为真实进度/取消与流式输出
- [x] 明确 P1 Prompt 预设、Inbox AI 整理、备份轮转恢复
- [x] 明确 P2 本地附件和渐进式 db.ts 分层治理
- [x] 明确 P3 时间记录统计和显式 Git-任务关联
- [x] 写入实施方案、验收标准和依赖关系
- **Status:** complete

## Key Questions

1. Flomo 导入后的目标是否为工作日志？已确认：是。
2. 是否复制附件？已确认：否，只提示未导入数量。

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| 扩展现有“导入日志”入口 | 减少 UI 和 IPC 变化，用户无需学习新流程 |
| Flomo HTML 使用独立纯解析器 | 易测试、不依赖 DOM、不执行导出 HTML 中的脚本 |
| 复用 `addWorkLog` | 自动获得 workspace、标签、同步 outbox 和现有时间转换行为 |
| 不新增附件表 | 用户明确选择暂不导入附件，避免扩大范围 |
| 不新增 npm 依赖 | 当前导出格式固定且功能范围较小 |

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| npm 12 拒绝 `electron_mirror` 配置 | 1 | 已改用 `ELECTRON_MIRROR` 环境变量；与本功能无关 |
| Vitest 启动 esbuild 时 `spawn EPERM` | 1 | 当前沙箱限制；使用授权环境重跑，不修改测试或业务代码 |
| TypeScript 不允许直接遍历 `matchAll()` 迭代器 | 1 | 改用 `RegExp.exec()` 迭代，保持旧编译目标兼容 |

## Notes

- 用户提供的导出目录包含 `orzlk的笔记.html`、约 85 条 memo 和 6 个 PNG 附件。
- 不执行 `git add`、`git commit` 或 `git push`。
- 工作区已有用户未跟踪目录 `pic/`，与本任务无关，保持不变。
- 当前代码已存在 `content_search` FTS5 表；schema version 12 已覆盖日志、任务、Inbox、Git 提交和报告，并通过触发器维护。
- 当前 SQLite 使用单连接，不应将 `db.ts` 描述为连接池；跨表事务和同步 outbox 仍应由 Service 层协调。
