import React, { useState } from 'react'
import { theme, Typography } from 'antd'
import {
  InfoCircleOutlined,
  ToolOutlined,
  CaretRightOutlined, CaretDownOutlined,
  CheckCircleFilled, CloseCircleFilled
} from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { rehypeHighlightPlugin } from '../../utils/markdown-plugins'
import { ModelAvatar, UserAvatar } from '../../components/ProviderIcons'
import { useT } from '../../i18n'
import type { WorkbenchMessage, WorkbenchContentBlock } from '../../types/ai-workbench'
import AskUserQuestionBlock from './AskUserQuestionBlock'
import TodoUpdateBlock from './TodoUpdateBlock'
import ThinkingBlock from '../../components/ThinkingBlock'
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

// ── Inline Diff View for Edit tool ──

const InlineDiffView: React.FC<{ filePath: string; oldText: string; newText: string }> = ({ filePath, oldText, newText }) => {
  const { token } = theme.useToken()
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')

  return (
    <div style={{ fontSize: 12, fontFamily: 'monospace', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{
        padding: '4px 8px', fontSize: 11, color: token.colorTextSecondary,
        background: token.colorFillQuaternary, borderBottom: `1px solid ${token.colorBorderSecondary}`
      }}>
        {filePath}
      </div>
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {oldLines.map((line, i) => (
          <div key={`old-${i}`} style={{
            padding: '1px 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            background: 'rgba(255, 99, 71, 0.1)', color: token.colorError
          }}>
            - {line}
          </div>
        ))}
        {newLines.map((line, i) => (
          <div key={`new-${i}`} style={{
            padding: '1px 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            background: 'rgba(46, 160, 67, 0.1)', color: token.colorSuccess
          }}>
            + {line}
          </div>
        ))}
      </div>
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
          margin: 0, padding: '8px 10px', fontSize: 11, fontFamily: 'monospace',
          background: token.colorFillQuaternary, borderRadius: 4,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all'
        }}>
          {cmd}
        </pre>
      </div>
    )
  }

  // Edit — show inline diff
  if (lowerName === 'edit') {
    const filePath = String(input.file_path || '')
    const oldStr = String(input.old_string || '')
    const newStr = String(input.new_string || '')
    if (oldStr || newStr) {
      return <InlineDiffView filePath={filePath} oldText={oldStr} newText={newStr} />
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
          margin: 0, padding: '6px 8px', fontSize: 11, fontFamily: 'monospace',
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

const ToolCallBlock: React.FC<{
  name: string
  input: Record<string, unknown>
  result?: { content: string; isError?: boolean }
}> = ({ name, input, result }) => {
  const [expanded, setExpanded] = useState(false)
  const { token } = theme.useToken()
  const summary = getToolSummary(name, input)

  return (
    <div style={{
      marginBottom: 6, borderRadius: token.borderRadiusSM,
      border: `1px solid ${result?.isError ? token.colorErrorBorder : token.colorBorderSecondary}`,
      overflow: 'hidden'
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
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
      {expanded && (
        <div style={{
          padding: '6px 10px', fontSize: 11, fontFamily: 'monospace',
          background: token.colorBgLayout, whiteSpace: 'pre-wrap',
          wordBreak: 'break-all', maxHeight: 300, overflow: 'auto'
        }}>
          <div>{renderToolInput(name, input, token)}</div>
          {result && (
            <div style={{
              borderTop: `1px solid ${token.colorBorderSecondary}`,
              marginTop: 6, paddingTop: 6,
              color: result.isError ? token.colorError : undefined
            }}>
              {result.content}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Standalone Tool Result Block (unpaired) ──

const ToolResultBlock: React.FC<{ content: string; isError?: boolean }> = ({ content, isError }) => {
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
        onClick={() => setExpanded(!expanded)}
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
      {expanded && (
        <div style={{
          padding: '6px 10px', fontSize: 11, fontFamily: 'monospace',
          background: token.colorBgLayout, whiteSpace: 'pre-wrap',
          wordBreak: 'break-all', maxHeight: 300, overflow: 'auto'
        }}>
          {content}
        </div>
      )}
    </div>
  )
}

// ── Content Block Renderer (for text/thinking/raw_output) ──

const ContentBlockRenderer: React.FC<{ block: WorkbenchContentBlock }> = ({ block }) => {
  const { token } = theme.useToken()

  switch (block.type) {
    case 'text':
      return (
        <div className="markdown-body" style={{ fontSize: 13, lineHeight: 1.7 }}>
          <ReactMarkdown
            rehypePlugins={[rehypeHighlightPlugin]}
            remarkPlugins={[remarkGfm]}
            urlTransform={(url) => url}
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
          fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          color: token.colorText, padding: '4px 0'
        }}>
          {block.text}
        </div>
      )
    default:
      return null
  }
}

// ── Render blocks with tool_use + tool_result pairing ──

function renderAssistantBlocks(blocks: WorkbenchContentBlock[], sessionId: string): React.ReactNode[] {
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
      nodes.push(<ToolCallBlock key={i} name={b.name} input={b.input} result={tr} />)
    } else if (b.type === 'tool_result') {
      if (pairedIds.has(b.toolUseId)) continue // already rendered with tool_use
      nodes.push(<ToolResultBlock key={i} content={b.content} isError={b.isError} />)
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
      nodes.push(<ContentBlockRenderer key={i} block={b} />)
    }
  }

  return nodes
}

// ── Main Component ──

interface WorkbenchChatMessageProps {
  message: WorkbenchMessage
}

const WorkbenchChatMessage: React.FC<WorkbenchChatMessageProps> = ({ message }) => {
  const { token } = theme.useToken()

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
        ? <UserAvatar size={28} primaryColor={token.colorPrimary} />
        : <ModelAvatar provider="openai" size={28} />
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
            {renderAssistantBlocks(message.blocks, message.sessionId)}
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
export default WorkbenchChatMessage
