import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Input, Button, Typography, theme, Space, Tooltip, Spin } from 'antd'
import {
  SendOutlined, StopOutlined, ThunderboltOutlined,
  HourglassOutlined, ClearOutlined, ControlOutlined,
  UpOutlined, DownOutlined, RobotOutlined,
  LoadingOutlined, CheckCircleOutlined,
  CloseCircleOutlined, CodeOutlined, ToolOutlined,
  PlayCircleOutlined, ConsoleSqlOutlined
} from '@ant-design/icons'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import { useAIModelStore } from '../../stores/useAIModelStore'
import { useT } from '../../i18n'
import type { TerminalAIMessage } from '../../types/ai-terminal'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { rehypeHighlightPlugin } from '../../utils/markdown-plugins'
import ModelSelector from '../AIChat/ModelSelector'
import { ModelAvatar, UserAvatar } from '../../components/ProviderIcons'
import ThinkingBlock from '../../components/ThinkingBlock'
import '../AIChat/chat-styles.css'

const { TextArea } = Input
const { Text } = Typography

// Terminal tools
const TERMINAL_TOOLS = [
  {
    name: 'terminal_execute',
    description: '在当前终端中执行一条命令并等待输出。命令会被输入到终端中，等输出稳定后返回完整结果。适用于需要查看执行结果的场景。注意：一次只执行一条命令，复杂流程请分步调用。',
    inputSchema: {
      type: 'object' as const,
      properties: { command: { type: 'string', description: '要执行的完整命令（单条）' } },
      required: ['command']
    }
  },
  {
    name: 'terminal_read_output',
    description: '读取当前终端的最新输出内容（最多3000字符）。用于在执行命令前了解当前终端状态，或在命令执行后检查结果。',
    inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] }
  }
]

// DB tools
const DB_TOOLS = [
  {
    name: 'db_query',
    description: '在当前数据库连接上执行只读查询（SELECT/SHOW/DESCRIBE/EXPLAIN 等），返回列名和数据行。结果最多展示前50行。',
    inputSchema: {
      type: 'object' as const,
      properties: { sql: { type: 'string', description: '要执行的只读 SQL 查询语句' } },
      required: ['sql']
    }
  },
  {
    name: 'db_execute',
    description: '在当前数据库连接上执行写操作（INSERT/UPDATE/DELETE/CREATE/ALTER/DROP 等），返回影响行数。高危操作前务必先用 db_query 确认影响范围。',
    inputSchema: {
      type: 'object' as const,
      properties: { sql: { type: 'string', description: '要执行的写操作 SQL 语句' } },
      required: ['sql']
    }
  },
  {
    name: 'db_get_tables',
    description: '获取当前数据库的所有表（关系型）或集合（MongoDB）列表。连接后首先调用此工具了解数据库结构。',
    inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] }
  },
  {
    name: 'db_get_schema',
    description: '获取指定表的完整结构信息，包括列名、数据类型、是否主键、是否可空、默认值等。编写查询前建议先调用此工具确认字段信息。',
    inputSchema: {
      type: 'object' as const,
      properties: { table: { type: 'string', description: '表名' } },
      required: ['table']
    }
  }
]

// Tool display name mapping
const TOOL_LABELS: Record<string, string> = {
  terminal_execute: '执行命令',
  terminal_read_output: '读取终端',
  db_query: '查询数据',
  db_execute: '执行 SQL',
  db_get_tables: '获取表列表',
  db_get_schema: '获取表结构',
}

// Streaming tool call state
interface StreamingToolCall {
  id: string
  name: string
  input: Record<string, any>
  status: 'running' | 'completed' | 'error'
  result?: string
}

