import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInboxStore } from '../../src/renderer/src/stores/inboxStore'
import { useWorkLogStore } from '../../src/renderer/src/stores/worklogStore'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((done) => { resolve = done }), resolve }
}

function inboxItem(public_id: string, state: 'unorganized' | 'confirmed') {
  return {
    public_id,
    content: public_id,
    project_id: null,
    tag_names: [],
    state,
    ai_suggestion: null,
    include_in_reports: true,
    created_at: '2026-09-08T00:00:00.000Z',
    updated_at: '2026-09-08T00:00:00.000Z'
  }
}

function workLog(public_id: string) {
  return { id: Number(public_id.replace(/\D/g, '')) || 1, public_id, content: public_id, category: 'work', created_at: '2026-09-08T00:00:00.000Z', task_id: null, project_id: null, tag_names: [] }
}

describe('store pagination request ownership', () => {
  beforeEach(() => {
    useInboxStore.setState({ items: [], total: 0, nextOffset: 0, pinnedPublicIds: [], status: 'idle', error: null, selectedId: null, filter: 'all' })
    useWorkLogStore.setState({ logs: [], loading: false, error: null, hasMore: true, nextOffset: 0, searchKeyword: '', tagFilter: '', projectFilter: '', lastDeleted: null, deletedLogs: [], pinnedPublicIds: [] })
  })

  it('keeps the latest inbox filter when an older request resolves later', async () => {
    const first = deferred<{ items: ReturnType<typeof inboxItem>[]; total: number }>()
    const second = deferred<{ items: ReturnType<typeof inboxItem>[]; total: number }>()
    const list = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    vi.stubGlobal('window', { api: { inbox: { list } } })

    const older = useInboxStore.getState().fetch('unorganized')
    const newer = useInboxStore.getState().setFilter('confirmed')

    expect(useInboxStore.getState().filter).toBe('confirmed')
    second.resolve({ items: [inboxItem('confirmed-1', 'confirmed')], total: 1 })
    await newer
    first.resolve({ items: [inboxItem('old-1', 'unorganized')], total: 1 })
    await older

    expect(useInboxStore.getState()).toMatchObject({
      filter: 'confirmed',
      total: 1,
      items: [expect.objectContaining({ public_id: 'confirmed-1' })]
    })
  })

  it('does not retain a focused work log as pinned after the next page contains it', async () => {
    const list = vi.fn().mockResolvedValue([workLog('focus-1'), workLog('page-2')])
    vi.stubGlobal('window', { api: { worklog: { get: vi.fn().mockResolvedValue(workLog('focus-1')), list } } })

    await useWorkLogStore.getState().loadByPublicId('focus-1')
    await useWorkLogStore.getState().loadMore()

    const state = useWorkLogStore.getState()
    expect(state.logs.map((log) => log.public_id)).toEqual(['focus-1', 'page-2'])
    expect(state.pinnedPublicIds).not.toContain('focus-1')
  })

  it('keeps an inbox item focused while the initial page is still loading', async () => {
    const page = deferred<{ items: ReturnType<typeof inboxItem>[]; total: number }>()
    vi.stubGlobal('window', {
      api: {
        inbox: {
          get: vi.fn().mockResolvedValue(inboxItem('focus-2', 'unorganized')),
          list: vi.fn().mockReturnValue(page.promise)
        }
      }
    })

    const fetching = useInboxStore.getState().fetch('all')
    await useInboxStore.getState().loadByPublicId('focus-2')
    page.resolve({ items: [inboxItem('page-1', 'unorganized')], total: 2 })
    await fetching

    expect(useInboxStore.getState()).toMatchObject({
      items: [expect.objectContaining({ public_id: 'focus-2' }), expect.objectContaining({ public_id: 'page-1' })],
      total: 2,
      nextOffset: 1,
      pinnedPublicIds: ['focus-2'],
      status: 'success'
    })
  })

  it('keeps a work log focused while the initial page is still loading', async () => {
    const page = deferred<ReturnType<typeof workLog>[]>()
    vi.stubGlobal('window', {
      api: {
        worklog: {
          get: vi.fn().mockResolvedValue(workLog('focus-2')),
          list: vi.fn().mockReturnValue(page.promise)
        }
      }
    })

    const fetching = useWorkLogStore.getState().fetchLogs()
    await useWorkLogStore.getState().loadByPublicId('focus-2')
    page.resolve([workLog('page-1')])
    await fetching

    expect(useWorkLogStore.getState()).toMatchObject({
      logs: [expect.objectContaining({ public_id: 'focus-2' }), expect.objectContaining({ public_id: 'page-1' })],
      nextOffset: 1,
      pinnedPublicIds: ['focus-2'],
      loading: false
    })
  })
})
