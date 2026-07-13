import React, { useState, useEffect, useCallback } from 'react'
import { Modal, Input, Button, Space, Typography, Alert, List, Spin, theme, App } from 'antd'
import { RobotOutlined, FileOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { useAIModelStore } from '../stores/useAIModelStore'
import apiClient, { API_BASE_URL } from '../services/apiClient'
import { SUBAPP_CODEGEN_SYSTEM_PROMPT } from '../skills/subappCreateSkill'
import { useT } from '../i18n'

const { TextArea } = Input
const { Text, Paragraph } = Typography

export interface AIGenerateModalProps {
  open: boolean
  manifest: Record<string, unknown>
  appId: string
  onClose: () => void
  onSuccess: () => void
}

type GenerateStatus = 'idle' | 'generating' | 'success' | 'error'

// The built-in "create sub-app" skill prompt (full SDK + UI reference) lives in
// ../skills/subappCreateSkill so it can be shared with the editor chat panel.
const SYSTEM_PROMPT = SUBAPP_CODEGEN_SYSTEM_PROMPT

// Join an app directory with a relative file name without producing double
// slashes; the main-process write-file handler creates any missing parents.
function joinAppPath(appPath: string, name: string): string {
  const base = appPath.replace(/[\\/]+$/, '')
  const rel = name.replace(/^[\\/]+/, '')
  return `${base}/${rel}`
}

// ── Streaming helpers (module-level, not inside component) ──────────────────

async function streamBuiltinModel(
  modelId: string,
  messages: Array<{ role: string; content: string }>,
  onChunk: (content: string) => void
): Promise<void> {
  const token = apiClient.getToken()
  const response = await fetch(`${API_BASE_URL}/ai/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ modelId, messages })
  })

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`
    try {
      const errData = await response.json()
      errorMsg = errData?.error?.message || errorMsg
    } catch {
      // ignore parse error
    }
    throw new Error(`服务端模型请求失败: ${errorMsg}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') return
        try {
          const parsed = JSON.parse(data)
          if (parsed.type === 'error' || parsed.error) {
            throw new Error(parsed.message || parsed.error || 'Stream error')
          }
          if (parsed.type === 'delta' && parsed.content) {
            onChunk(parsed.content)
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue
          throw e
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function streamLocalModel(
  configId: string,
  messages: Array<{ role: string; content: string }>,
  modelId: string,
  onChunk: (content: string) => void
): Promise<void> {
  const taskId = (await window.api.ai.streamChat(configId, messages, modelId)) as string

  return new Promise<void>((resolve, reject) => {
    let unsubDelta: (() => void) | undefined
    let unsubDone: (() => void) | undefined
    let unsubError: (() => void) | undefined

    const cleanup = () => {
      unsubDelta?.()
      unsubDone?.()
      unsubError?.()
    }

    unsubDelta = window.api.ai.onChatDelta((data) => {
      if (data.taskId === taskId) {
        onChunk(data.content)
      }
    })

    unsubDone = window.api.ai.onChatDone((data) => {
      if (data.taskId === taskId) {
        cleanup()
        resolve()
      }
    })

    unsubError = window.api.ai.onChatError((data) => {
      if (data.taskId === taskId) {
        cleanup()
        reject(new Error(data.error))
      }
    })
  })
}

function parseGeneratedFiles(content: string): Record<string, string> | null {
  const result: Record<string, string> = {}

  // ── Strategy 1: ### FILE: filename\n```lang\n<code>\n``` (primary format) ──
  // Matches: ### FILE: foo.py\n```python\n<code>\n```
  const fileBlockRegex = /###\s+FILE:\s+(\S+)\s*\n```[a-z]*\n([\s\S]*?)\n```/g
  let match
  while ((match = fileBlockRegex.exec(content)) !== null) {
    result[match[1].trim()] = match[2]
  }
  if (Object.keys(result).length > 0) return result

  // ── Strategy 2: JSON wrapped in ```json ... ``` block ──
  const jsonBlockRegex = /```json\r?\n?([\s\S]*?)\r?\n?```/g
  while ((match = jsonBlockRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim())
      if (parsed?.files && typeof parsed.files === 'object') {
        const validated = validateFileMap(parsed.files)
        if (validated) return validated
      }
    } catch {
      // try next
    }
  }

  // ── Strategy 3: Raw JSON anywhere in the content ──
  const trimmed = content.trim()
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidates = [
      trimmed.slice(firstBrace, lastBrace + 1),
      trimmed
    ]
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate)
        if (parsed?.files && typeof parsed.files === 'object') {
          const validated = validateFileMap(parsed.files)
          if (validated) return validated
        }
      } catch {
        // try next
      }
    }
  }

  return null
}

function validateFileMap(files: Record<string, unknown>): Record<string, string> | null {
  const validated: Record<string, string> = {}
  for (const [k, v] of Object.entries(files)) {
    if (typeof v === 'string') validated[k] = v
  }
  return Object.keys(validated).length > 0 ? validated : null
}

// ── Component ──────────────────────────────────────────────────────────────

const AIGenerateModal: React.FC<AIGenerateModalProps> = ({
  open,
  manifest,
  appId,
  onClose,
  onSuccess
}) => {
  const { token } = theme.useToken()
  const { message, modal } = App.useApp()
  const t = useT()
  const [instructions, setInstructions] = useState('')
  const [status, setStatus] = useState<GenerateStatus>('idle')
  const [statusText, setStatusText] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [generatedFiles, setGeneratedFiles] = useState<string[]>([])

  // Pre-fetch models when modal opens
  useEffect(() => {
    if (open) {
      const store = useAIModelStore.getState()
      store.fetchBuiltinModels()
      store.fetchLocalModels()
    }
  }, [open])

  const reset = useCallback(() => {
    setInstructions('')
    setStatus('idle')
    setStatusText('')
    setErrorMsg('')
    setGeneratedFiles([])
  }, [])

  const handleClose = useCallback(() => {
    if (status === 'generating') return
    // Confirm before discarding non-empty input that hasn't been used yet.
    if (status === 'idle' && instructions.trim().length > 0) {
      modal.confirm({
        title: t('appEditor.aiGenDiscardTitle'),
        content: t('appEditor.aiGenDiscardContent'),
        okText: t('appEditor.aiGenClose'),
        okType: 'danger',
        cancelText: t('appEditor.aiGenContinueEdit'),
        onOk: () => {
          reset()
          onClose()
        }
      })
      return
    }
    reset()
    onClose()
  }, [status, instructions, reset, onClose, modal, t])

  const handleGenerate = async () => {
    // Re-fetch to ensure latest model state
    const store = useAIModelStore.getState()
    await store.fetchBuiltinModels()
    await store.fetchLocalModels()

    const { builtinModels, localModels } = useAIModelStore.getState()

    if (builtinModels.length === 0 && localModels.length === 0) {
      setErrorMsg(t('appEditor.aiGenNoModelError'))
      setStatus('error')
      return
    }

    setStatus('generating')

    const userContent = [
      '根据以下 manifest.json，生成完整的 ClawBench Python 子应用代码：',
      '',
      '```json',
      JSON.stringify(manifest, null, 2),
      '```',
      ...(instructions.trim() ? ['', `额外要求：${instructions.trim()}`] : [])
    ].join('\n')

    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: userContent }
    ]

    let fullContent = ''

    try {
      if (builtinModels.length > 0) {
        const model = builtinModels[0]
        setStatusText(t('appEditor.aiGenCallingServer', String(model.name || model.id)))
        await streamBuiltinModel(model.id, messages, (chunk) => {
          fullContent += chunk
          setStatusText(t('appEditor.aiGenStreaming', String(fullContent.length)))
        })
      } else {
        const config = localModels[0]
        const modelId = config.models[0] || config.name
        setStatusText(t('appEditor.aiGenCallingLocal', String(config.name)))
        await streamLocalModel(config.id, messages, modelId, (chunk) => {
          fullContent += chunk
          setStatusText(t('appEditor.aiGenStreaming', String(fullContent.length)))
        })
      }

      setStatusText(t('appEditor.aiGenParsing'))

      const files = parseGeneratedFiles(fullContent)
      if (!files) {
        setErrorMsg(t('appEditor.aiGenParseError', String(fullContent.slice(0, 500))))
        setStatus('error')
        return
      }

      setStatusText(t('appEditor.aiGenWriting'))
      const appPath = (await window.api.developer.getAppPath(appId)) as string
      const fileNames: string[] = []

      for (const [name, fileContent] of Object.entries(files)) {
        await window.api.developer.writeFile(joinAppPath(appPath, name), fileContent)
        fileNames.push(name)
      }

      setGeneratedFiles(fileNames)
      setStatus('success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setStatus('error')
      message.error(t('appEditor.aiGenFailed'))
    }
  }

  const handleDone = () => {
    reset()
    onSuccess()
  }

  const renderContent = () => {
    switch (status) {
      case 'idle':
        return (
          <>
            <Paragraph type="secondary" style={{ marginBottom: 16 }}>
              {t('appEditor.aiGenDesc1')}
              {t('appEditor.aiGenDesc2')}
            </Paragraph>
            <div style={{ paddingBottom: 24 }}>
              <TextArea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder={t('appEditor.aiGenInstructionsPlaceholder')}
                rows={4}
                maxLength={500}
                showCount
              />
            </div>
          </>
        )

      case 'generating':
        return (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, color: token.colorTextSecondary }}>{statusText}</div>
          </div>
        )

      case 'success':
        return (
          <>
            <Alert
              type="success"
              message={t('appEditor.aiGenSuccessTitle')}
              description={t('appEditor.aiGenSuccessDesc', String(generatedFiles.length))}
              showIcon
              icon={<CheckCircleOutlined />}
              style={{ marginBottom: 16 }}
            />
            <List
              size="small"
              bordered
              dataSource={generatedFiles}
              renderItem={(name) => (
                <List.Item>
                  <FileOutlined style={{ marginRight: 8, color: token.colorPrimary }} />
                  <Text>{name}</Text>
                </List.Item>
              )}
            />
          </>
        )

      case 'error':
        return (
          <Alert
            type="error"
            message={t('appEditor.aiGenErrorTitle')}
            description={
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  fontSize: 12,
                  maxHeight: 200,
                  overflow: 'auto'
                }}
              >
                {errorMsg}
              </pre>
            }
            showIcon
          />
        )
    }
  }

  const renderFooter = () => {
    switch (status) {
      case 'idle':
        return [
          <Button key="cancel" onClick={handleClose}>
            {t('common.cancel')}
          </Button>,
          <Button key="generate" type="primary" icon={<RobotOutlined />} onClick={handleGenerate}>
            {t('appEditor.aiGenStart')}
          </Button>
        ]

      case 'generating':
        return [
          <Button key="wait" disabled>
            {t('appEditor.aiGenInProgress')}
          </Button>
        ]

      case 'success':
        return [
          <Button key="done" type="primary" onClick={handleDone}>
            {t('appEditor.aiGenDone')}
          </Button>
        ]

      case 'error':
        return [
          <Button key="cancel" onClick={handleClose}>
            {t('appEditor.aiGenClose')}
          </Button>,
          <Button
            key="retry"
            type="primary"
            onClick={() => {
              setStatus('idle')
              setErrorMsg('')
            }}
          >
            {t('appEditor.aiGenRetry')}
          </Button>
        ]
    }
  }

  return (
    <Modal
      title={
        <Space>
          <RobotOutlined />
          {t('appEditor.aiGenTitle')}
        </Space>
      }
      open={open}
      onCancel={handleClose}
      footer={renderFooter()}
      closable={status !== 'generating'}
      maskClosable={status !== 'generating'}
      width={520}
      destroyOnHidden
    >
      {renderContent()}
    </Modal>
  )
}

export default AIGenerateModal
