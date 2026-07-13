import React, { useState, useRef, useCallback, useLayoutEffect, useMemo, useEffect, KeyboardEvent } from 'react'
import { Input, Button, Dropdown, Tooltip, theme } from 'antd'
import {
  SendOutlined, StopOutlined, PauseCircleOutlined, PaperClipOutlined,
  CloseCircleFilled, BulbOutlined, QuestionCircleOutlined, EditOutlined,
  FolderOutlined, BranchesOutlined, DollarOutlined, MessageOutlined, DashboardOutlined, UnlockOutlined,
  ThunderboltOutlined, HighlightOutlined, RocketOutlined, CheckOutlined
} from '@ant-design/icons'
import { useT } from '../../i18n'
import { MONO_FONT_STACK } from '../../utils/mono-font'
import type { AIToolType, CodingContentBlock, CodingImage, CodingMode, CodingEffort, CodingPendingFile } from '../../types/ai-coding'

const { TextArea } = Input

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'])

// Claude Code slash commands — shown in autocomplete dropdown
const CLAUDE_SLASH_COMMANDS = [
  // ── 常用操作 ──
  { key: '/compact', label: '/compact', descKey: 'coding.slashCompactDesc' },
  { key: '/clear', label: '/clear', descKey: 'coding.slashClearDesc' },
  { key: '/cost', label: '/cost', descKey: 'coding.slashCostDesc' },
  { key: '/help', label: '/help', descKey: 'coding.slashHelpDesc' },
  // ── 模式/模型 ──
  { key: '/model', label: '/model', descKey: 'coding.slashModel' },
  { key: '/permissions', label: '/permissions', descKey: 'coding.slashPermissions' },
  { key: '/plan', label: '/plan', descKey: 'coding.slashPlan' },
  // ── 代码工具 ──
  { key: '/review', label: '/review', descKey: 'coding.slashReviewDesc' },
  { key: '/init', label: '/init', descKey: 'coding.slashInit' },
  // ── 仅 CLI ──
  { key: '/memory', label: '/memory', descKey: 'coding.slashMemoryDesc' },
  { key: '/mcp', label: '/mcp', descKey: 'coding.slashMcpDesc' },
  { key: '/doctor', label: '/doctor', descKey: 'coding.slashDoctorDesc' },
]

const CODEX_SLASH_COMMANDS = [
  { key: '/clear', label: '/clear', descKey: 'coding.slashClear' },
  { key: '/cost', label: '/cost', descKey: 'coding.slashCost' },
  { key: '/context', label: '/context', descKey: 'coding.slashContext' },
  { key: '/help', label: '/help', descKey: 'coding.slashHelp' },
  { key: '/ask', label: '/ask', descKey: 'coding.codexModeAsk' },
  { key: '/auto', label: '/auto', descKey: 'coding.codexModeApproveForMe' },
  { key: '/full', label: '/full', descKey: 'coding.codexModeFull' },
  { key: '/compact', label: '/compact', descKey: 'coding.slashCompact' },
  { key: '/review', label: '/review', descKey: 'coding.slashReview' },
]

interface CodingInputProps {
  sessionId: string
  toolType: AIToolType
  isStreaming: boolean
  mode: CodingMode
  effort: CodingEffort
  hasPendingQuestion?: boolean
  workingDir?: string
  costUsd?: number
  messageCount?: number
  contextUsage?: Extract<CodingContentBlock, { type: 'context_usage' }>
  onSend: (text: string, images?: CodingImage[]) => void
  onModeChange: (mode: CodingMode) => void
  onEffortChange: (effort: CodingEffort) => void
  onInterrupt: () => void
  onStop: () => void
}

const CLAUDE_MODES: { key: CodingMode; labelKey: string; icon: React.ReactNode }[] = [
  { key: 'manual', labelKey: 'coding.modeManual', icon: <EditOutlined /> },
  { key: 'edit-automatically', labelKey: 'coding.modeEditAutomatically', icon: <HighlightOutlined /> },
  { key: 'plan', labelKey: 'coding.modePlan', icon: <BulbOutlined /> },
  { key: 'auto', labelKey: 'coding.modeAuto', icon: <RocketOutlined /> },
]

