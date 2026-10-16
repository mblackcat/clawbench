import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useTaskStore, ERROR_ALERT_DURATION_MS } from '../useTaskStore'

describe('useTaskStore error alert & unread logs', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useTaskStore.setState({
      tasks: {},
      activeTaskId: null,
      systemLogs: [],
      hasUnseenErrors: false,
      hasUnreadLogs: false,
      hasErrorAlert: false,
      errorAlertSummary: null
    })
  })

  afterEach(() => {
    useTaskStore.getState().dismissErrorAlert()
    vi.useRealTimers()
  })

  it('triggers error alert on failed status and auto-dismisses after timeout', () => {
    const store = useTaskStore.getState()
    store.startTask('task-1', 'app-1', 'Test App')
    expect(useTaskStore.getState().hasErrorAlert).toBe(false)

    store.updateStatus('task-1', 'failed', { success: false, summary: 'Process crashed' })
    expect(useTaskStore.getState().hasErrorAlert).toBe(true)
    expect(useTaskStore.getState().errorAlertSummary).toBe('Process crashed')

    vi.advanceTimersByTime(ERROR_ALERT_DURATION_MS - 1000)
    expect(useTaskStore.getState().hasErrorAlert).toBe(true)

    vi.advanceTimersByTime(1001)
    expect(useTaskStore.getState().hasErrorAlert).toBe(false)
    expect(useTaskStore.getState().errorAlertSummary).toBe(null)
  })

  it('keeps the OSS hasUnseenErrors badge independent of the transient alert', () => {
    const store = useTaskStore.getState()
    store.startTask('task-1', 'app-1', 'Test App')
    store.updateStatus('task-1', 'failed', { success: false, summary: 'boom' })
    vi.advanceTimersByTime(ERROR_ALERT_DURATION_MS + 1)
    expect(useTaskStore.getState().hasErrorAlert).toBe(false)
    expect(useTaskStore.getState().hasUnseenErrors).toBe(true)
    store.markErrorsSeen()
    expect(useTaskStore.getState().hasUnseenErrors).toBe(false)
  })

  it('triggers error alert on error output and dismisses manually', () => {
    const store = useTaskStore.getState()
    store.startTask('task-2', 'app-2', 'Test App 2')
    store.updateOutput('task-2', {
      taskId: 'task-2',
      type: 'error',
      message: 'SyntaxError in script',
      timestamp: Date.now()
    })
    expect(useTaskStore.getState().hasErrorAlert).toBe(true)
    expect(useTaskStore.getState().errorAlertSummary).toBe('SyntaxError in script')

    store.dismissErrorAlert()
    expect(useTaskStore.getState().hasErrorAlert).toBe(false)
    expect(useTaskStore.getState().errorAlertSummary).toBe(null)
  })

  it('ignores errors for unknown tasks', () => {
    useTaskStore.getState().updateStatus('missing', 'failed', { success: false, summary: 'x' })
    expect(useTaskStore.getState().hasErrorAlert).toBe(false)
  })

  it('restarts the timer when a new error arrives', () => {
    const store = useTaskStore.getState()
    store.triggerErrorAlert('first')
    vi.advanceTimersByTime(ERROR_ALERT_DURATION_MS - 100)
    store.triggerErrorAlert('second')
    vi.advanceTimersByTime(ERROR_ALERT_DURATION_MS - 100)
    expect(useTaskStore.getState().hasErrorAlert).toBe(true)
    expect(useTaskStore.getState().errorAlertSummary).toBe('second')
  })

  it('dismisses error alert when clearCompleted is called', () => {
    const store = useTaskStore.getState()
    store.triggerErrorAlert('Old error')
    store.clearCompleted()
    expect(useTaskStore.getState().hasErrorAlert).toBe(false)
  })

  it('tracks unread system logs', () => {
    const store = useTaskStore.getState()
    store.addSystemLog({ level: 'info', message: 'installed', timestamp: Date.now() })
    expect(useTaskStore.getState().hasUnreadLogs).toBe(true)

    store.markLogsRead()
    expect(useTaskStore.getState().hasUnreadLogs).toBe(false)
    expect(useTaskStore.getState().systemLogs.length).toBe(1)

    store.addSystemLog({ level: 'info', message: 'again', timestamp: Date.now() })
    store.clearSystemLogs()
    expect(useTaskStore.getState().hasUnreadLogs).toBe(false)
    expect(useTaskStore.getState().systemLogs.length).toBe(0)
  })
})
