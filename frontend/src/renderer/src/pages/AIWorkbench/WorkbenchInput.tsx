import React, { useState, useRef, useCallback, useLayoutEffect, useMemo, useEffect, KeyboardEvent } from 'react'
import { Input, Button, Dropdown, Tooltip, theme } from 'antd'
import {
  SendOutlined, StopOutlined, PauseCircleOutlined, PaperClipOutlined,
  CloseCircleFilled, BulbOutlined, QuestionCircleOutlined, EditOutlined,
  FolderOutlined, BranchesOutlined, DollarOutlined, MessageOutlined
} from '@ant-design/icons'
import type { AIToolType, WorkbenchMode, WorkbenchPendingFile } from '../../types/ai-workbench'

const { TextArea } = Input

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'])

// Claude Code slash commands — shown in autocomplete dropdown
const CLAUDE_SLASH_COMMANDS = [
  // ── 常用操作 ──
  { key: '/compact', label: '/compact', desc: '压缩对话上下文' },
  { key: '/clear', label: '/clear', desc: '清空对话记录' },
  { key: '/cost', label: '/cost', desc: '查看费用统计' },
  { key: '/help', label: '/help', desc: '查看帮助' },
  // ── 模式/模型 ──
  { key: '/model', label: '/model', desc: '查看/切换模型' },
  { key: '/permissions', label: '/permissions', desc: '查看/切换权限模式' },
  { key: '/plan', label: '/plan', desc: '切换到 Plan 模式' },
  // ── 代码工具 ──
  { key: '/review', label: '/review', desc: '代码审查' },
  { key: '/init', label: '/init', desc: '初始化 CLAUDE.md' },
  // ── 仅 CLI ──
  { key: '/memory', label: '/memory', desc: '管理记忆 (仅 CLI)' },
  { key: '/mcp', label: '/mcp', desc: '管理 MCP 服务器 (仅 CLI)' },
  { key: '/doctor', label: '/doctor', desc: '诊断环境 (仅 CLI)' },
]

interface WorkbenchInputProps {
  sessionId: string
  toolType: AIToolType
  isStreaming: boolean
  mode: WorkbenchMode
  hasPendingQuestion?: boolean
  workingDir?: string
  costUsd?: number
  messageCount?: number
  onSend: (text: string) => void
  onModeChange: (mode: WorkbenchMode) => void
  onInterrupt: () => void
  onStop: () => void
}

const MODES: { key: WorkbenchMode; label: string; icon: React.ReactNode }[] = [
  { key: 'plan', label: 'Plan', icon: <BulbOutlined /> },
  { key: 'ask-first', label: 'Ask First', icon: <QuestionCircleOutlined /> },
  { key: 'auto-edit', label: 'Auto Edit', icon: <EditOutlined /> },
]

const WorkbenchInput: React.FC<WorkbenchInputProps> = ({
  sessionId: _sessionId, toolType, isStreaming, mode, hasPendingQuestion, workingDir, costUsd, messageCount, onSend, onModeChange, onInterrupt, onStop
}) => {
  const [inputValue, setInputValue] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<WorkbenchPendingFile[]>([])
  const [slashIndex, setSlashIndex] = useState(-1) // selected index in inline autocomplete
  const textAreaRef = useRef<any>(null)
  const { token } = theme.useToken()

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

  // Inline slash autocomplete: show when input starts with / and tool is claude
  const slashPrefix = inputValue.startsWith('/') ? inputValue.toLowerCase() : ''
  const inlineSlashItems = useMemo(() => {
    if (!slashPrefix || toolType !== 'claude') return []
    return CLAUDE_SLASH_COMMANDS.filter(c => c.key.startsWith(slashPrefix))
  }, [slashPrefix, toolType])

  // Mode capsule refs
  const capsuleRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  const modeIndex = MODES.findIndex(m => m.key === mode)

  useLayoutEffect(() => {
    const btn = btnRefs.current[modeIndex]
    if (btn && capsuleRef.current) {
      const capsuleRect = capsuleRef.current.getBoundingClientRect()
      const btnRect = btn.getBoundingClientRect()
      setIndicator({
        left: btnRect.left - capsuleRect.left,
        width: btnRect.width,
      })
    }
  }, [modeIndex])

  const handleSend = useCallback(() => {
    const text = inputValue.trim()
    if (!text && pendingFiles.length === 0) return

    let finalText = text
    if (pendingFiles.length > 0) {
      const paths = pendingFiles.map(f => f.filePath).join(', ')
      finalText = `[附件: ${paths}]\n\n${text}`
    }

    onSend(finalText)
    setInputValue('')
    setPendingFiles([])
    setTimeout(() => textAreaRef.current?.focus(), 0)
  }, [inputValue, pendingFiles, onSend])

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
      const newFiles: WorkbenchPendingFile[] = filePaths.map(fp => {
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

  const slashMenuItems = (toolType === 'claude' ? CLAUDE_SLASH_COMMANDS : []).map(c => ({
    key: c.key,
    label: (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>{c.label}</span>
        <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>{c.desc}</span>
      </div>
    ),
    onClick: () => handleSlashCommand(c.key)
  }))

  const hasContent = inputValue.trim().length > 0 || pendingFiles.length > 0

  return (
    <div style={{ padding: '8px 16px 12px', borderTop: `1px solid ${token.colorBorderSecondary}` }}>
      {/* Toolbar row (above input) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        {/* Mode capsule (claude only) */}
        {toolType === 'claude' && (
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
            {MODES.map((m, i) => (
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
                  color: mode === m.key ? '#fff' : token.colorTextSecondary,
                  fontWeight: mode === m.key ? 500 : 400,
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

        {/* Slash commands (claude only) */}
        {slashMenuItems.length > 0 && (
          <Dropdown menu={{ items: slashMenuItems }} trigger={['click']} placement="topLeft">
            <Button
              type="text"
              size="small"
              style={{
                fontFamily: 'monospace',
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

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Streaming status */}
        {isStreaming && (
          <span style={{ color: token.colorTextSecondary, fontSize: 11 }}>
            处理中...
          </span>
        )}

        {/* Attachment button */}
        <Tooltip title="添加附件">
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
            <Tooltip title="中断当前任务">
              <Button
                size="small"
                icon={<PauseCircleOutlined />}
                onClick={onInterrupt}
              />
            </Tooltip>
            <Tooltip title="停止会话">
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
              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: token.colorText }}>{c.key}</span>
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
        placeholder={hasPendingQuestion ? '请先回答上方的问题' : isStreaming ? '等待响应中...' : '输入消息，Enter 发送，Shift+Enter 换行'}
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
            {messageCount} 轮对话
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

export default WorkbenchInput
