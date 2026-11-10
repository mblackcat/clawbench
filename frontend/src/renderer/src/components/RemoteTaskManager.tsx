import React, { useCallback, useEffect, useRef, useState } from 'react'
import { App, Badge, Button, Typography, theme } from 'antd'
import { CloudDownloadOutlined } from '@ant-design/icons'
import type { RemoteTaskItem } from '../types/ipc'
import type { SubAppManifest } from '../types/subapp'
import ParamDrawer from './ParamDrawer'
import { useAttentionStore } from '../stores/useAttentionStore'
import { useT } from '../i18n'

const { Text } = Typography

const attentionTarget = (taskId: string): string => `remote-task:${taskId}`

/**
 * Remote task dispatch — confirmation UI (mounted once in AppLayout).
 *
 * Tasks a server dispatches that need the user's consent (the default
 * `always-confirm` mode, installs/upgrades, sensitive params…) are listed in a
 * floating pill + attention item; the user reviews them in the ParamDrawer
 * and confirms (optionally editing params), rejects, or leaves them for later.
 */
export const RemoteTaskManager: React.FC = () => {
  const [waitingTasks, setWaitingTasks] = useState<RemoteTaskItem[]>([])
  const [activeTask, setActiveTask] = useState<RemoteTaskItem | null>(null)
  const [manifest, setManifest] = useState<SubAppManifest | null>(null)
  const { message, notification } = App.useApp()
  const { token } = theme.useToken()
  const t = useT()
  // useT returns a fresh function each render; keep effects stable.
  const tRef = useRef(t)
  tRef.current = t
  const knownIdsRef = useRef<Set<string>>(new Set())

  const syncAttention = useCallback((tasks: RemoteTaskItem[]) => {
    const store = useAttentionStore.getState()
    const alive = new Set(tasks.map((x) => x.taskId))
    for (const id of knownIdsRef.current) {
      if (!alive.has(id)) store.dismissByTarget('workbench', attentionTarget(id))
    }
    for (const task of tasks) {
      if (knownIdsRef.current.has(task.taskId)) continue
      store.raise({
        kind: 'action',
        source: 'workbench',
        targetId: attentionTarget(task.taskId),
        title: tRef.current('remoteTask.pendingNotificationTitle'),
        body: tRef.current('remoteTask.pendingNotificationBody', task.appName || task.appId)
      })
    }
    const previous = knownIdsRef.current
    knownIdsRef.current = alive
    return tasks.filter((x) => !previous.has(x.taskId))
  }, [])

  useEffect(() => {
    let mounted = true
    const api = window.api?.remoteTask
    if (!api) return

    const apply = (tasks: RemoteTaskItem[] | undefined, announce: boolean): void => {
      if (!mounted) return
      const list = tasks || []
      setWaitingTasks(list)
      setActiveTask((cur) => (cur && !list.some((x) => x.taskId === cur.taskId) ? null : cur))
      const fresh = syncAttention(list)
      if (announce && fresh.length > 0) {
        const latest = fresh[fresh.length - 1]
        const key = `remote-task-${latest.taskId}`
        notification.info({
          key,
          message: tRef.current('remoteTask.pendingNotificationTitle'),
          description: tRef.current('remoteTask.pendingNotificationBody', latest.appName || latest.appId),
          duration: 8,
          btn: (
            <Button
              type="primary"
              size="small"
              onClick={() => {
                notification.destroy(key)
                setActiveTask(latest)
              }}
            >
              {tRef.current('remoteTask.viewAndConfirm')}
            </Button>
          )
        })
      }
    }

    api.listWaiting().then((tasks) => apply(tasks, false)).catch(() => {})
    const unsub = api.onWaitingChanged((tasks) => apply(tasks, true))
    return () => {
      mounted = false
      unsub?.()
    }
  }, [notification, syncAttention])

  // Resolve the manifest for the drawer (fallback when not installed yet)
  useEffect(() => {
    if (!activeTask) {
      setManifest(null)
      return
    }
    let cancelled = false
    const fallback: SubAppManifest = {
      id: activeTask.appId,
      name: activeTask.appName || activeTask.appId,
      version: activeTask.appVersion,
      description: '',
      entry: 'main.py'
    } as SubAppManifest
    const load = activeTask.installAction
      ? Promise.resolve(fallback) // not installed / outdated: don't show stale local params
      : window.api.subapp.getManifest(activeTask.appId).then((m) => m || fallback)
    load
      .then((m) => {
        if (!cancelled) setManifest(m)
      })
      .catch(() => {
        if (!cancelled) setManifest(fallback)
      })
    return () => {
      cancelled = true
    }
  }, [activeTask])

  const handleConfirm = useCallback(
    async (params: Record<string, unknown>) => {
      if (!activeTask) return
      try {
        const res = await window.api.remoteTask.confirm(activeTask.taskId, {
          ...activeTask.presetParams,
          ...params
        })
        if (res?.success) message.success(tRef.current('remoteTask.confirmedSuccess'))
        else message.warning(tRef.current('remoteTask.noLongerPending'))
        setActiveTask(null)
      } catch (err: unknown) {
        message.error(err instanceof Error ? err.message : String(err))
      }
    },
    [activeTask, message]
  )

  const handleReject = useCallback(async () => {
    if (!activeTask) return
    try {
      await window.api.remoteTask.reject(activeTask.taskId)
      message.info(tRef.current('remoteTask.rejectedNotice'))
      setActiveTask(null)
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }, [activeTask, message])

  const handleClose = useCallback(() => setActiveTask(null), [])

  return (
    <>
      {waitingTasks.length > 0 && !activeTask && (
        <div
          data-testid="remote-task-pill"
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 1050,
            boxShadow: token.boxShadowSecondary,
            borderRadius: token.borderRadiusLG,
            background: token.colorBgElevated,
            border: `1px solid ${token.colorPrimaryBorder}`,
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12
          }}
        >
          <Badge count={waitingTasks.length} size="small">
            <CloudDownloadOutlined style={{ fontSize: 16, color: token.colorPrimary }} />
          </Badge>
          <Text strong style={{ fontSize: 13 }}>
            {t('remoteTask.pendingBannerText', String(waitingTasks.length))}
          </Text>
          <Button type="primary" size="small" onClick={() => setActiveTask(waitingTasks[0])}>
            {t('remoteTask.viewAndConfirm')}
          </Button>
        </div>
      )}

      {activeTask && manifest && (
        <ParamDrawer
          open
          manifest={manifest}
          remoteTask={activeTask}
          initialValues={activeTask.presetParams}
          resolveSlot={window.api.subapp.resolveSlot}
          onSubmit={handleConfirm}
          onReject={handleReject}
          onClose={handleClose}
        />
      )}
    </>
  )
}

export default RemoteTaskManager
