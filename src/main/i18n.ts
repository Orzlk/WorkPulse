import { app } from 'electron'
import { getSetting } from './db'

export type AppLanguage = 'system' | 'zh' | 'en'
export type ResolvedLanguage = 'zh' | 'en'

const translations = {
  zh: {
    create: '创建',
    newLog: '新建日志',
    newTask: '新建任务',
    navigation: '导航',
    logs: '日志',
    inbox: '收件箱',
    board: '看板',
    projects: '项目',
    repositories: '仓库',
    reports: '报告',
    stats: '统计',
    settings: '设置',
    edit: '编辑',
    window: '窗口',
    showApp: '显示 WorkPulse',
    quit: '退出',
    noWorkLogsInRange: '所选时间段内没有工作记录',
    noLogsToExport: '没有日志可导出',
    exportLogsTitle: '导出工作日志',
    exportReportTitle: '导出报告',
    exportDatabaseTitle: '导出 WorkPulse 数据',
    importDatabaseTitle: '导入 WorkPulse 数据',
    databasePackageFilter: 'WorkPulse 数据包',
    exportDatabaseArchiveTitle: '导出 WorkPulse 完整归档',
    importDatabaseArchiveTitle: '导入 WorkPulse 完整归档',
    databaseArchiveFilter: 'WorkPulse 完整归档',
    csvHeader: '时间,分类,内容\n',
    markdownLogsTitle: '# WorkPulse 工作日志',
    apiKeyMissing: 'API Key 未配置',
    openAiError: 'OpenAI API 错误',
    anthropicError: 'Anthropic API 错误',
    noGeneratedContent: '生成失败：无内容返回',
    taskTodo: '待办',
    taskInProgress: '进行中',
    taskDone: '已完成',
    taskDraft: '草稿',
    taskDue: '截止 {{date}}',
    taskCompletedAt: '完成于 {{date}}',
    continueEditing: '继续编辑',
    discardChanges: '放弃修改',
    unsavedWorkLogTitle: '未保存的日志',
    unsavedWorkLogMessage: '当前日志还有未保存的修改。',
    unsavedWorkLogDetail: '关闭窗口将丢失这些修改。',
    unsavedTaskCreateTitle: '未保存的新任务',
    unsavedTaskCreateMessage: '当前新任务还有未保存的修改。',
    unsavedTaskCreateDetail: '关闭窗口将丢失这些修改。',
    reportUserMessage: '以下是统计周期内的工作日志和任务记录，请按项目或主题归纳并生成适合团队汇报的工作总结：\n\n{{logs}}{{tasks}}\n\n严格参考以下格式模板输出；只保留有证据支持的内容：\n{{template}}',
    taskContextTitle: '\n\n相关任务上下文：\n{{tasks}}'
  },
  en: {
    create: 'Create',
    newLog: 'New Log',
    newTask: 'New Task',
    navigation: 'Navigate',
    logs: 'Logs',
    inbox: 'Inbox',
    board: 'Board',
    projects: 'Projects',
    repositories: 'Repositories',
    reports: 'Reports',
    stats: 'Stats',
    settings: 'Settings',
    edit: 'Edit',
    window: 'Window',
    showApp: 'Show WorkPulse',
    quit: 'Quit',
    noWorkLogsInRange: 'No work logs in the selected date range',
    noLogsToExport: 'No logs to export',
    exportLogsTitle: 'Export work logs',
    exportReportTitle: 'Export report',
    exportDatabaseTitle: 'Export WorkPulse data',
    importDatabaseTitle: 'Import WorkPulse data',
    databasePackageFilter: 'WorkPulse data package',
    exportDatabaseArchiveTitle: 'Export WorkPulse archive',
    importDatabaseArchiveTitle: 'Import WorkPulse archive',
    databaseArchiveFilter: 'WorkPulse archive',
    csvHeader: 'Time,Category,Content\n',
    markdownLogsTitle: '# WorkPulse Work Logs',
    apiKeyMissing: 'API key is not configured',
    openAiError: 'OpenAI API error',
    anthropicError: 'Anthropic API error',
    noGeneratedContent: 'Generation failed: empty response',
    taskTodo: 'Todo',
    taskInProgress: 'In Progress',
    taskDone: 'Done',
    taskDraft: 'Draft',
    taskDue: 'due {{date}}',
    taskCompletedAt: 'completed {{date}}',
    continueEditing: 'Continue editing',
    discardChanges: 'Discard changes',
    unsavedWorkLogTitle: 'Unsaved work log',
    unsavedWorkLogMessage: 'This work log has unsaved changes.',
    unsavedWorkLogDetail: 'Closing the window will discard these changes.',
    unsavedTaskCreateTitle: 'Unsaved task',
    unsavedTaskCreateMessage: 'This new task has unsaved changes.',
    unsavedTaskCreateDetail: 'Closing the window will discard these changes.',
    reportUserMessage: 'Here are the work logs and task records for the reporting period. Group them by project or topic and generate a team-ready work report:\n\n{{logs}}{{tasks}}\n\nFollow this output template and include only evidence-based content:\n{{template}}',
    taskContextTitle: '\n\nRelated task context:\n{{tasks}}'
  }
} as const

type MainTranslationKey = keyof typeof translations.zh

export function resolveSystemLanguage(language: string): ResolvedLanguage {
  return language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function getConfiguredLanguage(): AppLanguage {
  const saved = getSetting('app_language')
  return saved === 'zh' || saved === 'en' || saved === 'system' ? saved : 'system'
}

export function getResolvedLanguage(): ResolvedLanguage {
  const configured = getConfiguredLanguage()
  return configured === 'system' ? resolveSystemLanguage(app.getLocale()) : configured
}

export function tMain(
  key: MainTranslationKey,
  values: Record<string, string | number> = {}
): string {
  const template = translations[getResolvedLanguage()][key] ?? translations.en[key]
  return template.replace(/\{\{(\w+)\}\}/g, (_, token) => String(values[token] ?? ''))
}
