import type { InboxState, InboxSuggestion, InboxTarget } from './domain/types'
import type { Pagination } from './repositories/contracts'
import type { ReportRequest } from './reports/reportTypes'
import type { CreateRepositoryInput, UpdateRepositoryInput } from './services/repositoryService'
import { getAiProviderPreset, type AiAuthMode, type AiProtocol, type AiProviderName } from '../shared/aiProviderConfig'
import type { TaskChecklistItem, TaskPriority } from './kanban/kanbanTypes'
import { format, isValid, parseISO } from 'date-fns'
import { DEFAULT_STATS_DAYS, isValidStatsDays } from './lib/stats'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_TAG_NAMES = 50
const MAX_TAG_NAME_LENGTH = 200
export const MAX_TASK_TITLE_LENGTH = 500
const MAX_TASK_DESCRIPTION_LENGTH = 10000
const MAX_WORKLOG_CONTENT_LENGTH = 10000
const MAX_CATEGORY_LENGTH = 200
const MAX_POSITION = 1_000_000
const SETTING_KEYS = new Set([
  'api_key',
  'ai_provider',
  'ai_base_url',
  'ai_model',
  'ai_protocol',
  'ai_auth_mode',
  'ai_custom_headers',
  'report_language',
  'report_style',
  'system_prompt',
  'report_template',
  'report_reminders_enabled',
  'report_reminder_period',
  'shortcut_quick_log',
  'shortcut_quick_task',
  'theme',
  'app_language',
  'git_scan_enabled',
  'git_scan_interval_minutes',
  'main_window_width',
  'main_window_height'
])

export type IpcErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'IMPORT_INVALID'
  | 'IMPORT_TOO_LARGE'
  | 'IMPORT_NOT_READY'
  | 'INTERNAL_ERROR'

export class IpcContractError extends Error {
  constructor(public readonly code: IpcErrorCode, message: string = code) {
    super(`${code}: ${message}`)
    this.name = 'IpcContractError'
  }
}

type ObjectValue = Record<string, unknown>

function object(value: unknown, allowed: readonly string[]): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Expected an object')
  const record = value as ObjectValue
  if (Object.keys(record).some((key) => !allowed.includes(key))) throw invalid('Unknown field')
  return record
}

function string(value: unknown, field: string, options: { allowEmpty?: boolean; max?: number } = {}): string {
  if (typeof value !== 'string') throw invalid(`${field} must be a string`)
  const normalized = value.trim()
  if (!options.allowEmpty && !normalized) throw invalid(`${field} is required`)
  if (options.max && normalized.length > options.max) throw invalid(`${field} is too long`)
  return normalized
}

function optionalString(value: unknown, field: string, max = 2000): string | undefined {
  if (value === undefined) return undefined
  return string(value, field, { allowEmpty: true, max })
}

function nullableId(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return id(value, field)
}

export function invalid(message: string): IpcContractError {
  return new IpcContractError('INVALID_ARGUMENT', message)
}

export function id(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw invalid(`${field} must be a UUID`)
  return value
}

export function integerId(value: unknown, field = 'id'): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw invalid(`${field} must be a positive integer`)
  return value as number
}

export function parseStatsDays(value: unknown): number {
  const days = value === undefined ? DEFAULT_STATS_DAYS : value
  if (!isValidStatsDays(days)) throw invalid('days must be an integer between 1 and 366')
  return days
}

export function parsePagination(value: unknown): Required<Pagination> {
  const input = value === undefined ? {} : object(value, ['limit', 'offset'])
  const limit: unknown = input.limit ?? 50
  const offset: unknown = input.offset ?? 0
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 200) throw invalid('limit must be between 1 and 200')
  if (!Number.isSafeInteger(offset) || (offset as number) < 0) throw invalid('offset must be a non-negative integer')
  return { limit: limit as number, offset: offset as number }
}

export function parseInboxListInput(value: unknown): Required<Pagination> & { state?: InboxState } {
  const input = value === undefined ? {} : object(value, ['limit', 'offset', 'state'])
  const pagination = parsePagination({ limit: input.limit, offset: input.offset })
  if (input.state !== undefined) parseInboxState(input.state)
  return { ...pagination, state: input.state as InboxState | undefined }
}