const CODEX_MODES: { key: CodingMode; labelKey: string; icon: React.ReactNode }[] = [
  { key: 'ask', labelKey: 'coding.codexModeAsk', icon: <QuestionCircleOutlined /> },
  { key: 'approve-for-me', labelKey: 'coding.codexModeApproveForMe', icon: <CheckOutlined /> },
  { key: 'full-access', labelKey: 'coding.codexModeFull', icon: <UnlockOutlined /> },
]

// Reasoning-effort presets per tool. Claude exposes low..max plus an ultracode
// preset; Codex caps at xhigh (modelReasoningEffort: low..xhigh).
const CLAUDE_EFFORTS: { key: CodingEffort; labelKey: string }[] = [
  { key: 'low', labelKey: 'coding.effortLow' },
  { key: 'medium', labelKey: 'coding.effortMedium' },
  { key: 'high', labelKey: 'coding.effortHigh' },
  { key: 'xhigh', labelKey: 'coding.effortXhigh' },
  { key: 'max', labelKey: 'coding.effortMax' },
  { key: 'ultracode', labelKey: 'coding.effortUltracode' },
]
const CODEX_EFFORTS: { key: CodingEffort; labelKey: string }[] = [
  { key: 'low', labelKey: 'coding.effortLight' },
  { key: 'medium', labelKey: 'coding.effortMedium' },
  { key: 'high', labelKey: 'coding.effortHigh' },
  { key: 'xhigh', labelKey: 'coding.effortXhigh' },
]

