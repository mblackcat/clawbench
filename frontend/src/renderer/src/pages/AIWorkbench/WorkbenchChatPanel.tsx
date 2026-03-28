import React, { useMemo, useCallback } from 'react'
import { useAIWorkbenchStore } from '../../stores/useAIWorkbenchStore'
import WorkbenchMessageList from './WorkbenchMessageList'
import WorkbenchInput from './WorkbenchInput'
import type { WorkbenchMode, WorkbenchMessage } from '../../types/ai-workbench'

let localMsgCounter = 0
function genLocalMsgId(): string { return `wm-local-${Date.now()}-${++localMsgCounter}` }

/**
 * Slash command handling strategy:
 *
 * With the Agent SDK, slash commands are sent as regular messages and
 * handled natively by Claude Code. Only a few commands are handled
 * locally in the UI for instant feedback.
 *
 * - Local commands (/clear, /cost, /help, /plan): handled entirely in the UI
 * - Native commands (/compact, /review, /init, etc.): sent as regular messages
 *   to the SDK which handles them natively
 * - Unsupported commands (/model, /permissions, /memory, /mcp, /doctor):
 *   require interactive terminal features; show info message
 */

/** Commands that require interactive terminal and cannot work via SDK query() */
const UNSUPPORTED_COMMANDS = new Set(['/memory', '/mcp', '/doctor'])

const HELP_TEXT = `可用命令:
/clear    清空对话记录
/cost     查看累计费用
/plan     切换到 Plan 模式
/compact  压缩对话上下文
/review   代码审查
/init     初始化 CLAUDE.md
/model    查看/切换模型 (如 /model claude-sonnet-4-5-20250514)
/permissions  查看/切换权限模式
/help     查看帮助

以下命令请在 CLI 模式下使用:
/memory, /mcp, /doctor`

interface WorkbenchChatPanelProps {
  sessionId: string
  onNewSession: () => void
  onCloseSession?: (sessionId: string) => void
}

const WorkbenchChatPanel: React.FC<WorkbenchChatPanelProps> = ({ sessionId, onNewSession, onCloseSession }) => {
  const {
    sessions, workspaces,
    sessionMessages, sessionStreaming, sessionStreamingBlocks, sessionModes,
    sessionPendingQuestions,
    sendUserMessage, setSessionMode, interruptSession, stopSession,
    clearSessionMessages,
  } = useAIWorkbenchStore()

  const session = useMemo(() => sessions.find(s => s.id === sessionId), [sessions, sessionId])
  const workspace = useMemo(() => session ? workspaces.find(w => w.id === session.workspaceId) : null, [workspaces, session])

  const messages = sessionMessages[sessionId] || []
  const isStreaming = sessionStreaming[sessionId] || false
  const streamingBlocks = sessionStreamingBlocks[sessionId] || []
  const mode: WorkbenchMode = sessionModes[sessionId] || 'ask-first'
  const hasPendingQuestion = !!sessionPendingQuestions[sessionId]

  /** Add a local system message bubble */
  const addLocalMessage = useCallback((text: string) => {
    const msg: WorkbenchMessage = {
      id: genLocalMsgId(), sessionId, role: 'system',
      blocks: [{ type: 'text', text }],
      timestamp: Date.now()
    }
    useAIWorkbenchStore.setState(s => ({
      sessionMessages: {
        ...s.sessionMessages,
        [sessionId]: [...(s.sessionMessages[sessionId] || []), msg]
      }
    }))
  }, [sessionId])

  const handleSend = useCallback((text: string) => {
    if (text === '/clear') { clearSessionMessages(sessionId); return }
    if (text === '/cost') {
      const totalCost = messages.reduce((sum, m) => sum + (m.costUsd || 0), 0)
      addLocalMessage(`累计会话费用: $${totalCost.toFixed(4)}`)
      return
    }
    if (text === '/help') { addLocalMessage(HELP_TEXT); return }
    if (text === '/plan') { setSessionMode(sessionId, 'plan'); addLocalMessage('已切换到 Plan 模式'); return }
    if (UNSUPPORTED_COMMANDS.has(text)) { addLocalMessage(`${text} 命令需要终端交互，请切换到 CLI 模式使用。`); return }
    sendUserMessage(sessionId, text)
  }, [sessionId, sendUserMessage, clearSessionMessages, setSessionMode, addLocalMessage, messages])

  const handleModeChange = useCallback((m: WorkbenchMode) => {
    setSessionMode(sessionId, m)
  }, [sessionId, setSessionMode])

  const handleInterrupt = useCallback(() => { interruptSession(sessionId) }, [sessionId, interruptSession])
  const handleStop = useCallback(() => { stopSession(sessionId) }, [sessionId, stopSession])

  if (!session) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <WorkbenchMessageList
        messages={messages}
        isStreaming={isStreaming}
        streamingBlocks={streamingBlocks}
        hasExistingSession={!!session?.toolSessionId && messages.length === 0}
        sessionId={sessionId}
      />
      <WorkbenchInput
        sessionId={sessionId}
        toolType={session.toolType}
        isStreaming={isStreaming}
        mode={mode}
        hasPendingQuestion={hasPendingQuestion}
        workingDir={workspace?.workingDir}
        costUsd={session.costUsd}
        messageCount={messages.length}
        onSend={handleSend}
        onModeChange={handleModeChange}
        onInterrupt={handleInterrupt}
        onStop={handleStop}
      />
    </div>
  )
}

export default WorkbenchChatPanel