// ── ToolCallCard (compact inline) ───────────────────────────────────────────
function ToolCallInline({ tc }: { tc: StreamingToolCall | NonNullable<TerminalAIMessage['toolCalls']>[number] }) {
  const { token } = theme.useToken()
  const [expanded, setExpanded] = useState(false)
  const status = 'status' in tc ? tc.status : (tc.isError ? 'error' : (tc.result !== undefined ? 'completed' : 'running'))
  const label = TOOL_LABELS[tc.name] || tc.name
  const preview = tc.input?.command || tc.input?.sql || tc.input?.table || ''

  return (
    <div style={{
      marginBottom: 4,
      borderRadius: 6,
      border: `1px solid ${token.colorBorderSecondary}`,
      overflow: 'hidden',
      fontSize: 11,
    }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 8px',
          background: token.colorFillQuaternary,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <ToolOutlined style={{ fontSize: 10, color: token.colorTextSecondary }} />
        <span style={{ flex: 1, fontWeight: 500 }}>{label}</span>
        {status === 'running' && <LoadingOutlined style={{ fontSize: 10, color: token.colorPrimary }} />}
        {status === 'completed' && <CheckCircleOutlined style={{ fontSize: 10, color: token.colorSuccess }} />}
        {status === 'error' && <CloseCircleOutlined style={{ fontSize: 10, color: token.colorError }} />}
      </div>
      {/* Command/SQL preview */}
      {preview && (
        <div style={{
          padding: '3px 8px',
          background: token.colorFillTertiary,
          fontSize: 11,
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 4,
        }}>
          <CodeOutlined style={{ fontSize: 10, color: token.colorTextSecondary, marginTop: 2, flexShrink: 0 }} />
          <span>{typeof preview === 'string' && preview.length > 120 ? preview.slice(0, 120) + '...' : preview}</span>
        </div>
      )}
      {/* Expanded result */}
      {expanded && tc.result && (
        <div style={{
          padding: '4px 8px',
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          fontSize: 10,
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          maxHeight: 100,
          overflowY: 'auto',
          color: status === 'error' ? token.colorError : token.colorTextSecondary,
          wordBreak: 'break-all',
        }}>
          {tc.result.length > 500 ? tc.result.slice(0, 500) + '...' : tc.result}
        </div>
      )}
    </div>
  )
}

// ── MessageBubble ───────────────────────────────────────────────────────────
function MessageBubble({ msg, isStreaming, streamingContent, streamingThinking, streamingTools }: {
  msg?: TerminalAIMessage
  isStreaming?: boolean
  streamingContent?: string
  streamingThinking?: string
  streamingTools?: StreamingToolCall[]
}) {
  const { token } = theme.useToken()
  const t = useT()
  const isUser = msg?.role === 'user'
  const content = msg?.content ?? streamingContent ?? ''
  const thinking = msg?.thinking ?? streamingThinking ?? ''
  const toolCalls = msg?.toolCalls ?? []
  const sTools = streamingTools ?? []

  return (
    <div style={{
      display: 'flex',
      gap: 6,
      marginBottom: 8,
      alignItems: 'flex-start',
    }}>
      {/* Avatar */}
      <div style={{ flexShrink: 0, marginTop: 1 }}>
        {isUser
          ? <UserAvatar size={22} primaryColor={token.colorPrimary} />
          : <ModelAvatar provider="openai" size={22} />
        }
      </div>

      {/* Bubble - fit content width */}
      <div style={{
        maxWidth: 'calc(100% - 30px)',
        background: isUser ? token.colorPrimaryBg : token.colorFillSecondary,
        padding: '5px 10px',
        borderRadius: 10,
        borderTopLeftRadius: isUser ? 10 : 3,
        lineHeight: 1.5,
        wordBreak: 'break-word',
        overflow: 'hidden',
      }}>
        {/* Thinking block */}
        {thinking && (
          <ThinkingBlock content={thinking} isStreaming={isStreaming && !content} compact />
        )}

        {/* Tool calls */}
        {sTools.length > 0 && (
          <div style={{ marginBottom: content ? 6 : 0 }}>
            {sTools.map(tc => <ToolCallInline key={tc.id} tc={tc} />)}
          </div>
        )}
        {!isStreaming && toolCalls.length > 0 && (
          <div style={{ marginBottom: content ? 6 : 0 }}>
            {toolCalls.map(tc => <ToolCallInline key={tc.id} tc={tc} />)}
          </div>
        )}

        {/* Content */}
        {isUser ? (
          <div style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{content}</div>
        ) : (
          <div className="markdown-body" style={{ fontSize: 12 }}>
            {isStreaming && !content && !thinking && sTools.length === 0 ? (
              <span className="streaming-status" style={{ fontSize: 11 }}>
                <span className="streaming-status-dot" />
                <span>{t('coding.thinking')}</span>
              </span>
            ) : content ? (
              <>
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlightPlugin]}>
                  {content}
                </ReactMarkdown>
                {isStreaming && <span className="cursor-blink">|</span>}
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────
const AIAssistantPanel: React.FC = () => {
  const { token } = theme.useToken()
  const t = useT()
  const [inputValue, setInputValue] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [chatMode, setChatMode] = useState<'fast' | 'thinking'>('fast')
  const [toolsEnabled, setToolsEnabled] = useState(true)
  const [bottomTab, setBottomTab] = useState<'ai' | 'sql'>('ai')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // SQL Executor state
  const [sqlInput, setSqlInput] = useState('')
  const [sqlError, setSqlError] = useState<string | null>(null)

  // Streaming state — use refs + forceUpdate for real-time rendering without stale closures
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  const streamingContentRef = useRef('')
  const streamingThinkingRef = useRef('')
  const streamingToolsRef = useRef<StreamingToolCall[]>([])
  const cancelledRef = useRef(false)
  const currentTaskIdRef = useRef<string | null>(null)
  // Stored reject function to break streamOneRound Promise on cancel
  const rejectStreamRef = useRef<((err: Error) => void) | null>(null)

  const {
    activeTabId, activeDBTabId, sideMode, openDBTabs,
    aiMessages, aiStreaming, selectedText,
    addAIMessage, setAIStreaming, setAITaskId, aiTaskId,
    setSelectedText, openDBQuery
  } = useAITerminalStore()

  const {
    selectedModelId, selectedModelSource, selectedModelConfigId,
    fetchBuiltinModels, fetchLocalModels, initializeSelectedModel
  } = useAIModelStore()

  // Initialize models (same as AI Chat)
  useEffect(() => {
    Promise.all([fetchBuiltinModels(), fetchLocalModels()]).then(() => {
      initializeSelectedModel()
    })
  }, [fetchBuiltinModels, fetchLocalModels, initializeSelectedModel])

  const isDBMode = sideMode === 'db'
  const effectiveTabId = isDBMode ? activeDBTabId : activeTabId
  const currentMessages = effectiveTabId ? (aiMessages[effectiveTabId] || []) : []

  // Get current DB connection ID
  const currentDBTab = isDBMode ? openDBTabs.find(t => t.id === activeDBTabId) : null
  const currentDBConnId = currentDBTab?.connectionId

  // Auto-scroll on message changes and streaming updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentMessages, streamingContentRef.current, streamingThinkingRef.current, streamingToolsRef.current])

  /**
   * Execute a single tool call locally and return the result.
   */
  const executeTool = useCallback(async (
    toolName: string, input: Record<string, any>, tabId: string, dbConnId?: string
  ): Promise<{ result: string; isError: boolean }> => {
    try {
      if (toolName === 'terminal_execute') {
        const execResult = await window.api.aiTerminal.aiExecuteCommand(tabId, input.command as string)
        return {
          result: execResult.success ? (execResult.output || '命令已执行') : (execResult.error || '执行失败'),
          isError: !execResult.success
        }
      } else if (toolName === 'terminal_read_output') {
        const output = await window.api.aiTerminal.getTerminalOutput(tabId)
        return { result: output.slice(-3000) || '(无输出)', isError: false }
      } else if (toolName === 'db_query' && dbConnId) {
        const qResult = await window.api.aiTerminal.queryDB(dbConnId, input.sql as string)
        const maxRows = qResult.rows.slice(0, 50)
        return {
          result: JSON.stringify({ columns: qResult.columns, rows: maxRows, totalRows: qResult.rows.length, executionTimeMs: qResult.executionTimeMs }, null, 2),
          isError: false
        }
      } else if (toolName === 'db_execute' && dbConnId) {
        const eResult = await window.api.aiTerminal.executeDB(dbConnId, input.sql as string)
        return { result: JSON.stringify(eResult), isError: false }
      } else if (toolName === 'db_get_tables' && dbConnId) {
        const tables = await window.api.aiTerminal.getDBTables(dbConnId)
        return { result: JSON.stringify(tables), isError: false }
      } else if (toolName === 'db_get_schema' && dbConnId) {
        const schema = await window.api.aiTerminal.getDBTableSchema(dbConnId, input.table as string)
        return { result: JSON.stringify(schema, null, 2), isError: false }
      }
      return { result: '未知工具或缺少连接', isError: true }
    } catch (err: any) {
      return { result: err.message || String(err), isError: true }
    }
  }, [])

  /**
   * Run one round of streaming. Returns:
   * - { type: 'done' } when the stream finishes normally
   * - { type: 'tool_use', ... } when the AI wants to call a tool
   */
  const streamOneRound = useCallback((
    configId: string,
    messages: Array<any>,
    modelId: string,
    tools: any[] | undefined,
    enableThinking: boolean
  ): Promise<{
    type: 'done'
    content: string
    thinking: string
  } | {
    type: 'tool_use'
    content: string
    thinking: string
    toolCallId: string
    toolName: string
    toolInput: Record<string, any>
  }> => {
    return new Promise(async (resolve, reject) => {
      try {
        const taskId = await window.api.ai.streamChat(
          configId, messages, modelId, undefined, tools, enableThinking
        )
        setAITaskId(taskId)
        currentTaskIdRef.current = taskId

        let roundContent = ''
        let roundThinking = ''

        const cleanupDelta = window.api.ai.onChatDelta(({ taskId: tid, content }) => {
          if (tid === taskId) {
            roundContent += content
            streamingContentRef.current += content
            forceUpdate()
          }
        })

        const cleanupThinking = window.api.ai.onChatThinkingDelta(({ taskId: tid, content }) => {
          if (tid === taskId) {
            roundThinking += content
            streamingThinkingRef.current += content
            forceUpdate()
          }
        })

        const cleanupDone = window.api.ai.onChatDone(({ taskId: tid }) => {
          if (tid === taskId) {
            cleanup()
            resolve({ type: 'done', content: roundContent, thinking: roundThinking })
          }
        })

        const cleanupError = window.api.ai.onChatError(({ taskId: tid, error }) => {
          if (tid === taskId) {
            cleanup()
            reject(new Error(error))
          }
        })

        const cleanupToolUse = window.api.ai.onChatToolUse((data) => {
          if (data.taskId === taskId) {
            cleanup()
            resolve({
              type: 'tool_use',
              content: roundContent,
              thinking: roundThinking,
              toolCallId: data.toolCallId,
              toolName: data.toolName,
              toolInput: data.input,
            })
          }
        })

        function cleanup() {
          rejectStreamRef.current = null
          cleanupDelta()
          cleanupThinking()
          cleanupDone()
          cleanupError()
          cleanupToolUse()
        }

        // Store a cancel handler so handleCancel can break this Promise
        rejectStreamRef.current = (err: Error) => {
          cleanup()
          reject(err)
        }
      } catch (err) {
        reject(err)
      }
    })
  }, [forceUpdate])

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || !effectiveTabId || aiStreaming) return

    const userMsg: TerminalAIMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: inputValue,
      timestamp: Date.now()
    }
    addAIMessage(effectiveTabId, userMsg)
    setInputValue('')
    setAIStreaming(true)

    // Reset streaming state
    streamingContentRef.current = ''
    streamingThinkingRef.current = ''
    streamingToolsRef.current = []
    cancelledRef.current = false
    currentTaskIdRef.current = null
    forceUpdate()

    try {
      let systemContent: string
      let tools: typeof TERMINAL_TOOLS | typeof DB_TOOLS | undefined

      if (isDBMode && currentDBConnId) {
        const conn = useAITerminalStore.getState().dbConnections.find(c => c.id === currentDBConnId)
        const tables = useAITerminalStore.getState().dbTables[currentDBConnId] || []
        const dbTypeMap: Record<string, string> = {
          mysql: 'MySQL', postgres: 'PostgreSQL', mongodb: 'MongoDB', sqlite: 'SQLite'
        }
        const dbTypeName = dbTypeMap[conn?.type || ''] || conn?.type || '未知'
        systemContent = [
          `你是一名顶级数据库专家（DBA），精通 ${dbTypeName} 的所有特性、语法和最佳实践。`,
          '',
          '## 你的核心能力',
          '- 编写高效、安全的 SQL 查询和数据操作语句',
          '- 分析表结构，给出优化建议（索引、分区、规范化）',
          '- 排查慢查询、死锁、数据不一致等常见问题',
          '- 协助数据迁移、备份恢复方案设计',
          '',
          '## 安全准则（必须严格遵守）',
          '1. **危险操作前必须警告用户**：DROP TABLE/DATABASE、TRUNCATE、DELETE 无 WHERE、ALTER 大表等，必须先说明风险并得到确认',
          '2. **高危操作提供回滚方案**：执行前先告知如何回滚（如先 SELECT 验证范围、提供 BEGIN/ROLLBACK 事务包装）',
          '3. **永远不要猜测数据**：不确定时先用 db_get_tables / db_get_schema 查看实际结构',
          '4. **大批量操作要分批**：UPDATE/DELETE 大量数据时建议分批执行，避免锁表',
          '5. **敏感数据脱敏**：查询结果含密码、Token 等敏感字段时提醒用户注意',
          '',
          '## 回复风格',
          '- 简洁专业，先给结论再解释原因',
          '- SQL 语句用代码块展示，关键字大写',
          '- 复杂查询附带简要注释',
          '',
          '## 当前环境',
          `- 数据库类型: ${dbTypeName}`,
          `- 数据库名: ${conn?.database || conn?.filePath || '未指定'}`,
          `- 连接: ${conn?.name || '未知'}`,
          tables.length > 0 ? `- 可用表: ${tables.join(', ')}` : '- 可用表: (请先用 db_get_tables 获取)',
          '',
          '## 工具使用',
          '- 查询数据（SELECT 等只读操作）→ db_query',
          '- 写操作（INSERT/UPDATE/DELETE/CREATE/ALTER）→ db_execute',
          '- 查看表列表 → db_get_tables',
          '- 查看表结构 → db_get_schema',
          '- 执行操作前，先查看相关表结构确认字段信息',
        ].join('\n')
        tools = toolsEnabled ? DB_TOOLS : undefined
      } else {
        const terminalOutput = await window.api.aiTerminal.getTerminalOutput(effectiveTabId)
        systemContent = [
          '你是一名顶级 Linux/系统运维专家，精通各类操作系统命令行、Shell 脚本、系统管理和故障排查。',
          '',
          '## 你的核心能力',
          '- 熟练运用 Linux/macOS/Windows 命令行工具解决各类运维问题',
          '- 编写高效的 Shell 脚本（bash/zsh/PowerShell）',
          '- 系统性能分析与优化（CPU/内存/磁盘/网络）',
          '- 容器化（Docker/K8s）和 CI/CD 管道管理',
          '- 日志分析、进程管理、权限配置、网络调试',
          '- SSH 远程运维、批量操作',
          '',
          '## 安全准则（必须严格遵守）',
          '1. **危险操作前必须警告用户**：rm -rf、格式化磁盘、停止关键服务、修改系统配置等，必须明确告知风险',
          '2. **高危操作必须提供回滚方案**：修改配置前建议备份（cp xxx xxx.bak）、删除前确认路径、提供 undo 步骤',
          '3. **绝不盲目执行**：不确定当前环境时，先用 terminal_read_output 查看终端输出，了解上下文',
          '4. **权限最小化**：不要建议用户随意 chmod 777 或以 root 权限运行不必要的进程',
          '5. **数据安全**：涉及密码、密钥等敏感信息时提醒用户注意，不要在命令中明文传递',
          '',
          '## 工作方式',
          '- 复杂任务分步执行，每步验证结果后再继续',
          '- 优先使用标准工具和成熟方案，避免花哨的 hack',
          '- 执行命令后主动检查输出，发现异常及时停止并报告',
          '- 简洁回复，先给命令再解释；命令用代码块展示',
          '',
          '## 当前终端上下文',
          '以下是终端最近的输出（用于理解当前状态）：',
          '```',
          terminalOutput.slice(-3000),
          '```',
          selectedText ? `\n用户选中的文本：\n\`\`\`\n${selectedText}\n\`\`\`` : ''
        ].join('\n')
        tools = toolsEnabled ? TERMINAL_TOOLS : undefined
      }

      // Build initial messages
      const aiMsgs: Array<any> = [
        { role: 'system', content: systemContent },
        ...currentMessages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: inputValue }
      ]

      const configId = selectedModelSource === 'builtin' ? '' : (selectedModelConfigId || '')
      const modelId = selectedModelId || ''

      // Stream loop: handle tool calls by re-calling streamChat with tool results
      let messages = aiMsgs
      const MAX_TOOL_ROUNDS = 10
      let allThinking = ''

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (cancelledRef.current) break

        const result = await streamOneRound(configId, messages, modelId, tools, chatMode === 'thinking')

        if (cancelledRef.current) break

        if (result.type === 'done') {
          // Accumulate thinking from all rounds
          if (result.thinking && !allThinking) allThinking = result.thinking
          break
        }

        // tool_use: execute the tool, then continue with updated messages
        if (result.thinking && !allThinking) allThinking = result.thinking

        // Show tool as running
        const tc: StreamingToolCall = {
          id: result.toolCallId,
          name: result.toolName,
          input: result.toolInput,
          status: 'running',
        }
        streamingToolsRef.current = [...streamingToolsRef.current, tc]
        forceUpdate()

        // Execute tool
        const toolResult = await executeTool(
          result.toolName, result.toolInput, effectiveTabId!, currentDBConnId
        )

        if (cancelledRef.current) break

        // Update tool status
        streamingToolsRef.current = streamingToolsRef.current.map(t =>
          t.id === result.toolCallId
            ? { ...t, status: toolResult.isError ? 'error' : 'completed', result: toolResult.result }
            : t
        )
        forceUpdate()

        // Build messages for next round: append assistant tool_use + tool result
        messages = [
          ...messages,
          {
            role: 'assistant',
            content: result.content || '',
            toolCalls: [{ id: result.toolCallId, name: result.toolName, input: result.toolInput }]
          },
          {
            role: 'tool',
            content: toolResult.result,
            toolCallId: result.toolCallId
          }
        ]

        // Reset per-round streaming content (keep accumulated thinking & tools)
        streamingContentRef.current = ''
        // Don't reset thinking - keep it from first round
      }

      const assistantMsg: TerminalAIMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: streamingContentRef.current,
        thinking: allThinking || undefined,
        toolCalls: streamingToolsRef.current.length > 0
          ? streamingToolsRef.current.map(tc => ({
              id: tc.id, name: tc.name, input: tc.input,
              result: tc.result, isError: tc.status === 'error'
            }))
          : undefined,
        timestamp: Date.now()
      }
      addAIMessage(effectiveTabId, assistantMsg)
    } catch (err: any) {
      const content = streamingContentRef.current || `请求失败: ${err.message || String(err)}`
      const errorMsg: TerminalAIMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content,
        toolCalls: streamingToolsRef.current.length > 0
          ? streamingToolsRef.current.map(tc => ({
              id: tc.id, name: tc.name, input: tc.input,
              result: tc.result, isError: tc.status === 'error'
            }))
          : undefined,
        timestamp: Date.now()
      }
      addAIMessage(effectiveTabId, errorMsg)
    } finally {
      streamingContentRef.current = ''
      streamingThinkingRef.current = ''
      streamingToolsRef.current = []
      cancelledRef.current = false
      currentTaskIdRef.current = null
      setAIStreaming(false)
      setAITaskId(null)
      setSelectedText('')
      forceUpdate()
    }
  }, [inputValue, effectiveTabId, aiStreaming, currentMessages, selectedText, chatMode, toolsEnabled,
      selectedModelId, selectedModelSource, selectedModelConfigId, isDBMode, currentDBConnId,
      streamOneRound, executeTool, forceUpdate])

  const handleCancel = useCallback(() => {
    cancelledRef.current = true
    // Cancel any active stream on main process
    const tid = currentTaskIdRef.current
    if (tid) {
      window.api.ai.cancelChat(tid)
    }
    // Break the pending streamOneRound Promise (main process won't send done/error on abort)
    if (rejectStreamRef.current) {
      rejectStreamRef.current(new Error('已取消'))
    }
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // ── SQL Executor ──
  const handleExecuteSQL = useCallback(async () => {
    if (!sqlInput.trim() || !currentDBConnId) return
    setSqlError(null)
    // Open/reuse query tab in main area and pass SQL for execution
    openDBQuery(currentDBConnId, sqlInput)
  }, [sqlInput, currentDBConnId, openDBQuery])

  const handleSQLKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleExecuteSQL()
    }
  }, [handleExecuteSQL])

  if (!effectiveTabId) return null

  return (
    <div style={{
      borderTop: `1px solid ${token.colorBorderSecondary}`,
      background: token.colorBgContainer,
      flexShrink: 0
    }}>
      {/* Header */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 12px',
          cursor: 'pointer',
          userSelect: 'none'
        }}
      >
        <Space size={8} style={{ alignItems: 'center' }}>
          {/* Tab switcher for DB mode */}
          {isDBMode ? (
            <div
              onClick={e => e.stopPropagation()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 0, borderRadius: 6, background: token.colorFillTertiary, padding: 2 }}
            >
              <button
                onClick={() => setBottomTab('sql')}
                style={{
                  padding: '2px 8px', fontSize: 11, fontWeight: 500, border: 'none', borderRadius: 4,
                  background: bottomTab === 'sql' ? token.colorBgContainer : 'transparent',
                  color: bottomTab === 'sql' ? token.colorText : token.colorTextSecondary,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                  boxShadow: bottomTab === 'sql' ? `0 1px 2px ${token.colorFillSecondary}` : 'none',
                  transition: 'all 0.2s',
                }}
              >
                <ConsoleSqlOutlined style={{ fontSize: 10 }} /> SQL Executor
              </button>
              <button
                onClick={() => setBottomTab('ai')}
                style={{
                  padding: '2px 8px', fontSize: 11, fontWeight: 500, border: 'none', borderRadius: 4,
                  background: bottomTab === 'ai' ? token.colorBgContainer : 'transparent',
                  color: bottomTab === 'ai' ? token.colorText : token.colorTextSecondary,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                  boxShadow: bottomTab === 'ai' ? `0 1px 2px ${token.colorFillSecondary}` : 'none',
                  transition: 'all 0.2s',
                }}
              >
                <RobotOutlined style={{ fontSize: 10 }} /> {t('terminal.aiAssistant')}
              </button>
            </div>
          ) : (
            <Text strong style={{ fontSize: 12 }}>{t('terminal.aiAssistant')}</Text>
          )}
          {bottomTab === 'ai' && (
            <div onClick={e => e.stopPropagation()}>
              <ModelSelector placement="topLeft" size="small" />
            </div>
          )}
        </Space>
        <Space size={4}>
          {/* Fast / Thinking capsule toggle - only for AI tab */}
          {bottomTab === 'ai' && (
            <>
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  background: token.colorFillTertiary,
                  borderRadius: 8,
                  padding: 2,
                  gap: 2,
                  position: 'relative',
                }}
              >
                <div style={{
                  position: 'absolute',
                  left: 2,
                  width: 20,
                  height: 20,
                  borderRadius: 6,
                  background: token.colorPrimary,
                  transform: chatMode === 'fast' ? 'translateX(0)' : 'translateX(22px)',
                  transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  zIndex: 0,
                }} />
                <Tooltip title="快速模式">
                  <button
                    onClick={() => setChatMode('fast')}
                    style={{
                      width: 20, height: 20, borderRadius: 6, border: 'none',
                      background: 'transparent',
                      color: chatMode === 'fast' ? '#fff' : token.colorTextSecondary,
                      cursor: 'pointer', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 11,
                      transition: 'color 0.2s',
                      position: 'relative', zIndex: 1,
                    }}
                  >
                    <ThunderboltOutlined />
                  </button>
                </Tooltip>
                <Tooltip title="深度思考">
                  <button
                    onClick={() => setChatMode('thinking')}
                    style={{
                      width: 20, height: 20, borderRadius: 6, border: 'none',
                      background: 'transparent',
                      color: chatMode === 'thinking' ? '#fff' : token.colorTextSecondary,
                      cursor: 'pointer', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 11,
                      transition: 'color 0.2s',
                      position: 'relative', zIndex: 1,
                    }}
                  >
                    <HourglassOutlined />
                  </button>
                </Tooltip>
              </div>
              <Tooltip title={toolsEnabled ? '工具已启用' : '工具已禁用'}>
                <Button
                  type="text"
                  size="small"
                  icon={<ControlOutlined />}
                  onClick={(e) => { e.stopPropagation(); setToolsEnabled(!toolsEnabled) }}
                  style={{
                    fontSize: 12,
                    color: toolsEnabled ? token.colorPrimary : token.colorTextDisabled
                  }}
                />
              </Tooltip>
            </>
          )}
          <Tooltip title={collapsed ? '展开' : '收起'}>
            <Button
              type="text"
              size="small"
              icon={collapsed ? <UpOutlined /> : <DownOutlined />}
              onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed) }}
              style={{ fontSize: 11 }}
            />
          </Tooltip>
        </Space>
      </div>

      {!collapsed && bottomTab === 'ai' && (
        <>
          {/* Messages */}
          {(currentMessages.length > 0 || aiStreaming) && (
            <div style={{
              maxHeight: 300,
              overflowY: 'auto',
              padding: '8px 10px',
              borderTop: `1px solid ${token.colorBorderSecondary}`
            }}>
              {currentMessages.map(msg => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
              {aiStreaming && (
                <MessageBubble
                  isStreaming
                  streamingContent={streamingContentRef.current}
                  streamingThinking={streamingThinkingRef.current}
                  streamingTools={streamingToolsRef.current}
                />
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Selected text indicator */}
          {selectedText && !isDBMode && (
            <div style={{
              padding: '2px 12px',
              fontSize: 11,
              color: token.colorTextSecondary,
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                已选中 {selectedText.length} 字符
              </Text>
              <Button
                type="text"
                size="small"
                icon={<ClearOutlined style={{ fontSize: 10 }} />}
                onClick={() => setSelectedText('')}
                style={{ height: 18, width: 18 }}
              />
            </div>
          )}

          {/* Input area */}
          <div style={{ display: 'flex', gap: 8, padding: '6px 12px 8px', alignItems: 'flex-end' }}>
            <TextArea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isDBMode
                ? '用自然语言查询或修改数据...'
                : '输入需求，AI 可以自动在终端中执行命令...'}
              autoSize={{ minRows: 2, maxRows: 4 }}
              style={{ fontSize: 12 }}
              disabled={aiStreaming}
            />
            {aiStreaming ? (
              <Button
                type="default"
                danger
                icon={<StopOutlined />}
                onClick={handleCancel}
                style={{ flexShrink: 0 }}
                size="small"
              />
            ) : (
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSend}
                disabled={!inputValue.trim()}
                style={{ flexShrink: 0 }}
                size="small"
              />
            )}
          </div>
        </>
      )}

      {/* SQL Executor tab content */}
      {!collapsed && bottomTab === 'sql' && isDBMode && (
        <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}` }}>
          {/* SQL input */}
          <div style={{ display: 'flex', gap: 8, padding: '6px 12px 8px', alignItems: 'flex-end' }}>
            <TextArea
              value={sqlInput}
              onChange={e => setSqlInput(e.target.value)}
              onKeyDown={handleSQLKeyDown}
              placeholder="输入 SQL 语句... (⌘+Enter 执行)"
              autoSize={{ minRows: 2, maxRows: 6 }}
              style={{ fontSize: 12, fontFamily: 'monospace' }}
            />
            <Space.Compact direction="vertical" size="small" style={{ flexShrink: 0 }}>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleExecuteSQL}
                disabled={!sqlInput.trim() || !currentDBConnId}
                size="small"
              />
              <Button
                type="text"
                icon={<ClearOutlined />}
                onClick={() => { setSqlInput(''); setSqlError(null) }}
                size="small"
              />
            </Space.Compact>
          </div>
          {/* Error only */}
          {sqlError && (
            <div style={{ padding: '0 12px 8px' }}>
              <div style={{
                padding: 8, fontSize: 11, fontFamily: 'monospace',
                color: token.colorError, whiteSpace: 'pre-wrap',
                background: token.colorErrorBg, borderRadius: 6,
              }}>
                {sqlError}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default AIAssistantPanel
