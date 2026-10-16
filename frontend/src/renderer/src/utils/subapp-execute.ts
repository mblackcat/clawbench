import { useTaskStore } from '../stores/useTaskStore'
import type { SubAppExecuteResult } from '../types/subapp'

/** Normalize the `subapp:execute` IPC result (legacy bare taskId string accepted). */
export function normalizeExecuteResult(result: SubAppExecuteResult | string): SubAppExecuteResult {
  if (typeof result === 'string') return { taskId: result }
  return result
}

/**
 * Seeds the task store from an execute result so the bottom output panel shows
 * the run. Early-terminal results (disabled / no Python / gate failure) create
 * the task directly in its terminal state with the reason as the first log line.
 * Idempotent: an existing task (e.g. created by `task-started`) is left as is.
 */
export function seedTaskFromExecuteResult(
  raw: SubAppExecuteResult | string,
  appId: string,
  appName: string,
  opts: { activate?: boolean } = {}
): SubAppExecuteResult {
  const result = normalizeExecuteResult(raw)
  const { taskId, earlyTerminal } = result
  const store = useTaskStore.getState()
  if (earlyTerminal) {
    const { status, summary, summaryI18nKey, summaryI18nArgs } = earlyTerminal
    store.startTask(taskId, appId, appName, {
      status,
      result: { success: false, summary, summaryI18nKey, summaryI18nArgs },
      initialOutput: {
        taskId,
        type: 'error',
        level: 'error',
        message: summary,
        i18nKey: summaryI18nKey,
        i18nArgs: summaryI18nArgs,
        timestamp: Date.now()
      }
    })
  } else {
    store.startTask(taskId, appId, appName)
  }
  if (opts.activate !== false) store.setActiveTask(taskId)
  return result
}

/** Translated summary of an early-terminal result (falls back to the raw text). */
export function describeEarlyTerminal(
  earlyTerminal: NonNullable<SubAppExecuteResult['earlyTerminal']>,
  t: (key: string, ...args: (string | number)[]) => string
): string {
  if (earlyTerminal.summaryI18nKey) {
    const translated = t(earlyTerminal.summaryI18nKey, ...(earlyTerminal.summaryI18nArgs ?? []))
    if (translated && translated !== earlyTerminal.summaryI18nKey) return translated
  }
  return earlyTerminal.summary
}