export function parseReportListInput(value: unknown): Required<Pagination> {
  if (value === undefined) return parsePagination(undefined)
  if (typeof value === 'number') return parsePagination({ limit: value, offset: 0 })
  return parsePagination(value)
}

export function parseTagNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_TAG_NAMES) throw invalid('tag_names is invalid')
  const names = value.map((tag) => {
    if (typeof tag !== 'string') throw invalid('tag_names is invalid')
    // 保留原始大小写作为展示名；小写身份键由数据库层 normalizeTagName 统一生成
    const normalized = tag.replace(/^#/, '').replace(/\s+/g, ' ').trim().split('/').map((segment) => segment.trim()).filter(Boolean).join('/')
    if (!normalized || normalized.length > MAX_TAG_NAME_LENGTH) throw invalid('tag_names is invalid')
    return normalized
  })
  return Array.from(new Set(names))
}

export interface ParsedSearchQuery {
  text?: string
  tag_names?: string[]
  project_id?: string | null
  repository_id?: string | null
  /** Applies to the inbox branch; non-inbox sources intentionally ignore this field. */
  state?: InboxState
  limit: number
  offset: number
}

export interface ParsedWorkItemAssociations {
  projectId?: string | null
  tagNames?: string[]
}

export function parseWorkItemAssociations(value: unknown): ParsedWorkItemAssociations {
  if (value === undefined) return {}
  const input = object(value, ['project_id', 'tag_names'])
  return {
    projectId: nullableId(input.project_id, 'project_id'),
    tagNames: input.tag_names === undefined ? undefined : parseTagNames(input.tag_names)
  }
}

export function parseSearchQueryInput(value: unknown): ParsedSearchQuery {
  const input = object(value, ['text', 'tag_names', 'project_id', 'repository_id', 'state', 'limit', 'offset'])
  const pagination = parsePagination({ limit: input.limit, offset: input.offset })
  if (input.text !== undefined && (typeof input.text !== 'string' || input.text.length > 500)) throw invalid('Search text is invalid')
  if (input.project_id !== undefined && input.project_id !== null) id(input.project_id, 'project id')
  if (input.repository_id !== undefined && input.repository_id !== null) id(input.repository_id, 'repository id')
  if (input.state !== undefined) parseInboxState(input.state)
  return {
    ...pagination,
    text: input.text === undefined ? undefined : (input.text as string).trim(),
    tag_names: input.tag_names === undefined ? undefined : parseTagNames(input.tag_names),
    project_id: input.project_id as string | null | undefined,
    repository_id: input.repository_id as string | null | undefined,
    state: input.state as InboxState | undefined
  }
}

export function parseReportRequest(value: unknown): ReportRequest {
  const input = object(value, ['type', 'anchorDate', 'timeZone', 'projectIds', 'repositoryIds'])
  if (input.type !== 'weekly' && input.type !== 'monthly') throw invalid('report type is invalid')
  const anchorDate = string(input.anchorDate, 'anchorDate', { max: 10 })
  const parsedAnchorDate = parseISO(anchorDate)
  if (!DATE_PATTERN.test(anchorDate) || !isValid(parsedAnchorDate) || format(parsedAnchorDate, 'yyyy-MM-dd') !== anchorDate) {
    throw invalid('anchorDate is invalid')
  }
  const timeZone = string(input.timeZone, 'timeZone', { max: 100 })
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format()
  } catch {
    throw invalid('timeZone is invalid')
  }
  return {
    type: input.type,
    anchorDate,
    timeZone,
    projectIds: parseIds(input.projectIds, 'projectIds'),
    repositoryIds: parseIds(input.repositoryIds, 'repositoryIds')
  }
}

function parseIds(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 100) throw invalid(`${field} is invalid`)
  return Array.from(new Set(value.map((item) => id(item, field))))
}

