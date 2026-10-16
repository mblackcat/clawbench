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
import { CloudUploadOutlined, ArrowLeftOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import type { SubAppManifest } from '../../types/subapp'
import { applicationManager } from '../../services/applicationManager'
import { useAuthStore } from '../../stores/useAuthStore'
import { useT } from '../../i18n'
import { isBuiltinAppId, builtinAppKeyFromId } from '../../utils/app-status'
import { isAdminUser } from '../../utils/is-admin-user'

/** Client-specified application IDs accepted by the backend. */
const APPLICATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/

/** Legacy scaffolds wrote "general"; anything else (incl. free text) is kept. */
function normalizePublishCategory(raw: unknown): string {
  const category = typeof raw === 'string' ? raw.trim() : ''
  return !category || category === 'general' ? 'other' : category
}

const { Title, Paragraph } = Typography

const AppPublisher: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const t = useT()
  const { loggedIn, isLocalMode } = useAuthStore()
  const canPublish = loggedIn && !isLocalMode
  const initialState = location.state as { appId?: string; from?: string } | null
  const initialAppId = initialState?.appId
  // Where to return to. Falls back to /workbench/my-contributions so direct
  // URL entry never strands the user with navigate(-1) → blank page.
  const backTarget = initialState?.from || '/workbench/my-contributions'

  const getTypeLabel = (type?: string): string => {
    switch (type) {
      case 'ai-skill': return t('appPublisher.typeSkill')
      case 'prompt': return t('appPublisher.typePrompt')
      default: return t('appPublisher.typeApp')
    }
  }

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
    { title: t('appPublisher.stepSelect', typeLabel) },
    { title: t('appPublisher.stepCreate', typeLabel) },
    { title: t('appPublisher.stepUpload', typeLabel) },
    { title: t('appPublisher.stepDone') }
  ]

  useEffect(() => {
    const fetchApps = async (): Promise<void> => {
      setLoading(true)
      try {
        const isAdmin = isAdminUser(useAuthStore.getState().user)
        // Admins additionally see builtin apps so they can overwrite-publish
        // the same-id builtin on the server.
        const result = await window.api.developer.listMyApps(
          isAdmin ? { includeBuiltins: true } : undefined
        )
        setApps(
          isAdmin
            ? result.filter((a) => !a.id.startsWith('com.clawbench.') || isBuiltinAppId(a.id))
            : result
        )
      } catch {
        message.error(t('appPublisher.loadListFailed'))
      } finally {
        setLoading(false)
      }
    }
    fetchApps()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handlePublish = async (): Promise<void> => {
    if (!selectedAppId || !selectedApp) return
    
    setPublishing(true)
    setCurrentStep(1)

    try {
      // 检查用户是否登录（支持本地模式 + 密码/飞书登录）
      const { loggedIn, isLocalMode } = useAuthStore.getState()
      if (!loggedIn || isLocalMode) {
        throw new Error(isLocalMode ? t('appPublisher.localModeError') : t('appPublisher.loginRequiredError'))
      }

      // 步骤1: 准备应用信息
      const prepareResult = await window.api.developer.publishApp(selectedAppId)
      if (!prepareResult.success) {
        throw new Error(prepareResult.error || t('appPublisher.prepareFailed'))
      }

      const manifest = prepareResult.manifest

      // Builtin app (admin overwrite-publish): upload the archive to
      // /common-apps/:appKey/upload; the server version then wins over the
      // bundled copy on every client. Never enters the marketplace table.
      if (isBuiltinAppId(selectedAppId)) {
        setCurrentStep(2)
        const packageResult = await window.api.developer.packageApp(selectedAppId)
        const builtinBlob = new Blob([new Uint8Array(packageResult.buffer)], { type: 'application/zip' })
        const builtinFile = new File([builtinBlob], packageResult.fileName, { type: 'application/zip' })
        setCurrentStep(3)
        await applicationManager.uploadBuiltinApp(
          builtinAppKeyFromId(selectedAppId),
          builtinFile,
          manifest.version,
          t('appPublisher.changelog', manifest.name, manifest.version)
        )
        setPublishResult({
          status: 'success',
          message: t('appPublisher.builtinPublishSuccess', manifest.name, manifest.version)
        })
        return
      }

      // 步骤2: 创建或更新应用到服务端
      setCurrentStep(2)
      let applicationId: string

      try {
        // 已存在的应用：优先按 manifest.id 匹配，兼容历史数据按名称匹配
        const userApps = await applicationManager.fetchUserApplications()
        const existingApp =
          userApps.find(app => app.applicationId === manifest.id) ||
          userApps.find(app => app.name === manifest.name)
        const category = normalizePublishCategory(manifest.category)

        // Build marketplace metadata — include cover/icon/url for all resource types
        const cover =
          (typeof manifest.icon === 'string' && manifest.icon.trim()) ||
          (typeof (manifest as any).coverUrl === 'string' && String((manifest as any).coverUrl).trim()) ||
          ''
        const publishMetadata: Record<string, unknown> = {
          entry: manifest.entry,
          category,
          supported_workspace_types: manifest.supported_workspace_types,
          params: manifest.params,
        }
        if (cover) {
          publishMetadata.coverUrl = cover
          publishMetadata.icon = cover
        }
        if (typeof manifest.url === 'string' && manifest.url.trim()) {
          publishMetadata.url = manifest.url.trim()
        }
        if (manifest.mini != null) {
          publishMetadata.mini = !!manifest.mini
        }

        if (existingApp) {
          // 更新现有应用
          await applicationManager.updateApplication(existingApp.applicationId, {
            name: manifest.name,
            description: manifest.description,
            category,
            metadata: publishMetadata,
          })
          applicationId = existingApp.applicationId
        } else {
          // 创建新应用
          // 以 manifest.id 作为服务端应用唯一标识（格式不合法时由服务端生成）
          const newApp = await applicationManager.createApplication({
            ...(manifest.id && APPLICATION_ID_PATTERN.test(manifest.id)
              ? { applicationId: manifest.id }
              : {}),
            name: manifest.name,
            description: manifest.description,
            version: manifest.version,
            category,
            type: manifest.type || 'app',
            metadata: publishMetadata,
          })
          applicationId = newApp.applicationId
        }
      } catch (error) {
        console.error('Failed to create/update application:', error)
        throw new Error(t('appPublisher.createOrUpdateFailed', error instanceof Error ? error.message : String(error)))
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
        t('appPublisher.changelog', manifest.name, manifest.version)
      )

      // Write back published=true to the local manifest so other pages
      // (收藏栏, 我的) can immediately reflect the published state without
      // waiting on a server refetch. Combined with the server-side
      // published-name set they already use, this is belt + suspenders.
      try {
        await window.api.developer.updateApp(selectedAppId, { ...manifest, published: true })
      } catch (writebackErr) {
        // Non-fatal: server-side set will still mark it as published on
        // next fetch. Just log.
        console.warn('Failed to write back published flag:', writebackErr)
      }

      setCurrentStep(3)
      setPublishResult({
        status: 'success',
        message: t('appPublisher.publishSuccessMsg', getTypeLabel(manifest.type), manifest.name, manifest.version)
      })

    } catch (err) {
      console.error('Publish failed:', err)
      // Extract the most descriptive error message, handling both ApiClientError
      // (from backend 409/4xx responses) and regular Error instances.
      const errorMessage = err instanceof Error
        ? err.message || t('appPublisher.publishFailed')
        : t('appPublisher.publishFailed')
      setPublishResult({
        status: 'error',
        message: errorMessage
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
    const isSkillType = selectedApp?.type === 'ai-skill'
    const isPromptType = selectedApp?.type === 'prompt'
    const isLinkType = selectedApp?.type === 'link'
    const isAppType = !selectedApp?.type || selectedApp?.type === 'app'
    // Build exit buttons. Always include "去发现" and "去我的"; also offer
    // a context-aware "back to editor" so the user isn't forced to lose
    // their place after a publish.
    const editorButton = selectedAppId
      ? isAppType
        ? (
          <Button
            key="editor"
            type="primary"
            onClick={() => navigate(`/developer/code/${selectedAppId}`, { state: { from: '/developer/publish' } })}
          >
            {t('appPublisher.backToCodeEditor')}
          </Button>
        )
        : isSkillType
          ? (
            <Button
              key="editor"
              type="primary"
              onClick={() => navigate('/developer/new-skill', { state: { appId: selectedAppId, from: '/developer/publish' } })}
            >
              {t('appPublisher.backToSkillEditor')}
            </Button>
          )
          : isPromptType
            ? (
              <Button
                key="editor"
                type="primary"
                onClick={() => navigate('/developer/new-prompt', { state: { appId: selectedAppId, from: '/developer/publish' } })}
              >
                {t('appPublisher.backToPromptEditor')}
              </Button>
            )
            : isLinkType
              ? (
                <Button
                  key="editor"
                  type="primary"
                  onClick={() => navigate('/developer/new-link', { state: { appId: selectedAppId, from: '/developer/publish' } })}
                >
                  {t('appPublisher.backToLinkEditor')}
                </Button>
              )
              : null
      : null

    return (
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <Result
          status={publishResult.status}
          title={publishResult.status === 'success' ? t('appPublisher.resultSuccess') : t('appPublisher.resultError')}
          subTitle={publishResult.message}
          extra={[
            <Button key="back" onClick={() => navigate(backTarget)}>
              {t('common.back')}
            </Button>,
            <Button key="discover" onClick={() => navigate('/workbench/library')}>
              {t('appPublisher.backToDiscover')}
            </Button>,
            <Button
              key="mine"
              type={editorButton ? 'default' : 'primary'}
              onClick={() => navigate('/workbench/my-contributions')}
            >
              {t('appPublisher.backToMine')}
            </Button>,
            editorButton
          ]}
        />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(backTarget)}
        >
          {t('common.back')}
        </Button>
        <Title level={4} style={{ margin: 0 }}>
          {t('appPublisher.title', typeLabel)}
        </Title>
      </div>

      {!canPublish && (
        <Card style={{ marginBottom: 16, background: '#fff7e6', borderColor: '#ffa940' }}>
          <Paragraph style={{ margin: 0 }}>
            {isLocalMode
              ? t('appPublisher.localModeHint')
              : t('appPublisher.loginHint')}
          </Paragraph>
        </Card>
      )}

      {publishing && (
        <Card style={{ marginBottom: 16 }}>
          <Steps current={currentStep} items={steps} style={{ marginBottom: 24 }} />
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin size="large" />
            <div style={{ marginTop: 16 }}>
              {currentStep === 1 && t('appPublisher.preparingInfo', typeLabel)}
              {currentStep === 2 && t('appPublisher.creatingUpdating', typeLabel)}
              {currentStep === 3 && t('appPublisher.packagingUploading', typeLabel)}
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
              placeholder={t('appPublisher.selectPlaceholder', typeLabel)}
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
                <Descriptions.Item label={t('appPublisher.labelName')}>
                  {selectedApp.name}
                  {isBuiltinAppId(selectedApp.id) && (
                    <Tag color="blue" style={{ marginLeft: 8 }}>
                      {t('appPublisher.builtinBadge')}
                    </Tag>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label={t('appPublisher.labelId')}>{selectedApp.id}</Descriptions.Item>
                <Descriptions.Item label={t('appPublisher.labelVersion')}>
                  <Tag>{selectedApp.version}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label={t('appPublisher.labelDescription')}>
                  {selectedApp.description}
                </Descriptions.Item>
                <Descriptions.Item label={t('appPublisher.labelAuthor')}>
                  {selectedApp.author && (typeof selectedApp.author === 'string' ? selectedApp.author : selectedApp.author.name)}
                </Descriptions.Item>
                <Descriptions.Item label={t('appPublisher.labelEntry')}>{selectedApp.entry}</Descriptions.Item>
                {selectedApp.supported_workspace_types &&
                  selectedApp.supported_workspace_types.length > 0 && (
                    <Descriptions.Item label={t('appPublisher.labelWorkspaces')}>
                      {selectedApp.supported_workspace_types.map((wt) => (
                        <Tag key={wt}>{wt}</Tag>
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
            {t('appPublisher.publishButton')}
          </Button>
        </>
      )}
    </div>
  )
}

export default AppPublisher
