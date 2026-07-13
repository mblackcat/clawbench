import React, { useEffect, useCallback, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import {
  App as AntdApp,
  Form,
  Input,
  InputNumber,
  Switch,
  Select,
  Button,
  Space,
  Tooltip,
  Typography,
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

/** Imperative surface exposed by AppParamFields to its parent. */
export interface AppParamFieldsHandle {
  /** Validate and return param values, or null if validation failed. */
  validate: () => Promise<Record<string, unknown> | null>
  /** Read current param values without validating. */
  getValues: () => Record<string, unknown>
}

interface AppParamFieldsProps {
  manifest: SubAppManifest | null
  initialValues?: Record<string, unknown>
  resolveSlot: (
    appId: string,
    slot: string,
    params?: Record<string, unknown>
  ) => Promise<unknown>
  /** Change this value to reset/populate the form (e.g. pass the parent `open` boolean). */
  resetKey?: unknown
  /** Notified whenever dynamic-option refresh activity changes (to disable submit). */
  onRefreshingChange?: (refreshing: boolean) => void
}

/**
 * Reusable manifest.params form. Owns its own <Form> instance so it can be
 * dropped into any container (ParamDrawer, AppScheduleModal) without colliding
 * with sibling form fields. Handles all param types incl. dynamic enum slots.
 */
const AppParamFields = forwardRef<AppParamFieldsHandle, AppParamFieldsProps>(
  ({ manifest, initialValues, resolveSlot, resetKey, onRefreshingChange }, ref) => {
    const [form] = Form.useForm()
    const { token } = theme.useToken()
    const { message } = AntdApp.useApp()
    const t = useT()
    const [dynamicOptionsByParam, setDynamicOptionsByParam] = useState<
      Record<string, DynamicOptionsResult>
    >({})
    const [refreshingParams, setRefreshingParams] = useState<Record<string, boolean>>({})
    const generationRef = useRef(0)
    const isRefreshing = Object.values(refreshingParams).some(Boolean)

    useEffect(() => {
      onRefreshingChange?.(isRefreshing)
    }, [isRefreshing, onRefreshingChange])

    useImperativeHandle(ref, () => ({
      validate: async () => {
        try {
          return await form.validateFields()
        } catch {
          return null
        }
      },
      getValues: () => form.getFieldsValue(true) as Record<string, unknown>
    }))

    // Reset and populate default values whenever resetKey/manifest/initialValues change
    useEffect(() => {
      generationRef.current += 1
      if (!manifest) {
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
    }, [resetKey, manifest, initialValues, form])

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
        const requestGeneration = generationRef.current

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
          if (requestGeneration !== generationRef.current) return

          setDynamicOptionsByParam((current) => ({
            ...current,
            [param.name]: result
          }))

          const nextValue = reconcileDynamicOptionValue(form.getFieldValue(param.name), result)
          if (nextValue === undefined) form.setFieldValue(param.name, undefined)
          else form.setFieldValue(param.name, nextValue)

          message.success(t('workbench.refreshOptionsSuccess', String(result.options.length)))
        } catch (error) {
          if (requestGeneration !== generationRef.current) return

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
          if (requestGeneration === generationRef.current) {
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
          return <Input placeholder={t('paramField.inputPlaceholder', param.label)} />

        case 'text':
          return <Input.TextArea rows={4} placeholder={t('paramField.inputPlaceholder', param.label)} />

        case 'number':
          return (
            <InputNumber
              style={{ width: '100%' }}
              placeholder={t('paramField.inputPlaceholder', param.label)}
            />
          )

        case 'boolean':
          return <Switch />

        case 'enum':
          return (
            <Select placeholder={t('paramField.selectPlaceholder', param.label)}>
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
              placeholder={t('paramField.selectPlaceholder', param.label)}
              readOnly
              addonAfter={
                <Button
                  type="link"
                  size="small"
                  icon={<FolderOpenOutlined />}
                  onClick={() => handleSelectDirectory(param.name)}
                  style={{ padding: 0, height: 'auto' }}
                >
                  {t('paramField.browse')}
                </Button>
              }
            />
          )

        default:
          return <Input placeholder={t('paramField.inputPlaceholder', param.label)} />
      }
    }

    const params = manifest?.params ?? []

    return (
      <Form form={form} layout="vertical" requiredMark="optional" component={false}>
        {params.length > 0 ? (
          params.map((param) => (
            <Form.Item
              key={param.name}
              name={param.name}
              label={renderLabel(param)}
              labelCol={{ style: { width: '100%' } }}
              rules={[{ required: param.required, message: t('paramField.required', param.label) }]}
              valuePropName={param.type === 'boolean' ? 'checked' : 'value'}
            >
              {renderField(param)}
            </Form.Item>
          ))
        ) : (
          <Text type="secondary">{t('appSchedule.noParams')}</Text>
        )}
      </Form>
    )
  }
)

AppParamFields.displayName = 'AppParamFields'

export default AppParamFields
