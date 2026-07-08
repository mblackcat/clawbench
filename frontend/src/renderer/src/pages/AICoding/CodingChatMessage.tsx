import React, { useState, useMemo } from 'react'
import { theme, Typography, Modal, Button } from 'antd'
import {
  InfoCircleOutlined,
  ToolOutlined,
  CaretRightOutlined, CaretDownOutlined,
  CheckCircleFilled, CloseCircleFilled, DashboardOutlined,
  EyeOutlined
} from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { rehypeHighlightPlugin } from '../../utils/markdown-plugins'
import { ModelAvatar, UserAvatar, toolTypeToProvider } from '../../components/ProviderIcons'
import { useAuthStore } from '../../stores/useAuthStore'
import { useT } from '../../i18n'
import { MONO_FONT_STACK } from '../../utils/mono-font'
import type { CodingMessage, CodingContentBlock, AIToolType } from '../../types/ai-coding'
import AskUserQuestionBlock from './AskUserQuestionBlock'
import TodoUpdateBlock from './TodoUpdateBlock'
import ThinkingBlock from '../../components/ThinkingBlock'
import { externalLinkMarkdownComponents } from '../../utils/markdown-links'
import '../AIChat/chat-styles.css'

const { Text } = Typography

// ── Helpers ──

function getToolSummary(name: string, input: Record<string, unknown>): string {
  const keyMap: Record<string, string> = {
    Bash: 'command', Read: 'file_path', Write: 'file_path', Edit: 'file_path',
    Grep: 'pattern', Glob: 'pattern', Task: 'description',
    WebFetch: 'url', WebSearch: 'query', NotebookEdit: 'notebook_path',
  }
  const key = keyMap[name]
  if (key && input[key] !== undefined) {
    const val = String(input[key])
    return val.length > 80 ? val.slice(0, 80) + '…' : val
  }
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.length > 0) {
      return v.length > 80 ? v.slice(0, 80) + '…' : v
    }
  }
  return ''
}

// ── Line diff (LCS) for the Edit tool ──

type DiffLine = { type: 'context' | 'add' | 'del'; text: string }

/** Compute a line-level diff between two strings via longest common subsequence. */
function computeLineDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length, m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'context', text: a[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i++ }
    else { out.push({ type: 'add', text: b[j] }); j++ }
  }
  while (i < n) { out.push({ type: 'del', text: a[i] }); i++ }
  while (j < m) { out.push({ type: 'add', text: b[j] }); j++ }
  return out
}

