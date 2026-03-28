import React, { useEffect, useState } from 'react'
import {
  Typography,
  Select,
  Button,
  Card,
  Descriptions,
  Tag,
  Result,
  Spin,
  Steps,
  App
} from 'antd'
import { CloudUploadOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import type { SubAppManifest } from '../../types/subapp'
import { apiClient } from '../../services/apiClient'
import { applicationManager } from '../../services/applicationManager'
import { useAuthStore } from '../../stores/useAuthStore'

const { Title, Paragraph } = Typography

const TYPE_LABELS: Record<string, string> = {
  app: '应用',
  'ai-skill': 'AI 技能',
  prompt: '提示词'
}

function getTypeLabel(type?: string): string {
  return TYPE_LABELS[type || 'app'] || '应用'
}

const AppPublisher: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { loggedIn, isLocalMode } = useAuthStore()
  const canPublish = loggedIn && !isLocalMode
  const initialAppId = (location.state as { appId?: string })?.appId

  const [apps, setApps] = useState<SubAppManifest[]>([])
  const [selectedAppId, setSelectedAppId] = useState<string | undefined>(initialAppId)
  const [loading, setLoading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [publishResult, setPublishResult] = useState<{
    status: 'success' | 'error'
    message: string
  } | null>(null)

  const selectedApp = apps.find((a) => a.id === selectedAppId)
  const typeLabel = getTypeLabel(selectedApp?.type)

  const steps = [
    { title: `选择${typeLabel}` },
    { title: `创建/更新${typeLabel}` },
    { title: `上传${typeLabel}包` },
    { title: '完成' }
  ]

  useEffect(() => {
    const fetchApps = async (): Promise<void> => {
      setLoading(true)
      try {
        const result = await window.api.developer.listMyApps()
        setApps(result)
      } catch {
        message.error('加载应用列表失败')
      } finally {
        setLoading(false)
      }
    }
    fetchApps()
  }, [])

  const handlePublish = async (): Promise<void> => {
    if (!selectedAppId || !selectedApp) return
    
    setPublishing(true)
    setCurrentStep(1)

    try {
      // 检查用户是否登录（支持本地模式 + 密码/飞书登录）
      const { loggedIn, isLocalMode } = useAuthStore.getState()
      if (!loggedIn || isLocalMode) {
        throw new Error(isLocalMode ? '本地模式不支持发布，请使用账号登录' : '请先登录后再发布')
      }

      // 步骤1: 准备应用信息
      const prepareResult = await window.api.developer.publishApp(selectedAppId)
      if (!prepareResult.success) {
        throw new Error(prepareResult.error || '准备应用失败')
      }

      const manifest = prepareResult.manifest

      // 步骤2: 创建或更新应用到服务端
      setCurrentStep(2)
      let applicationId: string

      try {
        // 尝试获取已存在的应用
        const userApps = await applicationManager.fetchUserApplications()
        const existingApp = userApps.find(app => app.name === manifest.name)

        if (existingApp) {
          // 更新现有应用
          await applicationManager.updateApplication(existingApp.applicationId, {
            name: manifest.name,
            description: manifest.description,
            metadata: {
              entry: manifest.entry,
              category: manifest.category,
              supported_workspace_types: manifest.supported_workspace_types,
              params: manifest.params
            }
          })
          applicationId = existingApp.applicationId
        } else {
          // 创建新应用
          const newApp = await applicationManager.createApplication({
            name: manifest.name,
            description: manifest.description,
            version: manifest.version,
            category: manifest.category || 'general',
            type: manifest.type || 'app',
            metadata: {
              entry: manifest.entry,
              supported_workspace_types: manifest.supported_workspace_types,
              params: manifest.params
            }
          })
          applicationId = newApp.applicationId
        }
      } catch (error) {
        console.error('Failed to create/update application:', error)
        throw new Error('创建或更新应用失败')
      }

      // 步骤3: 打包并上传应用包
      setCurrentStep(3)

      // 打包应用目录为 zip
      const packageResult = await window.api.developer.packageApp(selectedAppId)

      // 将 Buffer 转为 File 对象
      const uint8Array = new Uint8Array(packageResult.buffer)
      const blob = new Blob([uint8Array], { type: 'application/zip' })
      const file = new File([blob], packageResult.fileName, { type: 'application/zip' })

      // 上传到服务端
      await applicationManager.uploadApplication(
        applicationId,
        file,
        manifest.version,
        `发布 ${manifest.name} v${manifest.version}`
      )

      setCurrentStep(3)
      setPublishResult({
        status: 'success',
        message: `${getTypeLabel(manifest.type)} "${manifest.name}" v${manifest.version} 已成功发布到服务端。`
      })

    } catch (err) {
      console.error('Publish failed:', err)
      setPublishResult({
        status: 'error',
        message: err instanceof Error ? err.message : '发布失败'
      })
    } finally {
      setPublishing(false)
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    )
  }

  if (publishResult) {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <Result
          status={publishResult.status}
          title={publishResult.status === 'success' ? '发布成功' : '发布失败'}
          subTitle={publishResult.message}
          extra={[
            <Button key="back" onClick={() => navigate('/apps/library')}>
              返回发现
            </Button>,
            <Button key="reset" type="primary" onClick={() => {
              setPublishResult(null)
              setCurrentStep(0)
            }}>
              继续发布
            </Button>
          ]}
        />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 24 }}>
        发布{typeLabel}
      </Title>

      {!canPublish && (
        <Card style={{ marginBottom: 16, background: '#fff7e6', borderColor: '#ffa940' }}>
          <Paragraph style={{ margin: 0 }}>
            {isLocalMode
              ? '本地模式不支持发布，请使用账号登录后再发布。'
              : '发布需要登录。请先登录后再继续。'}
          </Paragraph>
        </Card>
      )}

      {publishing && (
        <Card style={{ marginBottom: 16 }}>
          <Steps current={currentStep} items={steps} style={{ marginBottom: 24 }} />
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin size="large" />
            <div style={{ marginTop: 16 }}>
              {currentStep === 1 && `正在准备${typeLabel}信息...`}
              {currentStep === 2 && `正在创建/更新${typeLabel}...`}
              {currentStep === 3 && `正在打包并上传${typeLabel}包...`}
            </div>
          </div>
        </Card>
      )}

      {!publishing && (
        <>
          <div style={{ marginBottom: 16 }}>
            <Select
              value={selectedAppId}
              onChange={setSelectedAppId}
              placeholder={`选择要发布的${typeLabel}`}
              style={{ width: '100%' }}
              size="large"
              options={apps.map((app) => ({
                label: `${app.name} (${app.version})`,
                value: app.id
              }))}
            />
          </div>

          {selectedApp && (
            <Card style={{ marginBottom: 16 }}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="名称">{selectedApp.name}</Descriptions.Item>
                <Descriptions.Item label="ID">{selectedApp.id}</Descriptions.Item>
                <Descriptions.Item label="版本">
                  <Tag>{selectedApp.version}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="描述">
                  {selectedApp.description}
                </Descriptions.Item>
                <Descriptions.Item label="作者">
                  {selectedApp.author && (typeof selectedApp.author === 'string' ? selectedApp.author : selectedApp.author.name)}
                </Descriptions.Item>
                <Descriptions.Item label="入口">{selectedApp.entry}</Descriptions.Item>
                {selectedApp.supported_workspace_types &&
                  selectedApp.supported_workspace_types.length > 0 && (
                    <Descriptions.Item label="支持的工作区">
                      {selectedApp.supported_workspace_types.map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                    </Descriptions.Item>
                  )}
              </Descriptions>
            </Card>
          )}

          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            loading={publishing}
            disabled={!selectedAppId || !canPublish}
            onClick={handlePublish}
            size="large"
            block
          >
            发布到服务端
          </Button>
        </>
      )}
    </div>
  )
}

export default AppPublisher