export function parseRepositoryCreateInput(value: unknown): CreateRepositoryInput {
  const input = object(value, ['name', 'local_path', 'remote_url', 'project_id', 'enabled', 'scan_interval_minutes'])
  const enabled = input.enabled === undefined ? undefined : input.enabled
  if (enabled !== undefined && typeof enabled !== 'boolean') throw invalid('enabled must be a boolean')
  const interval = input.scan_interval_minutes
  if (interval !== undefined && interval !== null && (!Number.isSafeInteger(interval) || (interval as number) < 1 || (interval as number) > 24 * 60)) {
    throw invalid('scan_interval_minutes is invalid')
  }
  return {
    name: string(input.name, 'name', { max: 200 }),
    local_path: string(input.local_path, 'local_path', { max: 4096 }),
    remote_url: optionalString(input.remote_url, 'remote_url', 2048),
    project_id: nullableId(input.project_id, 'project_id'),
    enabled: enabled as boolean | undefined,
    scan_interval_minutes: interval as number | null | undefined
  }
}

export function parseRepositoryUpdateInput(value: unknown): UpdateRepositoryInput {
  const input = object(value, ['name', 'local_path', 'remote_url', 'project_id', 'enabled', 'scan_interval_minutes'])
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw invalid('enabled must be a boolean')
  const interval = input.scan_interval_minutes
  if (interval !== undefined && interval !== null && (!Number.isSafeInteger(interval) || (interval as number) < 1 || (interval as number) > 24 * 60)) {
    throw invalid('scan_interval_minutes is invalid')
  }
  if (input.name === undefined && input.local_path === undefined && input.remote_url === undefined && input.project_id === undefined && input.enabled === undefined && input.scan_interval_minutes === undefined) {
    throw invalid('No repository fields to update')
  }
  const remoteUrl = input.remote_url === null ? null : optionalString(input.remote_url, 'remote_url', 2048)
  return {
    name: input.name === undefined ? undefined : string(input.name, 'name', { max: 200 }),
    local_path: input.local_path === undefined ? undefined : string(input.local_path, 'local_path', { max: 4096 }),
    remote_url: remoteUrl,
    project_id: nullableId(input.project_id, 'project_id'),
    enabled: input.enabled as boolean | undefined,
    scan_interval_minutes: interval as number | null | undefined
  }
}

export interface ParsedAiConnectionTestInput {
  provider: AiProviderName
  api_key: string
  base_url: string
  model: string
  protocol: AiProtocol
  auth_mode: AiAuthMode
  custom_headers: Record<string, string>
}

export function parseAiConnectionTestInput(value: unknown): ParsedAiConnectionTestInput {
  const input = object(value, ['provider', 'api_key', 'base_url', 'model', 'protocol', 'auth_mode', 'custom_headers'])
  const provider = input.provider as string
  const preset = getAiProviderPreset(provider)
  if (!preset) throw invalid('provider is invalid')
  const protocol = input.protocol === undefined ? preset.protocol : input.protocol
  if (protocol !== 'openai-chat' && protocol !== 'openai-responses' && protocol !== 'anthropic-messages') throw invalid('protocol is invalid')
  const authMode = input.auth_mode === undefined ? preset.authMode : input.auth_mode
  if (authMode !== 'bearer' && authMode !== 'x-api-key' && authMode !== 'none') throw invalid('auth_mode is invalid')
  const apiKey = string(input.api_key, 'api_key', { allowEmpty: true, max: 4096 })
  if (authMode !== 'none' && !apiKey) throw invalid('api_key is required')
  const customHeaders = parseCustomHeaders(input.custom_headers)
  return {
    provider: provider as AiProviderName,
    api_key: apiKey,
    base_url: optionalString(input.base_url, 'base_url', 2048) ?? '',
    model: optionalString(input.model, 'model', 200) ?? '',
    protocol,
    auth_mode: authMode,
    custom_headers: customHeaders
  }
}

export interface ParsedAiModelListInput {
  provider: AiProviderName
  api_key: string
  base_url: string
  protocol: AiProtocol
  auth_mode: AiAuthMode
  custom_headers: Record<string, string>
}

