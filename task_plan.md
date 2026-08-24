# Task Plan: Flomo HTML 导入

## Goal

将用户提供的 Flomo HTML 导出文件导入 WorkPulse 工作日志，保留原始时间、正文和标签，并提示未导入附件。

## Next Step

使用用户提供的真实 HTML 做只读解析验收，然后运行完整测试和构建。

## Current Phase

Phase 2

## Phases

### Phase 1: Requirements & Discovery

- [x] 确认导入目标为工作日志
- [x] 确认保留原始时间和标签
- [x] 确认附件暂不导入，只提示数量
- [x] 分析用户提供的 Flomo 导出格式
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
| TypeScript 不允许直接遍历 `matchAll()` 迭代器 | 1 | 改用 `Array.from(content.matchAll(...))`，保持旧编译目标兼容 |

## Notes

- 用户提供的导出目录包含 `orzlk的笔记.html`、约 85 条 memo 和 6 个 PNG 附件。
- 不执行 `git add`、`git commit` 或 `git push`。