const CodingInput: React.FC<CodingInputProps> = ({
  sessionId: _sessionId, toolType, isStreaming, mode, effort, hasPendingQuestion, workingDir, costUsd, messageCount, contextUsage, onSend, onModeChange, onEffortChange, onInterrupt, onStop
}) => {
  const [inputValue, setInputValue] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<CodingPendingFile[]>([])
  const [slashIndex, setSlashIndex] = useState(-1) // selected index in inline autocomplete
  const textAreaRef = useRef<any>(null)
  const { token } = theme.useToken()
  const t = useT()

  // Git branch
  const [gitBranch, setGitBranch] = useState<string>('')
  useEffect(() => {
    if (!workingDir) { setGitBranch(''); return }
    let cancelled = false
    const fetch = () => {
      window.api.git.listBranches(workingDir)
        .then((r: any) => { if (!cancelled && r?.current) setGitBranch(r.current) })
        .catch(() => { if (!cancelled) setGitBranch('') })
    }
    fetch()
    const timer = setInterval(fetch, 15_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [workingDir])

  // Shorten path for display
  const shortDir = useMemo(() => {
    if (!workingDir) return ''
    let p = workingDir
    // Replace home dir with ~
    if (p.startsWith('/Users/')) {
      const parts = p.split('/')
      if (parts.length >= 3) p = '~/' + parts.slice(3).join('/')
    } else if (p.startsWith('C:\\Users\\')) {
      const parts = p.split('\\')
      if (parts.length >= 3) p = '~\\' + parts.slice(3).join('\\')
    }
    return p
  }, [workingDir])

  const slashCommands = useMemo(() => {
    if (toolType === 'claude') return CLAUDE_SLASH_COMMANDS.map(c => ({ ...c, desc: t(c.descKey) }))
    if (toolType === 'codex') return CODEX_SLASH_COMMANDS.map(c => ({ ...c, desc: t(c.descKey) }))
    return []
  }, [toolType, t])

  // Inline slash autocomplete: show when input starts with / and the tool supports chat commands
  const slashPrefix = inputValue.startsWith('/') ? inputValue.toLowerCase() : ''
  const inlineSlashItems = useMemo(() => {
    if (!slashPrefix) return []
    return slashCommands.filter(c => c.key.startsWith(slashPrefix))
  }, [slashPrefix, slashCommands])

  // Mode capsule refs
  const capsuleRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  const modeOptions = useMemo(
    () => (toolType === 'codex' ? CODEX_MODES : CLAUDE_MODES).map(m => ({ ...m, label: t(m.labelKey) })),
    [toolType, t]
  )
  const activeMode = modeOptions.some(m => m.key === mode) ? mode : modeOptions[0].key
  const modeIndex = modeOptions.findIndex(m => m.key === activeMode)

  // Effort selector (reasoning depth). Falls back to the first option if the
  // current value isn't offered for this tool (e.g. codex can't do max/ultracode).
  const effortOptions = useMemo(
    () => (toolType === 'codex' ? CODEX_EFFORTS : CLAUDE_EFFORTS).map(e => ({ ...e, label: t(e.labelKey) })),
    [toolType, t]
  )
  const activeEffort = effortOptions.some(e => e.key === effort) ? effort : effortOptions[0].key
  const activeEffortLabel = effortOptions.find(e => e.key === activeEffort)?.label || effortOptions[0].label
  const effortMenuItems = effortOptions.map(e => ({
    key: e.key,
    label: (
      <span style={{ fontWeight: activeEffort === e.key ? 600 : 400, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {activeEffort === e.key && <CheckOutlined style={{ fontSize: 11 }} />}
        {e.label}
      </span>
    ),
    onClick: () => onEffortChange(e.key),
  }))

  useLayoutEffect(() => {
    const btn = btnRefs.current[modeIndex]
    if (btn && capsuleRef.current) {
      const capsuleRect = capsuleRef.current.getBoundingClientRect()
      const btnRect = btn.getBoundingClientRect()
      const nextIndicator = {
        left: btnRect.left - capsuleRect.left,
        width: btnRect.width,
      }
      setIndicator(prev => {
        if (prev.left === nextIndicator.left && prev.width === nextIndicator.width) return prev
        return nextIndicator
      })
    }
  }, [modeIndex, modeOptions])

  const handleSend = useCallback(async () => {
    const text = inputValue.trim()
    if (!text && pendingFiles.length === 0) return

    const imageFiles = pendingFiles.filter(f => f.isImage)
    const otherFiles = pendingFiles.filter(f => !f.isImage)

    // Image attachments: read as base64 so Claude receives real multimodal input.
    const images: CodingImage[] = []
    for (const f of imageFiles) {
      try {
        const res = await window.api.aiCoding.readFileBase64(f.filePath)
        if (res) images.push(res)
      } catch { /* skip unreadable file */ }
    }

    // Non-image files: reference by path so the agent can Read them itself.
    let finalText = text
    if (otherFiles.length > 0) {
      const paths = otherFiles.map(f => f.filePath).join('\n- ')
      finalText = `${text ? text + '\n\n' : ''}${t('coding.refFiles')}\n- ${paths}`
    }

    onSend(finalText, images.length > 0 ? images : undefined)
    setInputValue('')
    setPendingFiles([])
    setTimeout(() => textAreaRef.current?.focus(), 0)
  }, [inputValue, pendingFiles, onSend, t])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Inline slash autocomplete navigation
    if (inlineSlashItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex(i => (i + 1) % inlineSlashItems.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex(i => (i <= 0 ? inlineSlashItems.length - 1 : i - 1))
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !isComposing && slashIndex >= 0)) {
        e.preventDefault()
        const selected = inlineSlashItems[Math.max(0, slashIndex)]
        if (selected) {
          onSend(selected.key)
          setInputValue('')
          setSlashIndex(-1)
        }
        return
      }
      if (e.key === 'Escape') {
        setSlashIndex(-1)
        setInputValue('')
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault()
      if (!isStreaming) handleSend()
    }
  }, [handleSend, isStreaming, isComposing, inlineSlashItems, slashIndex, onSend])

  const handleSlashCommand = useCallback((cmd: string) => {
    onSend(cmd)
  }, [onSend])

  const handleSelectFiles = useCallback(async () => {
    try {
      const filePaths = await window.api.dialog.selectFiles()
      if (filePaths.length === 0) return
      const newFiles: CodingPendingFile[] = filePaths.map(fp => {
        const fileName = fp.split('/').pop() || fp.split('\\').pop() || fp
        const ext = fileName.split('.').pop()?.toLowerCase() || ''
        return {
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          filePath: fp,
          fileName,
          isImage: IMAGE_EXTS.has(ext),
        }
      })
      setPendingFiles(prev => [...prev, ...newFiles])
    } catch {
      // user cancelled or error
    }
  }, [])

  const removeFile = useCallback((id: string) => {
    setPendingFiles(prev => prev.filter(f => f.id !== id))
  }, [])

  const slashMenuItems = slashCommands.map(c => ({
    key: c.key,
    label: (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontFamily: MONO_FONT_STACK, fontWeight: 500 }}>{c.label}</span>
        <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>{c.desc}</span>
      </div>
    ),
    onClick: () => handleSlashCommand(c.key)
  }))

  const hasContent = inputValue.trim().length > 0 || pendingFiles.length > 0

  return (
    <div style={{ padding: '8px 16px 12px', borderTop: `1px solid ${token.colorBorderSecondary}` }}>
      {/* Toolbar row (above input) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {/* Mode capsule */}
        {(toolType === 'claude' || toolType === 'codex') && (
          <div
            ref={capsuleRef}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              borderRadius: 8,
              background: token.colorFillTertiary,
              padding: 2,
              position: 'relative',
            }}
          >
            {/* Sliding indicator */}
            <div style={{
              position: 'absolute',
              top: 2,
              left: indicator.left,
              width: indicator.width,
              height: 'calc(100% - 4px)',
              borderRadius: 6,
              background: token.colorPrimary,
              transition: '0.25s cubic-bezier(0.4, 0, 0.2, 1)',
              zIndex: 0,
            }} />
            {modeOptions.map((m, i) => (
              <button
                key={m.key}
                ref={el => { btnRefs.current[i] = el }}
                onClick={() => onModeChange(m.key)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 10px',
                  border: 'none',
                  background: 'transparent',
                  borderRadius: 6,
                  cursor: 'pointer',
                  position: 'relative',
                  zIndex: 1,
                  fontSize: 12,
                  color: activeMode === m.key ? '#fff' : token.colorTextSecondary,
                  fontWeight: activeMode === m.key ? 500 : 400,
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  transition: 'color 0.25s',
                  lineHeight: '20px',
                }}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>
        )}

        {/* Effort selector (reasoning depth) */}
        {(toolType === 'claude' || toolType === 'codex') && (
          <Dropdown menu={{ items: effortMenuItems }} trigger={['click']} placement="topLeft">
            <Button
              type="text"
              size="small"
              icon={<ThunderboltOutlined style={{ color: token.colorPrimary }} />}
              style={{
                fontSize: 12,
                color: token.colorTextSecondary,
                padding: '0 8px',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              {activeEffortLabel}
            </Button>
          </Dropdown>
        )}

        {/* Slash commands (claude only) */}
        {slashMenuItems.length > 0 && (
          <Dropdown menu={{ items: slashMenuItems }} trigger={['click']} placement="topLeft">
            <Button
              type="text"
              size="small"
              style={{
                fontFamily: MONO_FONT_STACK,
                fontWeight: 600,
                fontSize: 14,
                padding: '0 8px',
                color: token.colorTextSecondary,
              }}
            >
              /
            </Button>
          </Dropdown>
        )}

        {/* Right-side action cluster — kept together so it never wraps into a vertical squeeze */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 'auto' }}>
          {/* Streaming status */}
          {isStreaming && (
            <span style={{ color: token.colorTextSecondary, fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {t('coding.processing')}
            </span>
          )}

          {/* Attachment button */}
          <Tooltip title={t('coding.addAttachment')}>
            <Button
              type="text"
              size="small"
              icon={<PaperClipOutlined />}
              onClick={handleSelectFiles}
              disabled={isStreaming}
            />
          </Tooltip>

          {/* Interrupt + Stop (streaming) */}
          {isStreaming && (
            <>
              <Tooltip title={t('coding.interruptTask')}>
                <Button
                  size="small"
                  icon={<PauseCircleOutlined />}
                  onClick={onInterrupt}
                />
              </Tooltip>
              <Tooltip title={t('coding.stopSession')}>
                <Button
                  size="small"
                  danger
                  icon={<StopOutlined />}
                  onClick={onStop}
                />
              </Tooltip>
            </>
          )}

          {/* Send button */}
          {!isStreaming && (
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              disabled={!hasContent}
            />
          )}
        </div>
      </div>

      {/* Pending file previews */}
      {pendingFiles.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {pendingFiles.map(pf => (
            <div
              key={pf.id}
              style={{
                position: 'relative',
                borderRadius: 8,
                border: `1px solid ${token.colorBorderSecondary}`,
                padding: '6px 8px',
                background: token.colorBgElevated,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                maxWidth: 260,
              }}
            >
              {/* Extension badge */}
              <div style={{
                width: 36,
                height: 36,
                borderRadius: 6,
                background: token.colorFillTertiary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 600,
                color: token.colorTextSecondary,
                flexShrink: 0,
              }}>
                {pf.fileName.split('.').pop()?.toUpperCase() || 'FILE'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12,
                  color: token.colorText,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontWeight: 500,
                }}>
                  {pf.fileName}
                </div>
                <div style={{
                  fontSize: 10,
                  color: token.colorTextTertiary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {pf.filePath}
                </div>
              </div>
              <CloseCircleFilled
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  fontSize: 16,
                  color: token.colorTextTertiary,
                  cursor: 'pointer',
                  background: token.colorBgContainer,
                  borderRadius: '50%',
                }}
                onClick={() => removeFile(pf.id)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Inline slash autocomplete popup */}
      {inlineSlashItems.length > 0 && (
        <div style={{
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 8,
          background: token.colorBgElevated,
          boxShadow: token.boxShadowSecondary,
          marginBottom: 6,
          overflow: 'hidden',
        }}>
          {inlineSlashItems.map((c, i) => (
            <div
              key={c.key}
              onMouseDown={(e) => { e.preventDefault(); onSend(c.key); setInputValue(''); setSlashIndex(-1) }}
              style={{
                display: 'flex', gap: 8, alignItems: 'center',
                padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                background: i === slashIndex ? token.colorFillSecondary : 'transparent',
              }}
            >
              <span style={{ fontFamily: MONO_FONT_STACK, fontWeight: 600, color: token.colorText }}>{c.key}</span>
              <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>{c.desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* TextArea */}
      <TextArea
        ref={textAreaRef}
        value={inputValue}
        onChange={(e) => { setInputValue(e.target.value); setSlashIndex(0) }}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        placeholder={hasPendingQuestion ? t('coding.answerQuestionFirst') : isStreaming ? t('coding.waitingResponseDots') : t('coding.messagePlaceholder')}
        autoSize={{ minRows: 2, maxRows: 8 }}
        disabled={isStreaming || hasPendingQuestion}
        style={{
          borderRadius: token.borderRadiusLG,
          resize: 'none',
          background: token.colorBgContainer,
        }}
      />

      {/* Status info tags */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap', minHeight: 22 }}>
        {shortDir && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '1px 8px', borderRadius: 4, fontSize: 11, lineHeight: '18px',
            background: 'rgba(22,119,255,0.08)', color: token.colorPrimary,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240,
          }}>
            <FolderOutlined style={{ fontSize: 10 }} />
            {shortDir}
          </span>
        )}
        {gitBranch && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '1px 8px', borderRadius: 4, fontSize: 11, lineHeight: '18px',
            background: 'rgba(82,196,26,0.08)', color: '#52c41a',
            whiteSpace: 'nowrap',
          }}>
            <BranchesOutlined style={{ fontSize: 10 }} />
            {gitBranch}
          </span>
        )}
        {messageCount !== undefined && messageCount > 0 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '1px 8px', borderRadius: 4, fontSize: 11, lineHeight: '18px',
            background: 'rgba(114,46,209,0.08)', color: '#722ed1',
            whiteSpace: 'nowrap',
          }}>
            <MessageOutlined style={{ fontSize: 10 }} />
            {t('coding.turnsCount', String(messageCount))}
          </span>
        )}
        {contextUsage && ((contextUsage.usedTokens || 0) > 0 || (contextUsage.inputTokens || 0) > 0) && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '1px 8px', borderRadius: 4, fontSize: 11, lineHeight: '18px',
            background: 'rgba(19,194,194,0.08)', color: '#08979c',
            whiteSpace: 'nowrap',
          }}>
            <DashboardOutlined style={{ fontSize: 10 }} />
            {(() => {
              const used = contextUsage.usedTokens ?? ((contextUsage.inputTokens || 0) + (contextUsage.cachedInputTokens || 0))
              const total = contextUsage.contextWindow || 0
              return total > 0 ? `${Math.round((used / total) * 100)}% ctx` : `${used.toLocaleString()} ctx`
            })()}
          </span>
        )}
        {costUsd !== undefined && costUsd > 0 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '1px 8px', borderRadius: 4, fontSize: 11, lineHeight: '18px',
            background: 'rgba(250,173,20,0.08)', color: '#d48806',
            whiteSpace: 'nowrap',
          }}>
            <DollarOutlined style={{ fontSize: 10 }} />
            ${costUsd.toFixed(4)}
          </span>
        )}
      </div>
    </div>
  )
}

export default CodingInput
