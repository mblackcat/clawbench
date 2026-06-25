import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Input, Button, Typography, theme, Tooltip, Empty } from 'antd'
import {
  SendOutlined,
  StopOutlined,
  ClearOutlined,
  RobotOutlined,
  CloseOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  FileOutlined,
  FolderOutlined,
  EditOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAIModelStore } from '../stores/useAIModelStore'
import { rehypeHighlightPlugin } from '../utils/markdown-plugins'
import { externalLinkMarkdownComponents } from '../utils/markdown-links'
import ThinkingBlock from './ThinkingBlock'
import ModelSelector from '../pages/AIChat/ModelSelector'
import { SUBAPP_CHAT_SYSTEM_PROMPT, SUBAPP_CHAT_TOOLS } from '../skills/subappCreateSkill'
import { apiClient, API_BASE_URL } from '../services/apiClient'
import '../pages/AIChat/chat-styles.css'

const { TextArea } = Input
const { Text } = Typography

const MAX_TOOL_ROUNDS = 16

interface ToolRun {
  id: string
  name: string
  input: Record<string, any>
  status: 'running' | 'completed' | 'error'
  result?: string
}

interface ChatMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  tools?: ToolRun[]
}

const TOOL_LABELS: Record<string, string> = {
  list_files: '列出文件',
  read_file: '读取文件',
  write_file: '写入文件',
  create_folder: '新建文件夹'
}

const TOOL_ICONS: Record<string, React.ReactNode> = {
  list_files: <FolderOutlined />,
  read_file: <FileOutlined />,
  write_file: <EditOutlined />,
  create_folder: <FolderOutlined />
}

interface EditorChatPanelProps {
  appId: string
  appPath: string
  /** Called after the AI writes/creates files so the editor can refresh. */
  onFilesChanged: () => void
  /** Collapse/close the panel. */
  onClose: () => void
}

// Join the app root with a relative path; main-process write-file makes parents.
function joinRel(appPath: string, rel: string): string {
  const base = appPath.replace(/[\\/]+$/, '')
  const r = (rel || '').replace(/^[\\/]+/, '')
  return r ? `${base}/${r}` : base
}