export function parseAiModelListInput(value: unknown): ParsedAiModelListInput {
  const input = object(value, ['provider', 'api_key', 'base_url', 'protocol', 'auth_mode', 'custom_headers'])
  const provider = input.provider as string
  const preset = getAiProviderPreset(provider)
  if (!preset) throw invalid('provider is invalid')
  const protocol = input.protocol === undefined ? preset.protocol : input.protocol
  if (protocol !== 'openai-chat' && protocol !== 'openai-responses' && protocol !== 'anthropic-messages') throw invalid('protocol is invalid')
  const authMode = input.auth_mode === undefined ? preset.authMode : input.auth_mode
  if (authMode !== 'bearer' && authMode !== 'x-api-key' && authMode !== 'none') throw invalid('auth_mode is invalid')
  const apiKey = input.api_key === undefined ? '' : string(input.api_key, 'api_key', { allowEmpty: true, max: 4096 })
  if (authMode !== 'none' && !apiKey) throw invalid('api_key is required')
  return {
    provider: provider as AiProviderName,
    api_key: apiKey,
    base_url: optionalString(input.base_url, 'base_url', 2048) ?? '',
    protocol,
    auth_mode: authMode,
    custom_headers: parseCustomHeaders(input.custom_headers)
  }
}

function parseCustomHeaders(value: unknown): Record<string, string> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('custom_headers is invalid')
  const entries = Object.entries(value)
  if (entries.length > 20) throw invalid('too many custom headers')
  const headers: Record<string, string> = {}
  for (const [name, headerValue] of entries) {
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || name.length > 100) throw invalid('custom header name is invalid')
    if (/^(authorization|x-api-key|content-type|x-opencode-session|user-agent)$/i.test(name)) throw invalid('custom header is reserved')
    if (typeof headerValue !== 'string' || headerValue.length > 2000) throw invalid('custom header value is invalid')
    headers[name] = headerValue
  }
  return headers
}

export function parseAiCustomHeadersSetting(value: string): Record<string, string> {
  try {
    return parseCustomHeaders(JSON.parse(value))
  } catch {
    throw invalid('custom headers are invalid')
  }
}

export interface ParsedInboxAiInput {
  public_ids?: string[]
  limit: number
}

export function parseInboxAiInput(value: unknown): ParsedInboxAiInput {
  const input = value === undefined ? {} : object(value, ['public_ids', 'limit'])
  const publicIds = input.public_ids === undefined ? undefined : (() => {
    if (!Array.isArray(input.public_ids) || input.public_ids.length > 20) throw invalid('public_ids is invalid')
    return Array.from(new Set(input.public_ids.map((item) => id(item, 'public_id'))))
  })()
  const limit = input.limit === undefined ? 20 : input.limit
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 20) throw invalid('limit must be between 1 and 20')
  return { public_ids: publicIds, limit: limit as number }
}

export interface ParsedAttachmentInput {
  fileName: string
  mimeType: string
  data: ArrayBuffer | Uint8Array
}

export function parseAttachmentInput(value: unknown): ParsedAttachmentInput {
  const input = object(value, ['fileName', 'mimeType', 'data'])
  if (typeof input.data === 'string' || (!(input.data instanceof ArrayBuffer) && !ArrayBuffer.isView(input.data))) {
    throw invalid('data is invalid')
  }
  return {
    fileName: string(input.fileName, 'fileName', { max: 255 }),
    mimeType: string(input.mimeType, 'mimeType', { max: 120 }),
    data: input.data as ArrayBuffer | Uint8Array
  }
}

export function parseProjectInput(value: unknown, partial = false): { name?: string; description?: string; color?: string } {
  const input = object(value, ['name', 'description', 'color'])
  if (!partial && input.name === undefined) throw invalid('name is required')
  const result = {
    name: input.name === undefined ? undefined : string(input.name, 'name', { max: 200 }),
    description: optionalString(input.description, 'description', 4000),
    color: optionalString(input.color, 'color', 32)
  }
  if (partial && Object.values(result).every((item) => item === undefined)) throw invalid('No fields to update')
  return result
}

export function parseInboxInput(value: unknown): {
  content?: string
  project_id?: string | null
  tag_names?: string[]
  include_in_reports?: boolean
  ai_suggestion?: InboxSuggestion | null
} {
  const input = object(value, ['content', 'project_id', 'tag_names', 'include_in_reports', 'ai_suggestion'])
  const tags = input.tag_names === undefined ? undefined : input.tag_names
  if (tags !== undefined && (!Array.isArray(tags) || tags.length > 50 || tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 200))) {
    throw invalid('tag_names is invalid')
  }
  if (input.include_in_reports !== undefined && typeof input.include_in_reports !== 'boolean') throw invalid('include_in_reports must be a boolean')
  return {
    content: input.content === undefined ? undefined : string(input.content, 'content', { max: 10000 }),
    project_id: nullableId(input.project_id, 'project_id'),
    tag_names: tags as string[] | undefined,
    include_in_reports: input.include_in_reports as boolean | undefined,
    ai_suggestion: parseSuggestion(input.ai_suggestion)
  }
}

