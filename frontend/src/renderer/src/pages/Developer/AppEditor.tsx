import React, { useState, useEffect } from 'react'
import {
  Steps,
  Form,
  Input,
  Select,
  Switch,
  Button,
  Checkbox,
  Space,
  Card,
  Typography,
  App,
  Spin,
  theme
} from 'antd'
import { PlusOutlined, MinusCircleOutlined, DeleteOutlined, CodeOutlined, RobotOutlined, ArrowLeftOutlined } from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import type { ParamType } from '../../types/subapp'
import { useAuthStore } from '../../stores/useAuthStore'
import AIGenerateModal from '../../components/AIGenerateModal'
import { useT } from '../../i18n'

const { Title, Paragraph } = Typography
const { TextArea } = Input

const WORKSPACE_TYPE_VALUES = [
  { label: 'Git', value: 'git' },
  { label: 'SVN', value: 'svn' },
  { label: 'Perforce', value: 'perforce' },
]

const PARAM_TYPE_VALUES: { label: string; value: ParamType }[] = [
  { label: 'String', value: 'string' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Number', value: 'number' },
  { label: 'Enum', value: 'enum' },
  { label: 'Path', value: 'path' },
  { label: 'Text', value: 'text' }
]

const AppEditor: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { token } = theme.useToken()
  const { message, modal } = App.useApp()
  const t = useT()
  const [currentStep, setCurrentStep] = useState(0)
  const [form] = Form.useForm()
  const [generating, setGenerating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [appId, setAppId] = useState<string | null>(null)
  const [aiModalOpen, setAIModalOpen] = useState(false)
  const [aiModalAppId, setAIModalAppId] = useState('')
  const [aiModalManifest, setAIModalManifest] = useState<Record<string, unknown>>({})
  const user = useAuthStore((state) => state.user)

  // Load existing app data if in edit mode
  useEffect(() => {
    const loadAppData = async (): Promise<void> => {
      const state = location.state as { appId?: string } | null
      if (state?.appId) {
        setEditMode(true)
        setAppId(state.appId)
        setLoading(true)
        try {
          const manifest = await window.api.subapp.getManifest(state.appId)
          // Populate form with all data
          form.setFieldsValue({
            name: manifest.name,
            description: manifest.description,
            version: manifest.version,
            supported_workspace_types: manifest.supported_workspace_types || [],
            params: manifest.params || []
          })
        } catch (err) {
          message.error(t('appEditor.loadFailed'))
          navigate('/apps/my-contributions')
        } finally {
          setLoading(false)
        }
      }
    }
    loadAppData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  const handleNext = async (): Promise<void> => {
    if (currentStep === 0) {
      try {
        await form.validateFields(['name', 'version'])
        setCurrentStep(1)
      } catch {
        // validation failed
      }
    } else if (currentStep === 1) {
      setCurrentStep(2)
    } else if (currentStep === 2) {
      setCurrentStep(3)
    }
  }

  const handlePrev = (): void => {
    setCurrentStep((prev) => prev - 1)
  }

  const generateAppId = (name: string): string => {
    const uuid = crypto.randomUUID().slice(0, 8)
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    return `${uuid}-${slug || 'app'}`
  }

  const getManifestPreview = (): Record<string, unknown> => {
    const values = form.getFieldsValue()

    // In edit mode, use existing appId; in create mode, generate new one
    const manifestId = editMode && appId ? appId : generateAppId(values.name ?? '')

    const author = user ? {
      name: user.name || user.username || 'Unknown',
      email: user.email,
      feishu_id: user.feishu_id || user.id
    } : { name: 'Unknown' }

    const manifest = {
      id: manifestId,
      name: values.name ?? '',
      version: values.version ?? '1.0.0',
      description: values.description ?? '',
      author: author,
      entry: 'main.py',
      supported_workspace_types: values.supported_workspace_types ?? [],
      params: values.params ?? [],
      confirm_before_run: false,
      min_sdk_version: '1.0.0',
      published: false
    }

    return manifest
  }

  const handleGenerate = async (): Promise<void> => {
    setGenerating(true)
    try {
      const manifest = getManifestPreview()

      if (editMode && appId) {
        await window.api.developer.updateApp(appId, manifest)
        message.success(t('appEditor.appUpdated'))
        navigate(`/developer/code/${appId}`)
      } else {
        await window.api.developer.createApp(manifest)
        message.success(t('appEditor.appCreated', manifest.name as string))
        const newAppId = manifest.id as string
        navigate(`/developer/code/${newAppId}`)
      }
    } catch (err) {
      message.error(editMode ? t('appEditor.updateFailed') : t('appEditor.createFailed'))
    } finally {
      setGenerating(false)
    }
  }

  const handleDelete = () => {
    if (!appId) return

    modal.confirm({
      title: t('appEditor.deleteConfirmTitle'),
      content: t('appEditor.deleteConfirmContent', appId),
      okText: t('appEditor.deleteConfirmOk'),
      okType: 'danger',
      cancelText: t('appEditor.deleteConfirmCancel'),
      onOk: async () => {
        try {
          await window.api.developer.deleteApp(appId)
          message.success(t('appEditor.appDeleted'))
          navigate('/apps/my-contributions')
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          message.error(t('appEditor.deleteFailed', errorMsg))
        }
      }
    })
  }

  const handleCodeEditor = () => {
    if (!appId) return
    navigate(`/developer/code/${appId}`)
  }

  const handleAIGenerate = async (): Promise<void> => {
    setGenerating(true)
    try {
      const manifest = getManifestPreview()
      let effectiveAppId: string

      if (editMode && appId) {
        await window.api.developer.updateApp(appId, manifest)
        effectiveAppId = appId
      } else {
        await window.api.developer.createApp(manifest)
        effectiveAppId = manifest.id as string
        setAppId(effectiveAppId)
      }

      setAIModalAppId(effectiveAppId)
      setAIModalManifest(manifest)
      setAIModalOpen(true)
    } catch (err) {
      message.error(t('appEditor.createDirFailed'))
    } finally {
      setGenerating(false)
    }
  }

  const handleClose = () => {
    navigate('/apps/my-contributions')
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', position: 'relative', paddingTop: 24 }}>
      {loading && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: token.colorBgMask,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            borderRadius: 8
          }}
        >
          <Spin size="large" />
          <div style={{ marginTop: 16, color: token.colorTextSecondary }}>{t('appEditor.loading')}</div>
        </div>
      )}

      <Title level={4} style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={handleClose}>
              {t('common.back')}
            </Button>
            <span>{editMode ? t('appEditor.editTitle') : t('appEditor.createTitle')}</span>
          </Space>
          {editMode && (
            <Space>
              <Button icon={<CodeOutlined />} onClick={handleCodeEditor}>
                {t('appEditor.codeEditor')}
              </Button>
              <Button danger icon={<DeleteOutlined />} onClick={handleDelete}>
                {t('appEditor.deleteApp')}
              </Button>
            </Space>
          )}
        </div>
      </Title>

      <Steps current={currentStep} items={[
        { title: t('appEditor.stepBasicInfo') },
        { title: t('appEditor.stepParams') },
        { title: t('appEditor.stepPreview') },
        { title: t('appEditor.stepGenerate') }
      ]} style={{ marginBottom: 32 }} />

      <Form form={form} layout="vertical">
        {/* Step 1: Basic Info */}
        <div style={{ display: currentStep === 0 ? 'block' : 'none' }}>
          <Form.Item
            name="name"
            label={t('appEditor.appName')}
            rules={[{ required: true, message: t('appEditor.appNameRequired') }]}
          >
            <Input placeholder="My App" />
          </Form.Item>

          <Form.Item name="description" label={t('appEditor.description')}>
            <TextArea rows={3} placeholder={t('appEditor.descriptionPlaceholder')} />
          </Form.Item>

          <Form.Item
            name="version"
            label={t('appEditor.version')}
            initialValue="1.0.0"
            rules={[{ required: true, message: t('appEditor.versionRequired') }]}
          >
            <Input placeholder="1.0.0" />
          </Form.Item>

          <Form.Item name="supported_workspace_types" label={t('appEditor.workspaceTypes')}>
            <Checkbox.Group>
              <Space wrap>
                {WORKSPACE_TYPE_VALUES.map((wt) => (
                  <Checkbox key={wt.value} value={wt.value}>
                    {wt.label}
                  </Checkbox>
                ))}
                <Checkbox key="none" value="none">
                  {t('appEditor.workspaceNone')}
                </Checkbox>
              </Space>
            </Checkbox.Group>
          </Form.Item>
        </div>

        {/* Step 2: Params Definition */}
        <div style={{ display: currentStep === 1 ? 'block' : 'none' }}>
          <Form.List name="params">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Card
                    key={field.key}
                    size="small"
                    style={{ marginBottom: 12 }}
                    extra={
                      <MinusCircleOutlined
                        style={{ color: '#ff4d4f' }}
                        onClick={() => remove(field.name)}
                      />
                    }
                  >
                    <Space
                      style={{ display: 'flex', flexWrap: 'wrap' }}
                      size={12}
                    >
                      <Form.Item
                        name={[field.name, 'name']}
                        label={t('appEditor.paramName')}
                        rules={[{ required: true, message: t('appEditor.fieldRequired') }]}
                        style={{ marginBottom: 8 }}
                      >
                        <Input placeholder="param_name" style={{ width: 160 }} />
                      </Form.Item>

                      <Form.Item
                        name={[field.name, 'type']}
                        label={t('appEditor.paramType')}
                        rules={[{ required: true, message: t('appEditor.fieldRequired') }]}
                        style={{ marginBottom: 8 }}
                      >
                        <Select
                          options={PARAM_TYPE_VALUES}
                          placeholder={t('appEditor.paramTypePlaceholder')}
                          style={{ width: 120 }}
                        />
                      </Form.Item>

                      <Form.Item
                        name={[field.name, 'label']}
                        label={t('appEditor.paramLabel')}
                        rules={[{ required: true, message: t('appEditor.fieldRequired') }]}
                        style={{ marginBottom: 8 }}
                      >
                        <Input placeholder={t('appEditor.paramLabelPlaceholder')} style={{ width: 160 }} />
                      </Form.Item>

                      <Form.Item
                        name={[field.name, 'required']}
                        label={t('appEditor.paramRequired')}
                        valuePropName="checked"
                        style={{ marginBottom: 8 }}
                      >
                        <Switch size="small" />
                      </Form.Item>

                      <Form.Item
                        name={[field.name, 'default']}
                        label={t('appEditor.paramDefault')}
                        style={{ marginBottom: 8 }}
                      >
                        <Input placeholder={t('appEditor.paramDefaultPlaceholder')} style={{ width: 160 }} />
                      </Form.Item>
                    </Space>
                  </Card>
                ))}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  onClick={() => add()}
                >
                  {t('appEditor.addParam')}
                </Button>
              </>
            )}
          </Form.List>
        </div>

        {/* Step 3: Preview & Generate */}
        <div style={{ display: currentStep === 2 ? 'block' : 'none' }}>
          <Paragraph>{t('appEditor.previewManifest')}</Paragraph>
          <Card style={{ background: token.colorBgContainer }}>
            <pre style={{
              margin: 0,
              fontSize: 13,
              whiteSpace: 'pre-wrap',
              color: token.colorText
            }}>
              {currentStep === 2 ? JSON.stringify(getManifestPreview(), null, 2) : ''}
            </pre>
          </Card>
        </div>

        {/* Step 4: Generating */}
        <div style={{ display: currentStep === 3 ? 'block' : 'none' }}>
          {generating ? (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <Spin size="large" />
              <div style={{ marginTop: 16, color: token.colorTextSecondary }}>
                {editMode ? t('appEditor.generatingUpdate') : t('appEditor.generatingCreate')}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <Paragraph>{t('appEditor.generateHint')}</Paragraph>
            </div>
          )}
        </div>
      </Form>

      {/* Navigation Buttons */}
      <div
        style={{
          marginTop: 24,
          display: 'flex',
          justifyContent: 'space-between'
        }}
      >
        <div>
          {currentStep > 0 && currentStep < 3 && <Button onClick={handlePrev}>{t('appEditor.prev')}</Button>}
        </div>
        <Space>
          {currentStep < 3 && <Button onClick={handleClose}>{t('appEditor.cancel')}</Button>}
          {currentStep < 2 ? (
            <Button type="primary" onClick={handleNext}>
              {t('appEditor.next')}
            </Button>
          ) : currentStep === 2 ? (
            <Button type="primary" onClick={handleNext}>
              {t('appEditor.confirmGenerate')}
            </Button>
          ) : (
            <Space>
              <Button
                icon={<RobotOutlined />}
                loading={generating}
                onClick={handleAIGenerate}
              >
                {t('appEditor.aiGenerate')}
              </Button>
              <Button type="primary" loading={generating} onClick={handleGenerate}>
                {editMode ? t('appEditor.saveAndOpen') : t('appEditor.generateAndOpen')}
              </Button>
            </Space>
          )}
        </Space>
      </div>

      <AIGenerateModal
        open={aiModalOpen}
        manifest={aiModalManifest}
        appId={aiModalAppId}
        onClose={() => setAIModalOpen(false)}
        onSuccess={() => {
          setAIModalOpen(false)
          navigate(`/developer/code/${aiModalAppId}`)
        }}
      />
    </div>
  )
}

export default AppEditor
