import React, { useMemo, useCallback } from 'react'
import { useAICodingStore, defaultMode, defaultEffort } from '../../stores/useAICodingStore'
import CodingMessageList from './CodingMessageList'
import CodingInput from './CodingInput'
import { useT } from '../../i18n'
import type { CodingMode, CodingEffort, CodingImage, CodingMessage } from '../../types/ai-coding'

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

interface CodingChatPanelProps {
  sessionId: string
  onNewSession: () => void
  onCloseSession?: (sessionId: string) => void
}

const CodingChatPanel: React.FC<CodingChatPanelProps> = ({ sessionId, onNewSession, onCloseSession }) => {
  const t = useT()
  const {
    sessions, workspaces,
    sessionMessages, sessionStreaming, sessionStreamingBlocks, sessionModes, sessionEffort, sessionContextUsage,
    sessionPendingQuestions,
    sendUserMessage, setSessionMode, setSessionEffort, interruptSession, stopSession,
    clearSessionMessages,
  } = useAICodingStore()

  const session = useMemo(() => sessions.find(s => s.id === sessionId), [sessions, sessionId])
  const workspace = useMemo(() => session ? workspaces.find(w => w.id === session.workspaceId) : null, [workspaces, session])

  const messages = sessionMessages[sessionId] || []
  const isStreaming = sessionStreaming[sessionId] || false
  const streamingBlocks = sessionStreamingBlocks[sessionId] || []
  const mode: CodingMode = sessionModes[sessionId] || (session ? defaultMode(session.toolType) : 'manual')
  const effort: CodingEffort = sessionEffort[sessionId] || (session ? defaultEffort(session.toolType) : 'high')
  const hasPendingQuestion = !!sessionPendingQuestions[sessionId]
  const contextUsage = sessionContextUsage[sessionId] || undefined

  /** Add a local system message bubble */
  const addLocalMessage = useCallback((text: string) => {
    const msg: CodingMessage = {
      id: genLocalMsgId(), sessionId, role: 'system',
      blocks: [{ type: 'text', text }],
      timestamp: Date.now()
    }
    useAICodingStore.setState(s => ({
      sessionMessages: {
        ...s.sessionMessages,
        [sessionId]: [...(s.sessionMessages[sessionId] || []), msg]
      }
    }))
  }, [sessionId])

  const handleSend = useCallback((text: string, images?: CodingImage[]) => {
    if (text === '/clear') { clearSessionMessages(sessionId); return }
    if (text === '/help' && session?.toolType === 'codex') { addLocalMessage(t('coding.codexHelp')); return }
    if (session?.toolType === 'codex' && text === '/ask') { setSessionMode(sessionId, 'ask'); addLocalMessage(t('coding.codexSwitchedAsk')); return }
    if (session?.toolType === 'codex' && text === '/auto') { setSessionMode(sessionId, 'approve-for-me'); addLocalMessage(t('coding.codexSwitchedApproveForMe')); return }
    if (session?.toolType === 'codex' && text === '/full') { setSessionMode(sessionId, 'full-access'); addLocalMessage(t('coding.codexSwitchedFull')); return }
    if (session?.toolType !== 'codex' && text === '/ask') { setSessionMode(sessionId, 'manual'); addLocalMessage(t('coding.switchedManual')); return }
    if (session?.toolType !== 'codex' && text === '/auto') { setSessionMode(sessionId, 'auto'); addLocalMessage(t('coding.switchedAuto')); return }
    if (text === '/context') {
      if (!contextUsage) { addLocalMessage(t('coding.codexNoContextUsage')); return }
      const used = contextUsage.usedTokens ?? ((contextUsage.inputTokens || 0) + (contextUsage.cachedInputTokens || 0))
      const total = contextUsage.contextWindow || 0
      const pct = total > 0 ? ` (${Math.round((used / total) * 100)}%)` : ''
      addLocalMessage(t('coding.codexContextUsage', used.toLocaleString(), total > 0 ? ` / ${total.toLocaleString()}` : '', pct))
      return
    }
    if (session?.toolType === 'codex' && text === '/compact') {
      sendUserMessage(sessionId, 'Summarize the current conversation and active work context compactly, preserving decisions, pending tasks, relevant files, and next steps.')
      return
    }
    if (session?.toolType === 'codex' && text === '/review') {
      sendUserMessage(sessionId, 'Review the current repository changes. Prioritize bugs, regressions, missing tests, and risky behavior. Report findings first with file and line references where possible.')
      return
    }
    if (text === '/cost') {
      const totalCost = messages.reduce((sum, m) => sum + (m.costUsd || 0), 0)
      addLocalMessage(t('coding.totalCost', totalCost.toFixed(4)))
      return
    }
    if (text === '/help') { addLocalMessage(t('coding.claudeHelp')); return }
    if (text === '/plan' && session?.toolType === 'codex') { addLocalMessage(t('coding.codexPlanUnavailable')); return }
    if (text === '/plan') { setSessionMode(sessionId, 'plan'); addLocalMessage(t('coding.switchedPlan')); return }
    if (UNSUPPORTED_COMMANDS.has(text)) { addLocalMessage(t('coding.commandNeedsCli', text)); return }
    sendUserMessage(sessionId, text, images)
  }, [sessionId, session?.toolType, sendUserMessage, clearSessionMessages, setSessionMode, addLocalMessage, messages, contextUsage, t])

  const handleModeChange = useCallback((m: CodingMode) => {
    setSessionMode(sessionId, m)
  }, [sessionId, setSessionMode])

  const handleEffortChange = useCallback((e: CodingEffort) => {
    setSessionEffort(sessionId, e)
  }, [sessionId, setSessionEffort])

  const handleInterrupt = useCallback(() => { interruptSession(sessionId) }, [sessionId, interruptSession])
  const handleStop = useCallback(() => { stopSession(sessionId) }, [sessionId, stopSession])

  if (!session) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <CodingMessageList
        messages={messages}
        isStreaming={isStreaming}
        streamingBlocks={streamingBlocks}
        hasExistingSession={!!session?.toolSessionId && messages.length === 0}
        sessionId={sessionId}
        toolType={session.toolType}
      />
      <CodingInput
        sessionId={sessionId}
        toolType={session.toolType}
        isStreaming={isStreaming}
        mode={mode}
        effort={effort}
        hasPendingQuestion={hasPendingQuestion}
        workingDir={workspace?.workingDir}
        costUsd={session.costUsd}
        messageCount={messages.length}
        contextUsage={contextUsage}
        onSend={handleSend}
        onModeChange={handleModeChange}
        onEffortChange={handleEffortChange}
        onInterrupt={handleInterrupt}
        onStop={handleStop}
      />
    </div>
  )
}

export default CodingChatPanel