export interface ParsedWorkLogCreateArgs {
  content: string
  category: string
  associations: ParsedWorkItemAssociations
}

export function parseWorkLogCreateArgs(value: unknown): ParsedWorkLogCreateArgs {
  const input = object(value, ['content', 'category', 'associations'])
  return {
    content: string(input.content, 'content', { max: MAX_WORKLOG_CONTENT_LENGTH }),
    category: input.category === undefined ? '' : string(input.category, 'category', { allowEmpty: true, max: MAX_CATEGORY_LENGTH }),
    associations: parseWorkItemAssociations(input.associations)
  }
}

export interface ParsedWorkLogUpdateArgs extends ParsedWorkLogCreateArgs {
  id: number
  created_at?: string
}

export function parseWorkLogUpdateArgs(value: unknown): ParsedWorkLogUpdateArgs {
  const input = object(value, ['id', 'content', 'category', 'created_at', 'associations'])
  return {
    id: integerId(input.id, 'worklog id'),
    content: string(input.content, 'content', { max: MAX_WORKLOG_CONTENT_LENGTH }),
    category: input.category === undefined ? '' : string(input.category, 'category', { allowEmpty: true, max: MAX_CATEGORY_LENGTH }),
    created_at: input.created_at === undefined ? undefined : parseTimestamp(input.created_at, 'created_at'),
    associations: parseWorkItemAssociations(input.associations)
  }
}

interface ParsedChecklistItem extends TaskChecklistItem {}

function parseChecklistInput(value: unknown): ParsedChecklistItem[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 100) throw invalid('checklist is invalid')
  return value.map((item, index) => {
    const entry = object(item, ['id', 'text', 'completed'])
    const idValue = entry.id === undefined ? `item-${index + 1}` : string(entry.id, 'checklist id', { max: 100 })
    if (entry.completed !== undefined && typeof entry.completed !== 'boolean') throw invalid('checklist completed is invalid')
    return {
      id: idValue,
      text: string(entry.text, 'checklist text', { max: 500 }),
      completed: entry.completed ?? false
    }
  })
}

function parseTaskStatus(value: unknown): 'todo' | 'in_progress' | 'done' | 'draft' {
  if (!['todo', 'in_progress', 'done', 'draft'].includes(value as string)) throw invalid('task status is invalid')
  return value as 'todo' | 'in_progress' | 'done' | 'draft'
}

function parseTaskPriority(value: unknown): TaskPriority {
  if (!['low', 'medium', 'high'].includes(value as string)) throw invalid('task priority is invalid')
  return value as TaskPriority
}

function parseTimestamp(value: unknown, field: string): string {
  const parsed = string(value, field, { max: 40 })
  const date = new Date(parsed)
  if (!Number.isFinite(date.getTime())) throw invalid(`${field} is invalid`)
  return parsed
}

export interface ParsedTaskCreateArgs {
  title: string
  description: string
  status: 'todo' | 'draft'
  createdAt?: string
  associations: ParsedWorkItemAssociations
  priority: TaskPriority
  dueDate: string | null | undefined
  checklist: ParsedChecklistItem[]
}

export function parseTaskCreateArgs(value: unknown): ParsedTaskCreateArgs {
  const input = object(value, ['title', 'description', 'status', 'createdAt', 'associations', 'priority', 'dueDate', 'checklist'])
  const status = input.status === undefined ? 'todo' : parseTaskStatus(input.status)
  if (status !== 'todo' && status !== 'draft') throw invalid('task create status is invalid')
  return {
    title: string(input.title, 'title', { max: MAX_TASK_TITLE_LENGTH }),
    description: input.description === undefined ? '' : string(input.description, 'description', { allowEmpty: true, max: MAX_TASK_DESCRIPTION_LENGTH }),
    status,
    createdAt: input.createdAt === undefined ? undefined : parseTimestamp(input.createdAt, 'createdAt'),
    associations: parseWorkItemAssociations(input.associations),
    priority: input.priority === undefined ? 'medium' : parseTaskPriority(input.priority),
    dueDate: input.dueDate === null || input.dueDate === undefined ? input.dueDate as string | null | undefined : parseDateOnly(input.dueDate, 'dueDate'),
    checklist: parseChecklistInput(input.checklist)
  }
}

