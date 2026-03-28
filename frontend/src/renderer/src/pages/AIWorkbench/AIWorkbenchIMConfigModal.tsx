import React, { useEffect, useState } from 'react'
import { Modal, Form, Input, Typography, App, Button, Space, Tag, Divider } from 'antd'
import {
  LinkOutlined,
  DisconnectOutlined,
  ExperimentOutlined,
  LoadingOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import type { AIWorkbenchIMConfig, AIWorkbenchIMConnectionStatus } from '../../types/ai-workbench'
import FeishuGuideModal from '../../components/FeishuGuideModal'
import { useT } from '../../i18n'

const { Text } = Typography

interface AIWorkbenchIMConfigModalProps {
  open: boolean
  config: AIWorkbenchIMConfig
  imStatus: AIWorkbenchIMConnectionStatus
  onOk: (config: AIWorkbenchIMConfig) => Promise<void>
  onCancel: () => void
  onConnect: () => Promise<void>
  onDisconnect: () => Promise<void>
  onTest: () => Promise<{ success: boolean; error?: string }>
}

const AIWorkbenchIMConfigModal: React.FC<AIWorkbenchIMConfigModalProps> = ({
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
  const t = useT()

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        feishuAppId: config.feishu.appId,
        feishuAppSecret: config.feishu.appSecret
      })
    }
  }, [open, config, form])

  const handleOk = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      await onOk({
        feishu: {
          appId: values.feishuAppId || '',
          appSecret: values.feishuAppSecret || ''
        }
      })
      message.success(t('im.configSaved'))
    } catch {
      // validation error
    }
  }

  const handleTest = async (): Promise<void> => {
    // First save config
    const values = form.getFieldsValue()
    if (!values.feishuAppId || !values.feishuAppSecret) {
      message.warning(t('im.fillCredentials'))
      return
    }
    await onOk({
      feishu: { appId: values.feishuAppId, appSecret: values.feishuAppSecret }
    })
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
    // Save config first
    const values = form.getFieldsValue()
    if (!values.feishuAppId || !values.feishuAppSecret) {
      message.warning(t('im.fillCredentials'))
      return
    }
    await onOk({
      feishu: { appId: values.feishuAppId, appSecret: values.feishuAppSecret }
    })
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
        </Form>

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

export default AIWorkbenchIMConfigModal
