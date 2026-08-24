# WorkPulse Flomo HTML 导入设计

## 目标

支持将 Flomo 导出的 HTML 笔记导入 WorkPulse 工作日志，保留原始记录时间、正文和 `#标签`，并复用现有日志搜索、统计、周报/月报和重复检测能力。

## 已确认范围

- 导入目标：工作日志，不进入收件箱。
- 输入格式：Flomo HTML 导出文件，例如 `orzlk的笔记.html`。
- 时间：保留 Flomo 的 `YYYY-MM-DD HH:mm:ss` 原始本地时间，交给现有日志写入逻辑转换为 UTC 存储。
- 标签：识别正文中的 `#标签`，写入 WorkPulse 标签关联；正文中仅独占首行的标签行不重复保留。
- 正文：保留文本内容和列表层次；HTML 样式转换为纯文本，不引入 Markdown 渲染或富文本字段。
- 重复：按导入后的正文、分类和原始日期判断，重复记录跳过。
- 附件：不复制、不入库，只统计 Flomo 导出中发现的附件并在导入结果中提示未导入数量。
- 入口：扩展现有“日志 → 导入”按钮，不新增独立向导。

## 输入解析

Flomo 导出结构包含多个 `.memo` 节点，每个节点包括：

```html
<div class="memo">
  <div class="time">2026-08-19 09:45:51</div>
  <div class="content">
    <p>#工作/三峡</p>
    <ol><li><p>事项</p></li></ol>
  </div>
  <div class="files"><img src="file/.../image.png"></div>
</div>
```

新增纯解析模块 `src/main/importers/flomoHtmlImporter.ts`，不依赖 DOM 或外部 HTML 包：

1. 按 `.memo` 边界提取笔记块。
2. 提取并校验 `.time`。
3. 将 `.content` 转成纯文本：`br`、段落和列表项转换为换行，列表项保留 `- ` 前缀，其他标签剥离。
4. 解码常见 HTML 实体，并规范化空白和换行。
5. 提取 `#` 标签，支持包含 `/` 的层级标签；只移除独占首行的标签行，正文中的标签文本保留。
6. 统计每个 memo 的附件节点，不读取附件内容。

解析器输出纯数据，不直接访问数据库：

```ts
export interface FlomoMemo {
  createdAt: string
  content: string
  tagNames: string[]
  attachmentCount: number
}

export interface FlomoImportParseResult {
  memos: FlomoMemo[]
  attachmentCount: number
}

export function parseFlomoHtml(html: string): FlomoImportParseResult
```

## 导入流程

现有 `import:logs` IPC handler 增加 `html` 分支：

1. 文件选择器增加 HTML 文件类型，仍允许 CSV 和 Markdown。
2. 识别为 Flomo HTML 后调用解析器；没有有效 memo 时返回明确错误。
3. 按时间顺序逐条调用现有 `addWorkLog(content, '', null, createdAt, { tagNames })`。
4. 通过现有 `workLogExists` 跳过重复记录。
5. 返回 `source: 'flomo'`、导入数量、跳过数量、附件未导入数量和文件路径。

这样可以复用现有的 workspace、用户、标签创建、同步 outbox 和事务行为，不新增迁移。

## UI 反馈

导入按钮保留在日志页面。文件选择器提示支持 CSV、Markdown 和 Flomo HTML。导入完成后：

- 普通格式保持现有成功/重复提示。
- Flomo 导入额外显示“Flomo 日志导入数量”和“附件未导入数量”。
- 解析失败、无有效 memo 或文件读取失败通过现有错误提示展示，不写入半条记录。

## 安全与边界

- 只读取用户主动选择的 HTML 文件，不自动扫描用户目录。
- 不执行 HTML 中的脚本，不加载远程资源，不复制附件。
- 单条缺失时间或正文的 memo 跳过并计入跳过数量；解析器仍继续处理其他 memo。
- 不修改原始 Flomo 文件。

## 测试策略

- 解析器单元测试：多个 memo、原始时间、标签提取、列表转换、HTML 实体、附件统计、无效 memo。
- 导入逻辑测试：重复记录跳过、标签关联通过现有日志写入逻辑创建、附件数量返回。
- 回归验证：完整 Vitest、Node/Web 类型检查、Electron 构建和 diff 检查。

## 非目标

- 不导入图片、音频或其他附件。
- 不新增富文本编辑器或附件表。
- 不增加独立导入预览向导。
- 不改变现有 CSV/Markdown 导入行为。
