import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../i18n', () => ({ getT: () => (k: string) => k }))

import { runAfterInstallIfEnabled } from '../run-after-install'
import { useRunAfterInstallStore } from '../../stores/useRunAfterInstallStore'
import { useWorkspaceStore } from '../../stores/useWorkspaceStore'
import { useTaskStore } from '../../stores/useTaskStore'

const execute = vi.fn()

describe('runAfterInstallIfEnabled', () => {
  beforeEach(() => {
    execute.mockReset()
    localStorage.clear()
    ;(window as any).api = { subapp: { execute } }
    useRunAfterInstallStore.setState({ pending: null })
    useWorkspaceStore.setState({ activeWorkspace: { id: 'w1', name: 'W', path: '/w' } as any })
    useTaskStore.setState({ tasks: {}, activeTaskId: null })
  })

  it('does nothing unless run_after_install is exactly true', async () => {
    await runAfterInstallIfEnabled('a', { name: 'A' })
    await runAfterInstallIfEnabled('a', { name: 'A', run_after_install: 'true' as any })
    await runAfterInstallIfEnabled('a', null)
    expect(execute).not.toHaveBeenCalled()
  })

  it('ignores non-app resources', async () => {
    await runAfterInstallIfEnabled('s', { name: 'S', type: 'ai-skill', run_after_install: true })
    expect(execute).not.toHaveBeenCalled()
  })

  it('runs once with default params', async () => {
    execute.mockResolvedValue({ taskId: 't1' })
    await runAfterInstallIfEnabled('a', {
      name: 'A',
      run_after_install: true,
      params: [{ name: 'branch', type: 'string', label: 'Branch', required: true, default: 'main' }]
    })
    expect(execute).toHaveBeenCalledWith('a', { branch: 'main' })
    expect(useRunAfterInstallStore.getState().pending).toBeNull()
  })

  it('requests the params drawer when a required param has no default', async () => {
    await runAfterInstallIfEnabled('a', {
      name: 'A',
      run_after_install: true,
      params: [{ name: 'target', type: 'string', label: 'Target', required: true }]
    })
    expect(execute).not.toHaveBeenCalled()
    expect(useRunAfterInstallStore.getState().pending?.appId).toBe('a')
  })

  it('skips without an active workspace', async () => {
    useWorkspaceStore.setState({ activeWorkspace: null })
    await runAfterInstallIfEnabled('a', { name: 'A', run_after_install: true })
    expect(execute).not.toHaveBeenCalled()
  })

  it('seeds an early-terminal result and never throws', async () => {
    execute.mockResolvedValueOnce({
      taskId: 't2',
      earlyTerminal: { status: 'disabled', summary: 'off' }
    })
    await runAfterInstallIfEnabled('a', { name: 'A', run_after_install: true })
    expect(useTaskStore.getState().tasks.t2?.status).toBe('disabled')

    execute.mockRejectedValueOnce(new Error('boom'))
    await expect(runAfterInstallIfEnabled('a', { name: 'A', run_after_install: true })).resolves.toBeUndefined()
  })
})
