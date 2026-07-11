import React, { useEffect, useCallback, useRef, useState } from 'react'
import {
  App as AntdApp,
  Drawer,
  Form,
  Input,
  InputNumber,
  Switch,
  Select,
  Button,
  Space,
  Tooltip,
  Typography,
  Descriptions,
  theme
} from 'antd'
import {
  FolderOpenOutlined,
  QuestionCircleOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import type { SubAppManifest, ParamDef } from '../types/subapp'
import { buildManifestDefaultParams } from '../utils/subapp-params'
import {
  DynamicOptionsError,
  buildDynamicOptionsCacheKey,
  getDynamicOptionsCache,
  parseDynamicOptionsResult,
  reconcileDynamicOptionValue,
  setDynamicOptionsCache,
  type DynamicOptionsResult
} from '../utils/subapp-dynamic-options'
import { useT } from '../i18n'

const { Text } = Typography

interface ParamDrawerProps {
  open: boolean
  onClose: () => void
  manifest: SubAppManifest | null
  initialValues?: Record<string, unknown>
  resolveSlot: (
    appId: string,
    slot: string,
    params?: Record<string, unknown>
  ) => Promise<unknown>
  onSubmit: (params: Record<string, unknown>) => void
}

const ParamDrawer: React.FC<ParamDrawerProps> = ({
  open,
  onClose,
  manifest,
  initialValues,
  resolveSlot,
  onSubmit
}) => {
  const [form] = Form.useForm()
  const { token } = theme.useToken()
  const { message } = AntdApp.useApp()
  const t = useT()
  const [dynamicOptionsByParam, setDynamicOptionsByParam] = useState<
    Record<string, DynamicOptionsResult>
  >({})
  const [refreshingParams, setRefreshingParams] = useState<Record<string, boolean>>({})
  const drawerGenerationRef = useRef(0)
  const isRefreshing = Object.values(refreshingParams).some(Boolean)

  // Reset and populate default values whenever the drawer opens or manifest changes
  useEffect(() => {
    drawerGenerationRef.current += 1
    if (!open || !manifest) {
      setDynamicOptionsByParam({})
      setRefreshingParams({})
      return
    }

    const params = manifest.params ?? []
    const defaults = {
      ...(initialValues ?? buildManifestDefaultParams(params))
    }
    const cachedOptions: Record<string, DynamicOptionsResult> = {}

    for (const param of params) {
      if (param.type !== 'enum' || !param.options_slot?.trim()) continue
      const key = buildDynamicOptionsCacheKey(manifest.id, manifest.version, param)
      const cached = getDynamicOptionsCache(key)
      if (!cached) continue

      cachedOptions[param.name] = cached
      const reconciled = reconcileDynamicOptionValue(defaults[param.name], cached)
      if (reconciled === undefined) delete defaults[param.name]
      else defaults[param.name] = reconciled
    }

    setDynamicOptionsByParam(cachedOptions)
    setRefreshingParams({})
    form.resetFields()
    form.setFieldsValue(defaults)
  }, [open, manifest, initialValues, form])

  const handleSubmit = useCallback(async () => {
    try {
      const values = await form.validateFields()
      onSubmit(values)
    } catch {
      // Validation failed — form will show inline errors
    }
  }, [form, onSubmit])

  const handleSelectDirectory = useCallback(
    async (paramName: string) => {
      const selected = await window.api.dialog.selectDirectory()
      if (selected) {
        form.setFieldValue(paramName, selected)
      }
    },
    [form]
  )

  const handleRefreshOptions = useCallback(
    async (param: ParamDef) => {
      const slot = param.options_slot?.trim()
      if (!manifest || !slot || refreshingParams[param.name]) return
      const requestGeneration = drawerGenerationRef.current

      setRefreshingParams((current) => ({ ...current, [param.name]: true }))
      try {
        const data = await resolveSlot(
          manifest.id,
          slot,
          form.getFieldsValue(true) as Record<string, unknown>
        )
        const result = parseDynamicOptionsResult(data)
        const key = buildDynamicOptionsCacheKey(manifest.id, manifest.version, param)
        setDynamicOptionsCache(key, result)
        if (requestGeneration !== drawerGenerationRef.current) return

        setDynamicOptionsByParam((current) => ({
          ...current,
          [param.name]: result
        }))

        const nextValue = reconcileDynamicOptionValue(
          form.getFieldValue(param.name),
          result
        )
        if (nextValue === undefined) form.setFieldValue(param.name, undefined)
        else form.setFieldValue(param.name, nextValue)

        message.success(t('workbench.refreshOptionsSuccess', String(result.options.length)))
      } catch (error) {
        if (requestGeneration !== drawerGenerationRef.current) return

        if (error instanceof DynamicOptionsError) {
          message.error(
            t(
              error.code === 'empty'
                ? 'workbench.refreshOptionsEmpty'
                : 'workbench.refreshOptionsInvalid'
            )
          )
        } else {
          const reason = error instanceof Error ? error.message : String(error)
          if (reason === 'No active workspace selected') {
            message.error(t('workbench.selectWorkspaceFirst'))
          } else if (/timed out/i.test(reason)) {
            message.error(t('workbench.refreshOptionsTimeout'))
          } else {
            message.error(t('workbench.refreshOptionsFailed', reason))
          }
        }
      } finally {
        if (requestGeneration === drawerGenerationRef.current) {
          setRefreshingParams((current) => ({ ...current, [param.name]: false }))
        }
      }
    },
    [form, manifest, message, refreshingParams, resolveSlot, t]
  )

  const renderLabel = (param: ParamDef): React.ReactNode => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%'
      }}
    >
      <Space size={4}>
        <Text>{param.label}</Text>
        {param.description && (
          <Tooltip title={param.description}>
            <QuestionCircleOutlined style={{ color: token.colorTextTertiary, cursor: 'help' }} />
          </Tooltip>
        )}
      </Space>
      {param.type === 'enum' && param.options_slot?.trim() && (
        <Tooltip title={t('workbench.refreshOptions')}>
          <Button
            type="text"
            size="small"
            aria-label={t('workbench.refreshOptions')}
            icon={<ReloadOutlined spin={refreshingParams[param.name]} />}
            disabled={refreshingParams[param.name]}
            onClick={() => handleRefreshOptions(param)}
            style={{ padding: '0 4px', height: 24 }}
          />
        </Tooltip>
      )}
    </div>
  )

  const renderField = (param: ParamDef): React.ReactNode => {
    switch (param.type) {
      case 'string':
        return <Input placeholder={`请输入${param.label}`} />

      case 'text':
        return <Input.TextArea rows={4} placeholder={`请输入${param.label}`} />

      case 'number':
        return (
          <InputNumber
            style={{ width: '100%' }}
            placeholder={`请输入${param.label}`}
          />
        )

      case 'boolean':
        return <Switch />

      case 'enum':
        return (
          <Select placeholder={`请选择${param.label}`}>
            {(dynamicOptionsByParam[param.name]?.options ?? param.options ?? []).map((opt) => (
              <Select.Option key={opt} value={opt}>
                {opt}
              </Select.Option>
            ))}
          </Select>
        )

      case 'path':
        return (
          <Input
            placeholder={`请选择${param.label}`}
            readOnly
            addonAfter={
              <Button
                type="link"
                size="small"
                icon={<FolderOpenOutlined />}
                onClick={() => handleSelectDirectory(param.name)}
                style={{ padding: 0, height: 'auto' }}
              >
                浏览
              </Button>
            }
          />
        )

      default:
        return <Input placeholder={`请输入${param.label}`} />
    }
  }

  return (
    <Drawer
      title={manifest ? manifest.name : ''}
      placement="right"
      width={400}
      open={open}
      onClose={onClose}
      destroyOnHidden
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Space>
            <Button onClick={onClose}>{manifest?.params?.length ? '取消' : '关闭'}</Button>
            <Button type="primary" onClick={handleSubmit} disabled={isRefreshing}>
              执行
            </Button>
          </Space>
        </div>
      }
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark="optional"
      >
        <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item label="名称">{manifest?.name}</Descriptions.Item>
          <Descriptions.Item label="版本">{manifest?.version}</Descriptions.Item>
          {manifest?.description && (
            <Descriptions.Item label="描述">{manifest.description}</Descriptions.Item>
          )}
          {manifest?.author && (
            <Descriptions.Item label="作者">
              {typeof manifest.author === 'string' ? manifest.author : manifest.author.name}
            </Descriptions.Item>
          )}
        </Descriptions>

        {manifest?.params && manifest.params.length > 0 && manifest.params.map((param) => (
          <Form.Item
            key={param.name}
            name={param.name}
            label={renderLabel(param)}
            labelCol={{ style: { width: '100%' } }}
            rules={[
              {
                required: param.required,
                message: `${param.label}为必填项`
              }
            ]}
            valuePropName={param.type === 'boolean' ? 'checked' : 'value'}
          >
            {renderField(param)}
          </Form.Item>
        ))}
      </Form>
    </Drawer>
  )
}

export default ParamDrawer
