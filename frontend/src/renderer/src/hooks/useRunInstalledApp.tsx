import React, { useCallback, useState } from 'react'
import { App } from 'antd'
import ParamDrawer from '../components/ParamDrawer'
import { useT } from '../i18n'
import { useSubAppStore } from '../stores/useSubAppStore'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import type { SubAppInfo, SubAppManifest } from '../types/subapp'
import { buildInitialAppParams, saveAppParams } from '../utils/subapp-params'
import { describeEarlyTerminal, seedTaskFromExecuteResult } from '../utils/subapp-execute'

/**
 * Locate the installed copy of a market app: by manifest id (= applicationId),
 * then by name as a fallback, then straight from disk via getManifest.
 */
export async function resolveInstalledSubApp(
  appId: string,
  name?: string
): Promise<SubAppInfo | undefined> {
  const list = useSubAppStore.getState().appInfos
  const byId = list.find(
    (info) => info.source === 'user' && (info.id === appId || info.manifest?.id === appId)
  )
  if (byId) return byId
  if (name) {
    const byName = list.find((info) => info.source === 'user' && info.manifest?.name === name)
    if (byName) return byName
  }
  try {
    const manifest = await window.api.subapp.getManifest(appId)
    if (manifest) return { id: manifest.id || appId, manifest, path: '', source: 'user' }
  } catch {
    // not installed
  }
  return undefined
}

interface DrawerState {
  appId: string
  manifest: SubAppManifest
  initialValues: Record<string, unknown>
}

/**
 * Run an installed app from outside the favorites page (Discover, app detail):
 * opens the params drawer when the app has required params or asks for
 * confirmation, otherwise runs it with its default/saved params.
 * Render the returned `paramDrawer` element once in the page.
 */
export function useRunInstalledApp(): {
  runApp: (appId: string, appName: string, manifest: SubAppManifest) => Promise<void>
  paramDrawer: React.ReactElement
} {
  const { message } = App.useApp()
  const t = useT()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawer, setDrawer] = useState<DrawerState | null>(null)

  const executeApp = useCallback(
    async (appId: string, appName: string, params: Record<string, unknown>) => {
      try {
        if (!useWorkspaceStore.getState().activeWorkspace) {
          message.warning(t('workbench.selectWorkspaceFirst'))
          return
        }
        const result = seedTaskFromExecuteResult(
          await window.api.subapp.execute(appId, params),
          appId,
          appName
        )
        if (result.earlyTerminal) {
          if (result.earlyTerminal.status === 'disabled') {
            message.warning(t('workbench.appDisabled'))
          } else {
            message.error(describeEarlyTerminal(result.earlyTerminal, t))
          }
          return
        }
        message.success(t('workbench.appStarted', appName))
      } catch (error) {
        console.error('Failed to run app:', error)
        const reason = error instanceof Error ? error.message : String(error)
        message.error(reason ? t('workbench.runFailedReason', reason) : t('workbench.runFailed'))
      }
    },
    [message, t]
  )

  const runApp = useCallback(
    async (appId: string, appName: string, manifest: SubAppManifest) => {
      const params = manifest.params || []
      const initialValues = buildInitialAppParams(appId, params)
      if (params.some((p) => p.required) || manifest.confirm_before_run) {
        setDrawer({ appId, manifest, initialValues })
        setDrawerOpen(true)
        return
      }
      await executeApp(appId, appName, initialValues)
    },
    [executeApp]
  )

  const handleSubmit = async (params: Record<string, unknown>): Promise<void> => {
    setDrawerOpen(false)
    if (!drawer) return
    saveAppParams(drawer.appId, params)
    await executeApp(drawer.appId, drawer.manifest.name, params)
  }

  const paramDrawer = (
    <ParamDrawer
      open={drawerOpen}
      onClose={() => setDrawerOpen(false)}
      manifest={drawer?.manifest ?? null}
      initialValues={drawer?.initialValues ?? {}}
      resolveSlot={window.api.subapp.resolveSlot}
      onSubmit={handleSubmit}
    />
  )

  return { runApp, paramDrawer }
}
