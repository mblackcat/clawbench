/**
 * Subscribe to main-process streamAgentQuery for panels that own client tools
 * (EditorChat, AI Terminal). Executes tools in the renderer and submits results.
 */

export interface ClientToolDef {
  name: string
  description: string
  inputSchema: Record<string, any>
  isReadOnly?: boolean
}

export interface AgentClientLoopParams {
  modelConfigId: string
  modelId?: string
  messages: Array<{ role: string; content: string; reasoningContent?: string }>
  systemPromptOverride: string
  clientTools: ClientToolDef[]
  enableThinking?: boolean
  toolsEnabled?: boolean
  webSearchEnabled?: boolean
  toolApprovalMode?: string
  executeTool: (
    name: string,
    input: Record<string, any>
  ) => Promise<{ result: string; isError: boolean }>
  onDelta?: (text: string) => void
  onThinking?: (text: string) => void
  onToolStart?: (tc: { id: string; name: string; input: Record<string, any> }) => void
  onToolEnd?: (tc: {
    id: string
    name: string
    result: string
    isError: boolean
  }) => void
  signal?: AbortSignal
}

export interface AgentClientLoopResult {
  content: string
  thinking: string
  cancelled: boolean
  error?: string
}

/**
 * Run main-process agent loop with client tools executed here.
 */
export async function runAgentClientLoop(
  params: AgentClientLoopParams
): Promise<AgentClientLoopResult> {
  let content = ''
  let thinking = ''
  let cancelled = false
  let error: string | undefined
  const cleanups: Array<() => void> = []

  const taskId = await window.api.ai.streamAgentQuery({
    modelConfigId: params.modelConfigId,
    modelId: params.modelId,
    messages: params.messages,
    enableThinking: params.enableThinking,
    toolsEnabled: params.toolsEnabled === true,
    webSearchEnabled: !!params.webSearchEnabled,
    toolApprovalMode: params.toolApprovalMode || 'auto-approve-session',
    systemPromptOverride: params.systemPromptOverride,
    clientTools: params.clientTools,
    assistantEnabled: false,
  })

  if (params.signal) {
    const onAbort = () => {
      cancelled = true
      window.api.ai.cancelChat(taskId).catch(() => {})
    }
    if (params.signal.aborted) onAbort()
    else params.signal.addEventListener('abort', onAbort, { once: true })
  }

  await new Promise<void>((resolve) => {
    cleanups.push(
      window.api.ai.onChatDelta((data) => {
        if (data.taskId !== taskId) return
        content += data.content
        params.onDelta?.(data.content)
      })
    )
    cleanups.push(
      window.api.ai.onChatThinkingDelta((data) => {
        if (data.taskId !== taskId) return
        thinking += data.content
        params.onThinking?.(data.content)
      })
    )
    cleanups.push(
      window.api.ai.onChatToolUse((data) => {
        if (data.taskId !== taskId) return
        // Client tool: execute and submit result for main loop to continue
        const isClient = params.clientTools.some((t) => t.name === data.toolName)
        if (!isClient) return
        params.onToolStart?.({
          id: data.toolCallId,
          name: data.toolName,
          input: data.input,
        })
        void (async () => {
          try {
            const r = await params.executeTool(data.toolName, data.input || {})
            params.onToolEnd?.({
              id: data.toolCallId,
              name: data.toolName,
              result: r.result,
              isError: r.isError,
            })
            await window.api.ai.submitToolResult(
              taskId,
              data.toolCallId,
              r.result,
              r.isError
            )
          } catch (err: any) {
            const msg = err?.message || String(err)
            params.onToolEnd?.({
              id: data.toolCallId,
              name: data.toolName,
              result: msg,
              isError: true,
            })
            await window.api.ai.submitToolResult(taskId, data.toolCallId, msg, true)
          }
        })()
      })
    )
    cleanups.push(
      window.api.ai.onChatDone((data) => {
        if (data.taskId !== taskId) return
        resolve()
      })
    )
    cleanups.push(
      window.api.ai.onChatError((data) => {
        if (data.taskId !== taskId) return
        error = data.error
        resolve()
      })
    )
  })

  for (const c of cleanups) c()

  return { content, thinking, cancelled, error }
}