const DiffView: React.FC<{ filePath: string; oldText: string; newText: string; maxHeight?: number }> = ({ filePath, oldText, newText, maxHeight }) => {
  const { token } = theme.useToken()
  const lines = useMemo(() => computeLineDiff(oldText.split('\n'), newText.split('\n')), [oldText, newText])
  return (
    <div style={{ borderRadius: 4, overflow: 'hidden', border: `1px solid ${token.colorBorderSecondary}` }}>
      {filePath && (
        <div style={{
          padding: '4px 10px', fontSize: 11, color: token.colorTextSecondary,
          background: token.colorFillQuaternary, borderBottom: `1px solid ${token.colorBorderSecondary}`,
          fontFamily: MONO_FONT_STACK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}>
          {filePath}
        </div>
      )}
      <div style={{
        maxHeight, overflowY: maxHeight ? 'auto' : undefined,
        background: token.colorBgLayout, fontFamily: MONO_FONT_STACK, fontSize: 12, lineHeight: 1.5
      }}>
        {lines.map((l, i) => (
          <div key={i} style={{
            padding: '0 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            background: l.type === 'del' ? 'rgba(255, 99, 71, 0.10)' : l.type === 'add' ? 'rgba(46, 160, 67, 0.10)' : 'transparent',
            color: l.type === 'del' ? token.colorError : l.type === 'add' ? token.colorSuccess : token.colorText
          }}>
            <span style={{ display: 'inline-block', width: 14, opacity: 0.6, userSelect: 'none' }}>
              {l.type === 'del' ? '-' : l.type === 'add' ? '+' : ' '}
            </span>
            {l.text}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Compact diff preview with a button to open the full diff in a modal. */
const EditDiffPreview: React.FC<{ filePath: string; oldText: string; newText: string }> = ({ filePath, oldText, newText }) => {
  const { token } = theme.useToken()
  const t = useT()
  const [open, setOpen] = useState(false)
  const stats = useMemo(() => {
    let add = 0, del = 0
    for (const l of computeLineDiff(oldText.split('\n'), newText.split('\n'))) {
      if (l.type === 'add') add++
      else if (l.type === 'del') del++
    }
    return { add, del }
  }, [oldText, newText])

  return (
    <div>
      <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
        <span style={{ color: token.colorSuccess, fontWeight: 500 }}>+{stats.add}</span>
        <span style={{ color: token.colorError, fontWeight: 580 }}>-{stats.del}</span>
        <Button
          type="link"
          size="small"
          style={{ fontSize: 11, padding: 0, height: 'auto' }}
          icon={<EyeOutlined />}
          onClick={() => setOpen(true)}
        >
          {t('coding.viewFullDiff')}
        </Button>
      </div>
      <DiffView filePath={filePath} oldText={oldText} newText={newText} maxHeight={200} />
      <Modal
        title={t('coding.diffTitle')}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width="min(900px, 90vw)"
        destroyOnClose
      >
        <div style={{ maxHeight: '70vh', overflow: 'auto' }}>
          <DiffView filePath={filePath} oldText={oldText} newText={newText} />
        </div>
      </Modal>
    </div>
  )
}

// ── Tool-specific Input Renderer ──

function renderToolInput(name: string, input: Record<string, unknown>, token: any): React.ReactNode {
  const lowerName = name.toLowerCase()

  // Bash / execute_command
  if (lowerName === 'bash' || lowerName === 'execute_command') {
    const cmd = input.command as string || ''
    return (
      <div>
        <pre style={{
          margin: 0, padding: '8px 10px', fontSize: 11, fontFamily: MONO_FONT_STACK,
          background: token.colorFillQuaternary, borderRadius: 4,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all'
        }}>
          {cmd}
        </pre>
      </div>
    )
  }

  // Edit — real line diff + full-diff modal
  if (lowerName === 'edit') {
    const filePath = String(input.file_path || '')
    const oldStr = String(input.old_string || '')
    const newStr = String(input.new_string || '')
    if (oldStr || newStr) {
      return <EditDiffPreview filePath={filePath} oldText={oldStr} newText={newStr} />
    }
  }

  // Read
  if (lowerName === 'read') {
    const filePath = String(input.file_path || '')
    const offset = input.offset ? ` (line ${input.offset})` : ''
    return (
      <div style={{ fontSize: 11, padding: '4px 0' }}>
        Reading <code style={{ fontSize: 11, padding: '1px 4px', background: token.colorFillQuaternary, borderRadius: 3 }}>{filePath}</code>{offset}
      </div>
    )
  }

  // Write
  if (lowerName === 'write') {
    const filePath = String(input.file_path || '')
    const content = String(input.content || '')
    const lines = content.split('\n')
    const preview = lines.slice(0, 30).join('\n')
    const truncated = lines.length > 30
    return (
      <div>
        <div style={{ fontSize: 11, marginBottom: 4 }}>
          Writing <code style={{ fontSize: 11, padding: '1px 4px', background: token.colorFillQuaternary, borderRadius: 3 }}>{filePath}</code>
        </div>
        <pre style={{
          margin: 0, padding: '6px 8px', fontSize: 11, fontFamily: MONO_FONT_STACK,
          background: token.colorFillQuaternary, borderRadius: 4,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto'
        }}>
          {preview}{truncated ? `\n... (${lines.length - 30} more lines)` : ''}
        </pre>
      </div>
    )
  }

  // Grep / Glob
  if (lowerName === 'grep' || lowerName === 'glob') {
    const pattern = String(input.pattern || '')
    const path = input.path ? ` in ${input.path}` : ''
    return (
      <div style={{ fontSize: 11, padding: '4px 0' }}>
        {lowerName === 'grep' ? 'Searching' : 'Finding files'}: <code style={{ fontSize: 11, padding: '1px 4px', background: token.colorFillQuaternary, borderRadius: 3 }}>{pattern}</code>{path}
      </div>
    )
  }

  // Default: formatted JSON
  return <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(input, null, 2)}</div>
}

// ── Tool Call Block (merged tool_use + tool_result) ──

type ToolToggleHandler = () => void

const AnimatedToolBody: React.FC<{ expanded: boolean; children: React.ReactNode }> = ({ expanded, children }) => (
  <div style={{
    display: 'grid',
    gridTemplateRows: expanded ? '1fr' : '0fr',
    opacity: expanded ? 1 : 0,
    transition: 'grid-template-rows 180ms ease, opacity 140ms ease',
  }}>
    <div style={{ minHeight: 0, overflow: 'hidden' }}>
      {children}
    </div>
  </div>
)

const ToolCallBlock: React.FC<{
  name: string
  input: Record<string, unknown>
  result?: { content: string; isError?: boolean }
  onToggle?: ToolToggleHandler
}> = ({ name, input, result, onToggle }) => {
  const [expanded, setExpanded] = useState(false)
  const { token } = theme.useToken()
  const t = useT()
  const summary = getToolSummary(name, input)

  return (
    <div style={{
      marginBottom: 6, borderRadius: token.borderRadiusSM,
      border: `1px solid ${result?.isError ? token.colorErrorBorder : token.colorBorderSecondary}`,
      overflow: 'hidden'
    }}>
      <div
        onClick={() => {
          onToggle?.()
          setExpanded(prev => !prev)
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', cursor: 'pointer',
          background: result?.isError ? token.colorErrorBg : token.colorFillQuaternary,
          fontSize: 12
        }}
      >
        {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
        {result ? (
          result.isError
            ? <CloseCircleFilled style={{ color: token.colorError, fontSize: 13 }} />
            : <CheckCircleFilled style={{ color: token.colorSuccess, fontSize: 13 }} />
        ) : (
          <ToolOutlined style={{ color: token.colorPrimary }} />
        )}
        <span style={{ fontWeight: 500 }}>{name}</span>
        {summary && (
          <span style={{
            color: token.colorTextSecondary, fontSize: 11,
            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {summary}
          </span>
        )}
      </div>
      <AnimatedToolBody expanded={expanded}>
        <div style={{
          padding: '6px 10px', fontSize: 11, fontFamily: MONO_FONT_STACK,
          background: token.colorBgLayout, whiteSpace: 'pre-wrap',
          wordBreak: 'break-all', maxHeight: 300, overflow: 'auto'
        }}>
          <div>{renderToolInput(name, input, token)}</div>
          {result && (
            <div style={{
              borderTop: `1px solid ${token.colorBorderSecondary}`,
              marginTop: 6, paddingTop: 6
            }}>
              <div style={{ fontSize: 10, color: token.colorTextTertiary, marginBottom: 4 }}>
                {t('coding.toolResultLabel', name)}
              </div>
              <div style={{ color: result.isError ? token.colorError : undefined }}>
                {result.content}
              </div>
            </div>
          )}
        </div>
      </AnimatedToolBody>
    </div>
  )
}

// ── Standalone Tool Result Block (unpaired) ──

const ToolResultBlock: React.FC<{ content: string; isError?: boolean; onToggle?: ToolToggleHandler }> = ({ content, isError, onToggle }) => {
  const [expanded, setExpanded] = useState(false)
  const { token } = theme.useToken()
  const t = useT()
  const preview = content.length > 100 ? content.slice(0, 100) + '…' : content

  return (
    <div style={{
      marginBottom: 6, borderRadius: token.borderRadiusSM,
      border: `1px solid ${isError ? token.colorErrorBorder : token.colorBorderSecondary}`, overflow: 'hidden'
    }}>
      <div
        onClick={() => {
          onToggle?.()
          setExpanded(prev => !prev)
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', cursor: 'pointer',
          background: isError ? token.colorErrorBg : token.colorFillQuaternary, fontSize: 12
        }}
      >
        {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
        {isError
          ? <CloseCircleFilled style={{ color: token.colorError, fontSize: 13 }} />
          : <CheckCircleFilled style={{ color: token.colorSuccess, fontSize: 13 }} />
        }
        <span style={{ color: isError ? token.colorError : token.colorTextSecondary }}>
          {isError ? t('coding.toolError') : t('coding.toolResult')}
        </span>
        {!expanded && <span style={{ color: token.colorTextQuaternary, fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview}</span>}
      </div>
      <AnimatedToolBody expanded={expanded}>
        <div style={{
          padding: '6px 10px', fontSize: 11, fontFamily: MONO_FONT_STACK,
          background: token.colorBgLayout, whiteSpace: 'pre-wrap',
          wordBreak: 'break-all', maxHeight: 300, overflow: 'auto'
        }}>
          {content}
        </div>
      </AnimatedToolBody>
    </div>
  )
}

const ContextUsageBlock: React.FC<Extract<CodingContentBlock, { type: 'context_usage' }>> = (block) => {
  const { token } = theme.useToken()
  const used = block.usedTokens ?? ((block.inputTokens || 0) + (block.cachedInputTokens || 0))
  const total = block.contextWindow || 0
  const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : null
  const label = percent !== null
    ? `${used.toLocaleString()} / ${total.toLocaleString()} tokens (${percent}%)`
    : `${used.toLocaleString()} context tokens`

  if (!used && !block.outputTokens && !total) return null

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 8px', margin: '2px 0 8px',
      borderRadius: 4, fontSize: 11,
      color: token.colorTextSecondary,
      background: token.colorFillQuaternary,
    }}>
      <DashboardOutlined style={{ fontSize: 12 }} />
      <span>{label}</span>
      {!!block.outputTokens && <span>+{block.outputTokens.toLocaleString()} out</span>}
    </div>
  )
}

// ── Content Block Renderer (for text/thinking/raw_output) ──

const ContentBlockRenderer: React.FC<{ block: CodingContentBlock; markdownRenderKey?: number }> = ({ block, markdownRenderKey }) => {
  const { token } = theme.useToken()

  switch (block.type) {
    case 'text':
      return (
        <div className="markdown-body" style={{ fontSize: 13, lineHeight: 1.7 }}>
          <ReactMarkdown
            key={markdownRenderKey}
            rehypePlugins={[rehypeHighlightPlugin]}
            remarkPlugins={[remarkGfm]}
            urlTransform={(url) => url}
            components={externalLinkMarkdownComponents}
          >
            {block.text}
          </ReactMarkdown>
        </div>
      )
    case 'thinking':
      return <ThinkingBlock content={block.text} />
    case 'raw_output':
      return (
        <div style={{
          fontFamily: MONO_FONT_STACK, fontSize: 12, lineHeight: 1.5,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          color: token.colorText, padding: '4px 0'
        }}>
          {block.text}
        </div>
      )
    case 'context_usage':
      return <ContextUsageBlock {...block} />
    default:
      return null
  }
}

// ── Render blocks with tool_use + tool_result pairing ──

function renderAssistantBlocks(blocks: CodingContentBlock[], sessionId: string, onToolToggle?: ToolToggleHandler, markdownRenderKey?: number): React.ReactNode[] {
  // Build a map: tool_use.id → tool_result
  const resultMap = new Map<string, { content: string; isError?: boolean }>()
  for (const b of blocks) {
    if (b.type === 'tool_result') {
      resultMap.set(b.toolUseId, { content: b.content, isError: b.isError })
    }
  }

  const pairedIds = new Set<string>()
  const nodes: React.ReactNode[] = []

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type === 'tool_use') {
      const tr = resultMap.get(b.id)
      if (tr) pairedIds.add(b.id)
      nodes.push(<ToolCallBlock key={i} name={b.name} input={b.input} result={tr} onToggle={onToolToggle} />)
    } else if (b.type === 'tool_result') {
      if (pairedIds.has(b.toolUseId)) continue // already rendered with tool_use
      nodes.push(<ToolResultBlock key={i} content={b.content} isError={b.isError} onToggle={onToolToggle} />)
    } else if (b.type === 'ask_user_question') {
      nodes.push(
        <AskUserQuestionBlock
          key={i}
          questionId={b.id}
          questions={b.questions}
          sessionId={sessionId}
          answered={b.answered}
          answerText={b.answerText}
        />
      )
    } else if (b.type === 'todo_update') {
      nodes.push(<TodoUpdateBlock key={i} todos={b.todos} />)
    } else {
      nodes.push(<ContentBlockRenderer key={i} block={b} markdownRenderKey={markdownRenderKey} />)
    }
  }

  return nodes
}

// ── Main Component ──

interface CodingChatMessageProps {
  message: CodingMessage
  onToolToggle?: ToolToggleHandler
  markdownRenderKey?: number
  toolType?: AIToolType
}

const CodingChatMessage: React.FC<CodingChatMessageProps> = ({ message, onToolToggle, markdownRenderKey, toolType }) => {
  const { token } = theme.useToken()
  const user = useAuthStore((s) => s.user)

  if (message.role === 'system') {
    return (
      <div style={{ padding: '4px 16px', display: 'flex', justifyContent: 'center' }}>
        <Text style={{ fontSize: 12, color: token.colorTextQuaternary }}>
          <InfoCircleOutlined style={{ marginRight: 4 }} />
          {message.blocks.map(b => b.type === 'text' ? b.text : '').join('')}
        </Text>
      </div>
    )
  }

  const isUser = message.role === 'user'

  return (
    <div style={{ padding: '8px 16px', display: 'flex', gap: 10 }}>
      {/* Avatar */}
      {isUser
        ? (
          <UserAvatar
            size={28}
            primaryColor={token.colorPrimary}
            avatarUrl={user?.avatarUrl || undefined}
            userName={user?.name}
            userId={user?.id}
          />
        )
        : <ModelAvatar provider={toolTypeToProvider(toolType || 'claude')} size={28} />
      }

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {isUser ? (
          // User message: bubble style — render text directly (no ReactMarkdown)
          <div style={{
            display: 'inline-block',
            padding: '6px 12px',
            borderRadius: '12px 12px 12px 4px',
            background: token.colorPrimaryBg,
            color: token.colorText,
            maxWidth: '85%',
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            fontSize: 13, lineHeight: 1.6
          }}>
            {message.blocks.map(b => b.type === 'text' ? b.text : '').join('')}
          </div>
        ) : (
          // Assistant message: paired tool blocks + content
          <div style={{ maxWidth: '100%' }}>
            {renderAssistantBlocks(message.blocks, message.sessionId, onToolToggle, markdownRenderKey)}
            {message.costUsd !== undefined && message.costUsd > 0 && (
              <Text style={{ fontSize: 11, color: token.colorTextQuaternary }}>
                Cost: ${message.costUsd.toFixed(4)}
              </Text>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export { getToolSummary }
// Memoized so a streaming token (which only changes the streaming preview, not
// finalized messages) doesn't re-render — and re-parse markdown for — every
// historical message in the list.
export default React.memo(CodingChatMessage)
