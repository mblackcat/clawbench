import React, { useEffect, useState, useMemo } from 'react'
import { Modal, Form, Input, Typography, App, Button, Space, Tag, Divider, Switch, Select } from 'antd'
import {
  LinkOutlined,
  DisconnectOutlined,
  ExperimentOutlined,
  LoadingOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import type { AICodingIMConfig, AICodingIMConnectionStatus } from '../../types/ai-coding'
import FeishuGuideModal from '../../components/FeishuGuideModal'
import { useT } from '../../i18n'
import { useAIModelStore } from '../../stores/useAIModelStore'

const { Text } = Typography

interface AICodingIMConfigModalProps {
  open: boolean
  config: AICodingIMConfig
  imStatus: AICodingIMConnectionStatus
  onOk: (config: AICodingIMConfig) => Promise<void>
  onCancel: () => void
  onConnect: () => Promise<void>
  onDisconnect: () => Promise<void>
  onTest: () => Promise<{ success: boolean; error?: string }>
}

const AICodingIMConfigModal: React.FC<AICodingIMConfigModalProps> = ({
  open,
  config,
  imStatus,
  onOk,
  onCancel,
  onConnect,
  onDisconnect,
  onTest
}) => {
  const [form] = Form.useForm()
  const { message } = App.useApp()
  const [testing, setTesting] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [isGuideModalOpen, setIsGuideModalOpen] = useState(false)
  const [remoteEnabled, setRemoteEnabled] = useState(false)
  const t = useT()

  const localModels = useAIModelStore((s) => s.localModels)
  const fetchLocalModels = useAIModelStore((s) => s.fetchLocalModels)

  useEffect(() => {
    if (open) {
      fetchLocalModels().catch(() => {})
      form.setFieldsValue({
        feishuAppId: config.feishu.appId,
        feishuAppSecret: config.feishu.appSecret,
        modelConfigId: config.modelConfigId || undefined,
        modelId: config.modelId || undefined,
      })
      setRemoteEnabled(config.remoteEnabled === true)
    }
  }, [open, config, form, fetchLocalModels])

  const modelOptions = useMemo(() => {
    return (localModels || []).map((m) => ({
      value: m.id,
      label: m.name || m.id,
      models: m.models || [],
    }))
  }, [localModels])

  const selectedConfigId = Form.useWatch('modelConfigId', form)
  const modelIdOptions = useMemo(() => {
    const cfg = modelOptions.find((o) => o.value === selectedConfigId)
    return (cfg?.models || []).map((id: string) => ({ value: id, label: id }))
  }, [modelOptions, selectedConfigId])

  const buildConfig = (values: any): AICodingIMConfig => ({
    feishu: {
      appId: values.feishuAppId || '',
      appSecret: values.feishuAppSecret || ''
    },
    remoteEnabled,
    modelConfigId: values.modelConfigId || '',
    modelId: values.modelId || '',
    maxTurnsPerSession: config.maxTurnsPerSession ?? 40,
    idleTimeoutMs: config.idleTimeoutMs ?? 3_600_000,
  })

  const handleOk = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      await onOk(buildConfig(values))
      message.success(t('im.configSaved'))
    } catch {
      // validation error
    }
  }

  const handleTest = async (): Promise<void> => {
    const values = form.getFieldsValue()
    if (!values.feishuAppId || !values.feishuAppSecret) {
      message.warning(t('im.fillCredentials'))
      return
    }
    await onOk(buildConfig(values))
    setTesting(true)
    try {
      const result = await onTest()
      if (result.success) {
        message.success(t('im.testSuccess'))
      } else {
        message.error(t('im.testFailed', result.error || 'Unknown'))
      }
    } catch (err: any) {
      message.error(t('im.testFailed', err?.message || String(err)))
    } finally {
      setTesting(false)
    }
  }

  const handleConnect = async (): Promise<void> => {
    const values = form.getFieldsValue()
    if (!values.feishuAppId || !values.feishuAppSecret) {
      message.warning(t('im.fillCredentials'))
      return
    }
    if (!remoteEnabled) {
      message.warning(t('im.enableRemoteFirst'))
      return
    }
    await onOk(buildConfig(values))
    setConnecting(true)
    try {
      await onConnect()
      message.success(t('im.connected'))
    } catch (err: any) {
      message.error(t('im.connectFailed', err?.message || String(err)))
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    try {
      await onDisconnect()
      message.success(t('im.disconnected'))
    } catch (err: any) {
      message.error(t('im.disconnectFailed', err?.message || String(err)))
    }
  }

  const isConnected = imStatus.state === 'connected'
  const isConnecting = imStatus.state === 'connecting' || connecting

  const statusTag = (() => {
    switch (imStatus.state) {
      case 'connected':
        return <Tag color="success">{t('im.statusConnected')}</Tag>
      case 'connecting':
        return <Tag color="processing" icon={<LoadingOutlined />}>{t('im.statusConnecting')}</Tag>
      case 'error':
        return <Tag color="error">{t('im.statusError')}</Tag>
      default:
        return <Tag>{t('im.statusDisconnected')}</Tag>
    }
  })()

  return (
    <Modal
      title={t('im.title')}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText={t('im.save')}
      cancelText={t('im.cancel')}
      destroyOnHidden
      width={520}
    >
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
            <Text strong style={{ fontSize: 14, display: 'block' }}>{t('im.remoteEnabled')}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{t('im.remoteEnabledDesc')}</Text>
          </div>
          <Switch
            checked={remoteEnabled}
            onChange={setRemoteEnabled}
            disabled={isConnected}
          />
        </div>

        <Divider style={{ margin: '12px 0' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Space>
            <Text strong style={{ fontSize: 14 }}>{t('im.feishu')}</Text>
            <Button
              type="text"
              icon={<FileTextOutlined />}
              size="small"
              onClick={() => setIsGuideModalOpen(true)}
              title={t('im.viewGuide')}
            />
          </Space>
          {statusTag}
        </div>

        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="feishuAppId" label="App ID">
            <Input placeholder={t('im.appIdPlaceholder')} disabled={isConnected} />
          </Form.Item>
          <Form.Item name="feishuAppSecret" label="App Secret">
            <Input.Password placeholder={t('im.appSecretPlaceholder')} disabled={isConnected} />
          </Form.Item>
          <Form.Item name="modelConfigId" label={t('im.modelConfig')}>
            <Select
              allowClear
              placeholder={t('im.modelConfigPlaceholder')}
              options={modelOptions}
              disabled={isConnected}
              onChange={() => form.setFieldValue('modelId', undefined)}
            />
          </Form.Item>
          <Form.Item name="modelId" label={t('im.modelId')}>
            <Select
              allowClear
              placeholder={t('im.modelIdPlaceholder')}
              options={modelIdOptions}
              disabled={isConnected || !selectedConfigId}
            />
          </Form.Item>
        </Form>

        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>
          {t('im.agentHint')}
        </Text>

        {imStatus.state === 'error' && imStatus.error && (
          <Text type="danger" style={{ display: 'block', marginBottom: 12 }}>
            {t('im.error', imStatus.error || '')}
          </Text>
        )}

        <Space>
          <Button
            icon={<ExperimentOutlined />}
            onClick={handleTest}
            loading={testing}
            disabled={isConnected || isConnecting}
            size="small"
          >
            {t('im.testConnection')}
          </Button>
          {isConnected ? (
            <Button
              icon={<DisconnectOutlined />}
              onClick={handleDisconnect}
              danger
              size="small"
            >
              {t('im.disconnect')}
            </Button>
          ) : (
            <Button
              icon={<LinkOutlined />}
              onClick={handleConnect}
              type="primary"
              loading={isConnecting}
              size="small"
              disabled={!remoteEnabled}
            >
              {t('im.connect')}
            </Button>
          )}
        </Space>

        <Divider style={{ margin: '16px 0 12px' }} />

        <div style={{ opacity: 0.5 }}>
          <Text type="secondary">
            {t('im.moreIM')}
          </Text>
        </div>
      </div>
      <FeishuGuideModal
        open={isGuideModalOpen}
        onCancel={() => setIsGuideModalOpen(false)}
      />
    </Modal>
  )
}

export default AICodingIMConfigModal