export interface ParsedTaskUpdates {
  title?: string
  description?: string
  status?: 'todo' | 'in_progress' | 'done' | 'draft'
  board_column?: string
  position?: number
  due_date?: string | null
  priority?: TaskPriority
  checklist?: ParsedChecklistItem[]
  project_id?: string | null
  tag_names?: string[]
}

export interface ParsedTaskUpdateArgs {
  id: number
  updates: ParsedTaskUpdates
}

export function parseTaskUpdateArgs(value: unknown): ParsedTaskUpdateArgs {
  const input = object(value, ['id', 'updates'])
  const updates = object(input.updates, ['title', 'description', 'status', 'board_column', 'position', 'due_date', 'priority', 'checklist', 'project_id', 'tag_names'])
  const parsed: ParsedTaskUpdates = {}
  if (updates.title !== undefined) parsed.title = string(updates.title, 'title', { max: MAX_TASK_TITLE_LENGTH })
  if (updates.description !== undefined) parsed.description = string(updates.description, 'description', { allowEmpty: true, max: MAX_TASK_DESCRIPTION_LENGTH })
  if (updates.status !== undefined) parsed.status = parseTaskStatus(updates.status)
  if (updates.board_column !== undefined) parsed.board_column = string(updates.board_column, 'board_column', { max: 100 })
  if (updates.position !== undefined) {
    if (!Number.isSafeInteger(updates.position) || (updates.position as number) < 0 || (updates.position as number) > MAX_POSITION) throw invalid('position is invalid')
    parsed.position = updates.position as number
  }
  if (updates.due_date !== undefined) parsed.due_date = updates.due_date === null ? null : parseDateOnly(updates.due_date, 'due_date')
  if (updates.priority !== undefined) parsed.priority = parseTaskPriority(updates.priority)
  if (updates.checklist !== undefined) parsed.checklist = parseChecklistInput(updates.checklist)
  if (updates.project_id !== undefined) parsed.project_id = nullableId(updates.project_id, 'project_id')
  if (updates.tag_names !== undefined) parsed.tag_names = parseTagNames(updates.tag_names)
  if (Object.keys(parsed).length === 0) throw invalid('No task fields to update')
  return { id: integerId(input.id, 'task id'), updates: parsed }
}

export function parseTaskReorderArgs(value: unknown): {
  taskIds: number[]
  boardColumn: string
  status?: 'todo' | 'in_progress' | 'done' | 'draft'
  sourceBoardColumn?: string
  sourceTaskIds: number[]
  sourceStatus?: 'todo' | 'in_progress' | 'done' | 'draft'
} {
  const input = object(value, ['taskIds', 'boardColumn', 'status', 'sourceBoardColumn', 'sourceTaskIds', 'sourceStatus'])
  const parseIds = (raw: unknown, field: string): number[] => {
    if (raw === undefined) return []
    if (!Array.isArray(raw) || raw.length > 1000) throw invalid(`${field} is invalid`)
    return raw.map((idValue) => integerId(idValue, field))
  }
  return {
    taskIds: parseIds(input.taskIds, 'taskIds'),
    boardColumn: string(input.boardColumn, 'boardColumn', { max: 100 }),
    status: input.status === undefined ? undefined : parseTaskStatus(input.status),
    sourceBoardColumn: input.sourceBoardColumn === undefined ? undefined : string(input.sourceBoardColumn, 'sourceBoardColumn', { max: 100 }),
    sourceTaskIds: parseIds(input.sourceTaskIds, 'sourceTaskIds'),
    sourceStatus: input.sourceStatus === undefined ? undefined : parseTaskStatus(input.sourceStatus)
  }
}

