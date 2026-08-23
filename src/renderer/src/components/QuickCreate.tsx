import { useEffect, useRef, useState } from 'react'
import { ClipboardList, Columns3, Inbox, X } from 'lucide-react'
import { useWorkLogStore } from '../stores/worklogStore'
import { useTaskStore } from '../stores/taskStore'
import { useInboxStore } from '../stores/inboxStore'
import { useProjectStore } from '../stores/projectStore'
import { useRepositoryStore } from '../stores/repositoryStore'
import { useToast } from './Toast'
import { extractHashTags } from '../lib/workspaceInteractions'

type Mode = 'log' | 'task' | 'inbox'
interface Props { initialMode: Mode; onClose: () => void }

const modes: Array<{ id: Mode; label: string; Icon: typeof ClipboardList }> = [
  { id: 'log', label: '日志', Icon: ClipboardList },
  { id: 'task', label: '任务', Icon: Columns3 },
  { id: 'inbox', label: '收件箱', Icon: Inbox }
]

export function QuickCreate({ initialMode, onClose }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [value, setValue] = useState('')
  const [projectId, setProjectId] = useState('')
  const [repositoryId, setRepositoryId] = useState('')
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const inputRef = useRef<HTMLInputElement>(null)
  const addLog = useWorkLogStore((state) => state.addLog)
  const addTask = useTaskStore((state) => state.addTask)
  const addInbox = useInboxStore((state) => state.create)
  const projects = useProjectStore((state) => state.items)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const repositories = useRepositoryStore((state) => state.items)
  const fetchRepositories = useRepositoryStore((state) => state.fetch)
  const toast = useToast()
  const tags = extractHashTags(value).tags

  useEffect(() => { inputRef.current?.focus() }, [mode])
  useEffect(() => { void fetchProjects(); void fetchRepositories() }, [fetchProjects, fetchRepositories])

  const submit = async (): Promise<void> => {
    const content = value.trim()
    if (!content || status === 'running') return
    setStatus('running')
    try {
      if (mode === 'log') await addLog(content, tags[0] ?? '')
      if (mode === 'task') await addTask(content)
      if (mode === 'inbox') await addInbox({ content, project_id: projectId || null, repository_id: repositoryId || null, tag_names: tags, include_in_reports: true, ai_suggestion: null })
      setValue('')
      setStatus('success')
      toast.success(mode === 'inbox' ? '已保存到收件箱' : mode === 'log' ? '日志已保存' : '任务已创建')
      inputRef.current?.focus()
      window.setTimeout(() => setStatus('idle'), 1400)
    } catch {
      setStatus('error')
      toast.error('保存失败，请重试。')
    }
  }

  return <div className="quick-create-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="quick-create-panel" role="dialog" aria-modal="true" aria-label="快速创建" onMouseDown={(event) => event.stopPropagation()}>
      <div className="quick-create-header"><p className="workspace-kicker">QUICK CAPTURE</p><button onClick={onClose} aria-label="关闭快速创建"><X aria-hidden="true" /></button></div>
      <div className="quick-create-tabs" role="tablist" aria-label="创建类型">{modes.map(({ id, label, Icon }) => <button role="tab" aria-selected={mode === id} key={id} onClick={() => setMode(id)}><Icon aria-hidden="true" />{label}</button>)}</div>
      <input ref={inputRef} value={value} disabled={status === 'running'} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submit(); if (event.key === 'Escape') onClose() }} className="quick-create-input" placeholder={mode === 'inbox' ? '记录一个稍后再整理的想法…' : mode === 'task' ? '添加一项任务…' : '记录刚刚完成的工作…'} />
      <div className="quick-create-meta">{tags.length > 0 ? <span>{tags.map((tag) => <i key={tag}>#{tag}</i>)}</span> : <span>输入 #标签 自动归类，原文会完整保留。</span>}</div>
      {mode === 'inbox' && <div className="quick-create-associations"><label>项目<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">未归属</option>{projects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}</select></label><label>仓库<select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}><option value="">未归属</option>{repositories.map((repository) => <option key={repository.public_id} value={repository.public_id}>{repository.name}</option>)}</select></label></div>}
      <footer><span aria-live="polite">{status === 'success' ? '已保存，可继续输入' : status === 'error' ? '保存失败' : 'Enter 保存 · Esc 关闭'}</span><button className="primary-action" onClick={() => void submit()} disabled={!value.trim() || status === 'running'}>{status === 'running' ? '保存中' : '保存'}</button></footer>
    </section>
  </div>
}