const EditorChatPanel: React.FC<EditorChatPanelProps> = ({
  appId,
  appPath,
  onFilesChanged,
  onClose
}) => {
  const { token } = theme.useToken()
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [inputValue, setInputValue] = useState('')
  const [streaming, setStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Streaming refs + forceUpdate for stale-closure-free real-time rendering.
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick((t) => t + 1), [])
  const streamingContentRef = useRef('')
  const streamingThinkingRef = useRef('')
  const streamingToolsRef = useRef<ToolRun[]>([])
  const cancelledRef = useRef(false)
  const rejectStreamRef = useRef<((err: Error) => void) | null>(null)

  const { selectedModelSource, selectedModelConfigId, selectedModelId, builtinModels, localModels, fetchBuiltinModels, fetchLocalModels, initializeSelectedModel } =
    useAIModelStore()

  useEffect(() => {
    Promise.all([fetchBuiltinModels(), fetchLocalModels()]).then(() => {
      initializeSelectedModel()
    })
  }, [fetchBuiltinModels, fetchLocalModels, initializeSelectedModel])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContentRef.current, streamingThinkingRef.current, streamingToolsRef.current])

  // Resolve the current model selection (works for both builtin and local).
  const resolveModel = useCallback((): { source: 'builtin' | 'local'; configId: string; modelId: string } | null => {
    if (selectedModelSource === 'builtin' && selectedModelId) {
      return { source: 'builtin', configId: '', modelId: selectedModelId }
    }
    if (selectedModelSource === 'local' && selectedModelConfigId && selectedModelId) {
      return { source: 'local', configId: selectedModelConfigId, modelId: selectedModelId }
    }
    // Fallback: any local model
    for (const c of localModels) {
      if (c.models.length > 0) return { source: 'local', configId: c.id, modelId: c.models[0] }
    }
    // Fallback: any builtin model
    if (builtinModels.length > 0) {
      return { source: 'builtin', configId: '', modelId: builtinModels[0].id }
    }
    return null
  }, [selectedModelSource, selectedModelConfigId, selectedModelId, localModels, builtinModels])

  const executeTool = useCallback(
    async (toolName: string, input: Record<string, any>): Promise<{ result: string; isError: boolean }> => {
      try {
        if (toolName === 'list_files') {
          const list = (await window.api.developer.listAppFiles(appId)) as Array<{
            name: string
            isDirectory: boolean
          }>
          const lines = list.map((f) => (f.isDirectory ? `${f.name}/` : f.name))
          return { result: lines.length ? lines.join('\n') : '(空目录)', isError: false }
        }
        if (toolName === 'read_file') {
          const content = (await window.api.developer.readFile(joinRel(appPath, input.path))) as string
          return { result: content.slice(0, 20000), isError: false }
        }
        if (toolName === 'write_file') {
          await window.api.developer.writeFile(joinRel(appPath, input.path), String(input.content ?? ''))
          onFilesChanged()
          return { result: `已写入 ${input.path}`, isError: false }
        }
        if (toolName === 'create_folder') {
          await window.api.developer.createFolder(joinRel(appPath, input.path))
          onFilesChanged()
          return { result: `已创建文件夹 ${input.path}`, isError: false }
        }
        return { result: `未知工具: ${toolName}`, isError: true }
      } catch (err: any) {
        return { result: err?.message || String(err), isError: true }
      }
    },
    [appId, appPath, onFilesChanged]
  )

  const streamOneRound = useCallback(
    (
      configId: string,
      apiMessages: Array<any>,
      modelId: string
    ): Promise<
      | { type: 'done'; content: string; thinking: string }
      | {
          type: 'tool_use'
          content: string
          thinking: string
          toolCallId: string
          toolName: string
          toolInput: Record<string, any>
        }
    > => {
      return new Promise((resolve, reject) => {
        ;(async () => {
          const taskId = (await window.api.ai.streamChat(
            configId,
            apiMessages,
            modelId,
            undefined,
            SUBAPP_CHAT_TOOLS as any,
            true
          )) as string

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
                toolInput: data.input
              })
            }
          })

          function cleanup(): void {
            rejectStreamRef.current = null
            cleanupDelta()
            cleanupThinking()
            cleanupDone()
            cleanupError()
            cleanupToolUse()
          }

          rejectStreamRef.current = (err: Error) => {
            cleanup()
            reject(err)
          }
        })().catch(reject)
      })
    },
    [forceUpdate]
  )

  // Stream one round via backend API (for builtin/server models).
  const streamBuiltinOneRound = useCallback(
    (
      modelId: string,
      apiMessages: Array<any>
    ): Promise<
      | { type: 'done'; content: string; thinking: string }
      | {
          type: 'tool_use'
          content: string
          thinking: string
          toolCallId: string
          toolName: string
          toolInput: Record<string, any>
        }
    > => {
      return new Promise((resolve, reject) => {
        ;(async () => {
          const token = apiClient.getToken()
          const response = await fetch(`${API_BASE_URL}/ai/chat/stream`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
              modelId,
              messages: apiMessages,
              tools: SUBAPP_CHAT_TOOLS,
              enableThinking: true
            })
          })

          if (!response.ok) {
            throw new Error(`Stream request failed: ${response.status}`)
          }

          const reader = response.body?.getReader()
          if (!reader) throw new Error('No response body')
          const decoder = new TextDecoder()
          let buffer = ''
          let roundContent = ''
          let roundThinking = ''

          cancelledRef.current = false
          rejectStreamRef.current = (err: Error) => {
            reader.cancel()
            reject(err)
          }

          while (true) {
            const { done, value } = await reader.read()
            if (done || cancelledRef.current) break
            buffer += decoder.decode(value, { stream: true })

            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const data = line.slice(6).trim()
              if (!data || data === '[DONE]') continue

              let parsed: any
              try {
                parsed = JSON.parse(data)
              } catch {
                continue
              }

              if (parsed.type === 'delta' && parsed.content) {
                roundContent += parsed.content
                streamingContentRef.current += parsed.content
                forceUpdate()
              } else if (parsed.type === 'thinking_delta' && parsed.content) {
                roundThinking += parsed.content
                streamingThinkingRef.current += parsed.content
                forceUpdate()
              } else if (parsed.type === 'tool_use' && parsed.toolCall) {
                rejectStreamRef.current = null
                resolve({
                  type: 'tool_use',
                  content: roundContent,
                  thinking: roundThinking,
                  toolCallId: parsed.toolCall.id,
                  toolName: parsed.toolCall.name,
                  toolInput: parsed.toolCall.input
                })
                return
              } else if (parsed.type === 'done') {
                rejectStreamRef.current = null
                resolve({ type: 'done', content: roundContent, thinking: roundThinking })
                return
              } else if (parsed.type === 'error') {
                throw new Error(parsed.message || 'Stream error')
              }
            }
          }

          rejectStreamRef.current = null
          resolve({ type: 'done', content: roundContent, thinking: roundThinking })
        })().catch(reject)
      })
    },
    [forceUpdate]
  )

  const handleSend = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || streaming) return

    const model = resolveModel()
    if (!model) {
      setMessages((prev) => [
        ...prev,
        { id: `m-${Date.now()}`, role: 'user', content: text },
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content:
            '⚠️ 未找到可用模型。请在「设置 → AI 模型」中添加并启用一个模型（如 Claude / OpenAI / Gemini），然后重试。'
        }
      ])
      setInputValue('')
      return
    }

    const userMsg: ChatMsg = { id: `m-${Date.now()}`, role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setInputValue('')
    setStreaming(true)

    streamingContentRef.current = ''
    streamingThinkingRef.current = ''
    streamingToolsRef.current = []
    cancelledRef.current = false
    forceUpdate()

    // Build API message history from prior turns.
    const apiMessages: Array<any> = [{ role: 'system', content: SUBAPP_CHAT_SYSTEM_PROMPT }]
    for (const m of messages) {
      if (m.role === 'user') apiMessages.push({ role: 'user', content: m.content })
      else if (m.content) apiMessages.push({ role: 'assistant', content: m.content })
    }
    apiMessages.push({ role: 'user', content: text })

    const accumulatedTools: ToolRun[] = []
    let finalThinking = ''

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (cancelledRef.current) break

        const res = model.source === 'builtin'
          ? await streamBuiltinOneRound(model.modelId, apiMessages)
          : await streamOneRound(model.configId, apiMessages, model.modelId)
        if (res.thinking) finalThinking = res.thinking

        if (res.type === 'done') {
          // Persist the assistant turn.
          const assistantMsg: ChatMsg = {
            id: `a-${Date.now()}-${round}`,
            role: 'assistant',
            content: res.content,
            thinking: finalThinking || undefined,
            tools: accumulatedTools.length ? [...accumulatedTools] : undefined
          }
          setMessages((prev) => [...prev, assistantMsg])
          streamingContentRef.current = ''
          streamingThinkingRef.current = ''
          streamingToolsRef.current = []
          break
        }

        // tool_use: record running tool, execute, feed result back.
        const run: ToolRun = {
          id: res.toolCallId,
          name: res.toolName,
          input: res.toolInput,
          status: 'running'
        }
        accumulatedTools.push(run)
        streamingToolsRef.current = [...accumulatedTools]
        forceUpdate()

        // The assistant message must include the tool_use block.
        apiMessages.push({
          role: 'assistant',
          content: res.content,
          toolCalls: [{ id: res.toolCallId, name: res.toolName, input: res.toolInput }]
        })

        const { result, isError } = await executeTool(res.toolName, res.toolInput)
        run.status = isError ? 'error' : 'completed'
        run.result = result
        streamingToolsRef.current = [...accumulatedTools]
        forceUpdate()

        apiMessages.push({
          role: 'tool',
          toolCallId: res.toolCallId,
          content: result
        })
      }
    } catch (err: any) {
      if (!cancelledRef.current) {
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: 'assistant',
            content: `❌ 出错了：${err?.message || String(err)}`,
            tools: accumulatedTools.length ? [...accumulatedTools] : undefined
          }
        ])
      }
      streamingContentRef.current = ''
      streamingThinkingRef.current = ''
      streamingToolsRef.current = []
    } finally {
      setStreaming(false)
      forceUpdate()
    }
  }, [inputValue, streaming, messages, resolveModel, streamOneRound, streamBuiltinOneRound, executeTool, forceUpdate])

  const handleCancel = useCallback(() => {
    cancelledRef.current = true
    rejectStreamRef.current?.(new Error('cancelled'))
    setStreaming(false)
  }, [])

  const handleClear = useCallback(() => {
    if (streaming) return
    setMessages([])
  }, [streaming])

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const renderToolCard = (tr: ToolRun): React.ReactNode => {
    const statusIcon =
      tr.status === 'running' ? (
        <LoadingOutlined style={{ color: token.colorPrimary }} />
      ) : tr.status === 'error' ? (
        <CloseCircleOutlined style={{ color: token.colorError }} />
      ) : (
        <CheckCircleOutlined style={{ color: token.colorSuccess }} />
      )
    const detail = tr.input?.path || ''
    return (
      <div
        key={tr.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px',
          margin: '4px 0',
          borderRadius: 6,
          fontSize: 12,
          background: token.colorFillTertiary,
          color: token.colorTextSecondary
        }}
      >
        {TOOL_ICONS[tr.name]}
        <span>{TOOL_LABELS[tr.name] || tr.name}</span>
        {detail && <Text code style={{ fontSize: 11 }}>{detail}</Text>}
        <span style={{ marginLeft: 'auto' }}>{statusIcon}</span>
      </div>
    )
  }

  const renderMessage = (m: ChatMsg): React.ReactNode => {
    const isUser = m.role === 'user'
    return (
      <div key={m.id} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          {isUser ? null : <RobotOutlined style={{ color: token.colorPrimary }} />}
          <Text type="secondary" style={{ fontSize: 12 }}>
            {isUser ? '你' : 'AI 编码助手'}
          </Text>
        </div>
        {m.thinking && <ThinkingBlock content={m.thinking} isStreaming={false} />}
        {m.tools?.map((tr) => renderToolCard(tr))}
        <div
          style={{
            padding: isUser ? '8px 12px' : 0,
            borderRadius: 8,
            background: isUser ? token.colorFillSecondary : 'transparent',
            fontSize: 13,
            wordBreak: 'break-word'
          }}
          className="chat-markdown"
        >
          {isUser ? (
            <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlightPlugin]}
              components={externalLinkMarkdownComponents}
            >
              {m.content}
            </ReactMarkdown>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: token.colorBgContainer
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`
        }}
      >
        <RobotOutlined style={{ color: token.colorPrimary }} />
        <Text strong style={{ flex: 1 }}>
          AI 编码
        </Text>
        <ModelSelector size="small" />
        <Tooltip title="清空对话">
          <Button type="text" size="small" icon={<ClearOutlined />} onClick={handleClear} disabled={streaming} />
        </Tooltip>
        <Tooltip title="关闭面板">
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
        </Tooltip>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {messages.length === 0 && !streaming ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
                让 AI 帮你读写当前子应用的文件、实现功能、修复问题。
              </span>
            }
            style={{ marginTop: 48 }}
          />
        ) : (
          messages.map((m) => renderMessage(m))
        )}

        {/* Live streaming turn */}
        {streaming && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <RobotOutlined style={{ color: token.colorPrimary }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                AI 编码助手
              </Text>
            </div>
            {streamingThinkingRef.current && (
              <ThinkingBlock content={streamingThinkingRef.current} isStreaming />
            )}
            {streamingToolsRef.current.map((tr) => renderToolCard(tr))}
            {streamingContentRef.current ? (
              <div className="chat-markdown" style={{ fontSize: 13 }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlightPlugin]}
                  components={externalLinkMarkdownComponents}
                >
                  {streamingContentRef.current}
                </ReactMarkdown>
              </div>
            ) : (
              !streamingToolsRef.current.length && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  <LoadingOutlined /> 思考中...
                </Text>
              )
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: 12, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
        <TextArea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="描述你想实现的功能或要修改的内容...（Enter 发送，Shift+Enter 换行）"
          autoSize={{ minRows: 2, maxRows: 6 }}
          disabled={streaming}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          {streaming ? (
            <Button danger icon={<StopOutlined />} onClick={handleCancel}>
              停止
            </Button>
          ) : (
            <Button type="primary" icon={<SendOutlined />} onClick={handleSend} disabled={!inputValue.trim()}>
              发送
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default EditorChatPanel
