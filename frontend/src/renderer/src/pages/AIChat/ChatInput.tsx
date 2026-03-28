import React, { useState, useRef, useCallback, useEffect, KeyboardEvent, ClipboardEvent } from 'react'
import { Input, Button, App, theme, Image, Popover, Switch, Space, Typography, Spin, Tooltip } from 'antd'
import {
  SendOutlined, PaperClipOutlined, CloseCircleFilled,
  ThunderboltOutlined, HourglassOutlined, ControlOutlined, ApiOutlined,
  GlobalOutlined, PictureOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useChatStore } from '../../stores/useChatStore'
import { useAIModelStore } from '../../stores/useAIModelStore'
import type { PendingAttachment } from '../../types/chat'
import ModelSelector from './ModelSelector'
import { useT } from '../../i18n'

const { TextArea } = Input
const { Text } = Typography

const ACCEPT_TYPES = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,text/markdown'

type McpServerStatus = { id: string; name: string; connected: boolean; toolCount: number }

const ChatInput: React.FC = () => {
  const t = useT()
  const navigate = useNavigate()
  const [inputValue, setInputValue] = useState('')
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([])
  const [chatMode, setChatMode] = useState<'fast' | 'thinking'>('fast')
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [imagenEnabled, setImagenEnabled] = useState(false)
  const [feishuKitsEnabled, setFeishuKitsEnabled] = useState(false)
  const [feishuAvailable, setFeishuAvailable] = useState(false)
  const [featuresOpen, setFeaturesOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([])
  const [mcpLoading, setMcpLoading] = useState(false)
  const { streaming, activeConversationId, sendMessage, createConversation, toolsEnabled, setToolsEnabled, prefillInput, setPrefillInput } = useChatStore()
  const { selectedModelId, selectedModelSource, selectedModelConfigId, builtinModels } = useAIModelStore()
  const { token } = theme.useToken()
  const { message, modal } = App.useApp()
  const textAreaRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedModel = builtinModels.find((m) => m.id === selectedModelId)
  const supportsImagen = selectedModel?.provider === 'openai' || selectedModel?.provider === 'azure-openai'

  // Load saved chat preferences on mount + check Feishu availability
  useEffect(() => {
    window.api.settings.getChatPreferences().then((prefs) => {
      if (prefs.chatMode === 'fast' || prefs.chatMode === 'thinking') {
        setChatMode(prefs.chatMode)
      }
      setToolsEnabled(prefs.toolsEnabled)
      setWebSearchEnabled(prefs.webSearchEnabled)
      setFeishuKitsEnabled(prefs.feishuKitsEnabled ?? false)
    }).catch(() => {})
    window.api.feishuTools.checkAvailability().then((res) => {
      setFeishuAvailable(res.available)
      // If not available, force disable
      if (!res.available) setFeishuKitsEnabled(false)
    }).catch(() => setFeishuAvailable(false))
  }, [])

  // Consume prefill input from store (e.g. prompt "试试" button)
  useEffect(() => {
    if (prefillInput) {
      setInputValue(prefillInput)
      setPrefillInput(null)
      setTimeout(() => textAreaRef.current?.focus(), 100)
    }
  }, [prefillInput])

  const loadMcpServers = useCallback(async () => {
    setMcpLoading(true)
    try {
      const status: McpServerStatus[] = await window.api.mcp.getStatus()
      setMcpServers(status)
    } catch {
      setMcpServers([])
    } finally {
      setMcpLoading(false)
    }
  }, [])

  const handleMcpToggle = useCallback(
    async (id: string, connected: boolean) => {
      try {
        if (connected) {
          await window.api.mcp.disconnect(id)
        } else {
          await window.api.mcp.connect(id)
        }
        await loadMcpServers()
      } catch {
        // ignore
      }
    },
    [loadMcpServers]
  )

  const addFiles = useCallback((files: File[]) => {
    const newPending: PendingAttachment[] = files.map((file) => {
      const id = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
      return { id, file, previewUrl, uploading: false }
    })
    setPendingFiles((prev) => [...prev, ...newPending])
  }, [])

  const removeFile = useCallback((id: string) => {
    setPendingFiles((prev) => {
      const item = prev.find((f) => f.id === id)
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
      return prev.filter((f) => f.id !== id)
    })
  }, [])

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      if (files.length > 0) addFiles(files)
      // Reset so the same file can be re-selected
      e.target.value = ''
    },
    [addFiles]
  )

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items
      if (!items) return

      const imageFiles: File[] = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) imageFiles.push(file)
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault()
        addFiles(imageFiles)
      }
    },
    [addFiles]
  )

  const handleSend = async () => {
    const content = inputValue.trim()
    if (!content && pendingFiles.length === 0) return

    const { builtinModels: bModels, localModels: lModels } = useAIModelStore.getState()
    if (bModels.length === 0 && lModels.length === 0) {
      modal.confirm({
        title: t('chat.noModelTitle'),
        content: t('chat.noModelContent'),
        okText: t('chat.goToSettings'),
        cancelText: t('common.cancel'),
        onOk: () => navigate('/settings#ai-models')
      })
      return
    }

    if (!selectedModelId) return

    let convId = activeConversationId
    if (!convId) {
      try {
        convId = await createConversation(selectedModelId)
      } catch {
        message.error(t('chat.createFailed'))
        return
      }
    }

    const filesToSend = [...pendingFiles]
    setInputValue('')
    setPendingFiles([])

    try {
      await sendMessage(
        content || t('chat.attachment'),
        selectedModelSource,
        selectedModelId,
        selectedModelConfigId || undefined,
        filesToSend.length > 0 ? filesToSend : undefined,
        chatMode === 'thinking',
        webSearchEnabled,
        feishuKitsEnabled
      )
    } catch {
      setInputValue(content)
      setPendingFiles(filesToSend)
      message.error(t('chat.sendFailed'))
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  const hasContent = inputValue.trim().length > 0 || pendingFiles.length > 0

  const featuresContent = (
    <div style={{ width: 220 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>{t('chat.availableFeatures')}</Text>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Space size={6}>
            <GlobalOutlined style={{ color: token.colorTextSecondary }} />
            <Text>{t('chat.webSearch')}</Text>
          </Space>
          <Switch size="small" checked={webSearchEnabled} onChange={(checked) => {
            setWebSearchEnabled(checked)
            window.api.settings.setChatPreferences({ webSearchEnabled: checked }).catch(() => {})
          }} />
        </div>
        {supportsImagen && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Space size={6}>
              <PictureOutlined style={{ color: token.colorTextSecondary }} />
              <Text>{t('chat.imageGen')}</Text>
            </Space>
            <Switch size="small" checked={imagenEnabled} onChange={setImagenEnabled} />
          </div>
        )}
        {feishuAvailable && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Space size={6}>
              <ApiOutlined style={{ color: token.colorTextSecondary }} />
              <Text>{t('chat.feishuKits')}</Text>
            </Space>
            <Switch size="small" checked={feishuKitsEnabled} onChange={(checked) => {
              setFeishuKitsEnabled(checked)
              window.api.settings.setChatPreferences({ feishuKitsEnabled: checked }).catch(() => {})
            }} />
          </div>
        )}
      </div>
    </div>
  )

  const mcpContent = (
    <div style={{ width: 240 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>{t('chat.mcpServers')}</Text>
      {mcpLoading ? (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <Spin size="small" />
        </div>
      ) : mcpServers.length === 0 ? (
        <div style={{ padding: '12px 0', color: token.colorTextTertiary, fontSize: 12 }}>
          {t('chat.noMcpServers')}
        </div>
      ) : (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mcpServers.map((server) => (
            <div key={server.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Space size={6}>
                <ApiOutlined style={{ color: token.colorTextSecondary }} />
                <div>
                  <Text style={{ fontSize: 13 }}>{server.name}</Text>
                  {server.connected && server.toolCount > 0 && (
                    <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                      {server.toolCount} {t('chat.tools')}
                    </Text>
                  )}
                </div>
              </Space>
              <Switch
                size="small"
                checked={server.connected}
                onChange={() => handleMcpToggle(server.id, server.connected)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div
      style={{
        padding: 6,
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        borderRadius: 0
      }}
    >
      {/* Toolbar row above textarea */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        {/* Model selector (opens upward) */}
        <ModelSelector placement="topLeft" />

        {/* Fast / Thinking capsule toggle */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          background: token.colorFillTertiary,
          borderRadius: 8,
          padding: 2,
          gap: 2,
          marginInline: 2,
          position: 'relative',
        }}>
          {/* Sliding indicator */}
          <div style={{
            position: 'absolute',
            left: 2,
            width: 22,
            height: 22,
            borderRadius: 6,
            background: token.colorPrimary,
            transform: chatMode === 'fast' ? 'translateX(0)' : 'translateX(24px)',
            transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            zIndex: 0,
          }} />
          <Tooltip title={t('chat.fastMode')}>
            <button
              onClick={() => { setChatMode('fast'); window.api.settings.setChatPreferences({ chatMode: 'fast' }).catch(() => {}) }}
              style={{
                width: 22, height: 22, borderRadius: 6, border: 'none',
                background: 'transparent',
                color: chatMode === 'fast' ? '#fff' : token.colorTextSecondary,
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 12,
                transition: 'color 0.2s',
                position: 'relative', zIndex: 1,
              }}
            >
              <ThunderboltOutlined />
            </button>
          </Tooltip>
          <Tooltip title={t('chat.thinkingMode')}>
            <button
              onClick={() => { setChatMode('thinking'); window.api.settings.setChatPreferences({ chatMode: 'thinking' }).catch(() => {}) }}
              style={{
                width: 22, height: 22, borderRadius: 6, border: 'none',
                background: 'transparent',
                color: chatMode === 'thinking' ? '#fff' : token.colorTextSecondary,
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 12,
                transition: 'color 0.2s',
                position: 'relative', zIndex: 1,
              }}
            >
              <HourglassOutlined />
            </button>
          </Tooltip>
        </div>

        {/* Features toggle */}
        <Popover
          content={featuresContent}
          trigger="click"
          open={featuresOpen}
          onOpenChange={setFeaturesOpen}
          placement="topLeft"
        >
          <Button
            size="small"
            type={webSearchEnabled || imagenEnabled || feishuKitsEnabled ? 'primary' : 'text'}
            icon={<ControlOutlined />}
            title={t('chat.features')}
          />
        </Popover>

        {/* MCP toggle */}
        <Popover
          content={mcpContent}
          trigger="click"
          open={mcpOpen}
          onOpenChange={(open) => {
            setMcpOpen(open)
            if (open) loadMcpServers()
          }}
          placement="topLeft"
        >
          <Button
            size="small"
            type={mcpServers.some((s) => s.connected) ? 'primary' : 'text'}
            icon={<ApiOutlined />}
            title={t('chat.mcpServers')}
          />
        </Popover>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Attachment */}
        <Tooltip title={t('chat.uploadFile')}>
          <Button
            size="small"
            type="text"
            icon={<PaperClipOutlined />}
            onClick={handleFileSelect}
            disabled={streaming}
          />
        </Tooltip>

        {/* Send / Stop */}
        {streaming ? (
          <Button size="small" type="default" icon={<SendOutlined />} disabled />
        ) : (
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            disabled={!hasContent || !selectedModelId}
          />
        )}
      </div>

      {/* Pending file previews */}
      {pendingFiles.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {pendingFiles.map((pf) => (
            <div
              key={pf.id}
              style={{
                position: 'relative',
                borderRadius: 8,
                border: `1px solid ${token.colorBorderSecondary}`,
                padding: 4,
                background: token.colorBgElevated,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                maxWidth: 200
              }}
            >
              {pf.previewUrl ? (
                <Image
                  src={pf.previewUrl}
                  width={48}
                  height={48}
                  style={{ borderRadius: 4, objectFit: 'cover' }}
                  preview={false}
                />
              ) : (
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 4,
                    background: token.colorFillTertiary,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    color: token.colorTextSecondary,
                    padding: 2,
                    textAlign: 'center',
                    wordBreak: 'break-all'
                  }}
                >
                  {pf.file.name.split('.').pop()?.toUpperCase() || 'FILE'}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: token.colorText,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {pf.file.name}
                </div>
                <div style={{ fontSize: 10, color: token.colorTextSecondary }}>
                  {(pf.file.size / 1024).toFixed(0)} KB
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
                  borderRadius: '50%'
                }}
                onClick={() => removeFile(pf.id)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Textarea */}
      <TextArea
        ref={textAreaRef}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={selectedModelId ? t('chat.inputPlaceholder') : t('chat.selectModelFirst')}
        disabled={streaming}
        style={{ resize: 'none', height: 80 }}
      />

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_TYPES}
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  )
}

export default ChatInput