export function parseSettingUpdateArgs(value: unknown): { key: string; value: string } {
  const input = object(value, ['key', 'value'])
  const key = string(input.key, 'setting key', { max: 100 })
  if (!SETTING_KEYS.has(key)) throw invalid('setting key is invalid')
  return { key, value: string(input.value, 'setting value', { allowEmpty: true, max: 10000 }) }
}

export function parseShortcutUpdateArgs(value: unknown): { key: 'shortcut_quick_log' | 'shortcut_quick_task'; value: string } {
  const input = object(value, ['key', 'value'])
  if (input.key !== 'shortcut_quick_log' && input.key !== 'shortcut_quick_task') throw invalid('shortcut key is invalid')
  return { key: input.key, value: string(input.value, 'shortcut value', { max: 200 }) }
}

function parseDateOnly(value: unknown, field: string): string {
  const date = string(value, field, { max: 10 })
  const parsed = parseISO(date)
  if (!DATE_PATTERN.test(date) || !isValid(parsed) || format(parsed, 'yyyy-MM-dd') !== date) throw invalid(`${field} is invalid`)
  return date
}

function parseSuggestion(value: unknown): InboxSuggestion | null | undefined {
  if (value === undefined || value === null) return value
  const input = object(value, ['target', 'title', 'summary', 'project_id', 'tag_names', 'include_in_reports'])
  if (input.target !== 'work_log' && input.target !== 'task' && input.target !== 'ignore') throw invalid('suggestion target is invalid')
  if (!Array.isArray(input.tag_names) || input.tag_names.length > MAX_TAG_NAMES || input.tag_names.some((tag) => typeof tag !== 'string')) throw invalid('suggestion tags are invalid')
  if (typeof input.include_in_reports !== 'boolean') throw invalid('suggestion include_in_reports is invalid')
  return {
    target: input.target,
    title: string(input.title, 'title', { allowEmpty: true, max: 500 }),
    summary: string(input.summary, 'summary', { allowEmpty: true, max: 4000 }),
    project_id: nullableId(input.project_id, 'suggestion.project_id') ?? null,
    tag_names: parseTagNames(input.tag_names),
    include_in_reports: input.include_in_reports
  }
}

export function parseInboxState(value: unknown): InboxState {
  if (!['unorganized', 'confirmed', 'ignored', 'archived'].includes(value as string)) throw invalid('inbox state is invalid')
  return value as InboxState
}

export interface InboxOrganizeInput {
  target: InboxTarget
  project_id?: string | null
  tag_names?: string[]
  title?: string
  include_in_reports?: boolean
}

export function parseInboxOrganizeArgs(value: unknown): InboxOrganizeInput | undefined {
  if (value === undefined || value === null) return undefined
  const input = object(value, ['target', 'project_id', 'tag_names', 'title', 'include_in_reports'])
  if (input.target !== 'work_log' && input.target !== 'task' && input.target !== 'ignore') throw invalid('inbox target is invalid')
  if (input.project_id !== undefined && input.project_id !== null && typeof input.project_id !== 'string') throw invalid('inbox project_id is invalid')
  if (input.tag_names !== undefined && (!Array.isArray(input.tag_names) || input.tag_names.length > MAX_TAG_NAMES || input.tag_names.some((tag) => typeof tag !== 'string'))) throw invalid('inbox tags are invalid')
  if (input.title !== undefined && typeof input.title !== 'string') throw invalid('inbox title is invalid')
  if (input.include_in_reports !== undefined && typeof input.include_in_reports !== 'boolean') throw invalid('inbox include_in_reports is invalid')
  return {
    target: input.target,
    project_id: input.project_id as string | null | undefined,
    tag_names: input.tag_names === undefined ? undefined : parseTagNames(input.tag_names),
    title: input.title === undefined ? undefined : string(input.title, 'inbox title', { allowEmpty: true, max: 500 }),
    include_in_reports: input.include_in_reports as boolean | undefined
  }
}

export function toIpcContractError(error: unknown): IpcContractError {
  if (error instanceof IpcContractError) return error
  if (error instanceof RangeError) return new IpcContractError('INVALID_ARGUMENT', error.message)
  if (error instanceof Error && /not found/i.test(error.message)) return new IpcContractError('NOT_FOUND', error.message)
  return new IpcContractError('INTERNAL_ERROR', 'Internal error')
}
