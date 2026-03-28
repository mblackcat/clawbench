import React, { useEffect, useCallback } from 'react'
import {
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
import { FolderOpenOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import type { SubAppManifest, ParamDef } from '../types/subapp'

const { Text } = Typography

interface ParamDrawerProps {
  open: boolean
  onClose: () => void
  manifest: SubAppManifest | null
  onSubmit: (params: Record<string, unknown>) => void
}

const ParamDrawer: React.FC<ParamDrawerProps> = ({ open, onClose, manifest, onSubmit }) => {
  const [form] = Form.useForm()
  const { token } = theme.useToken()

  // Reset and populate default values whenever the drawer opens or manifest changes
  useEffect(() => {
    if (open && manifest?.params) {
      const defaults: Record<string, unknown> = {}
      for (const param of manifest.params) {
        if (param.default !== undefined) {
          defaults[param.name] = param.default
        }
      }
      form.resetFields()
      form.setFieldsValue(defaults)
    }
  }, [open, manifest, form])

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

  const renderLabel = (param: ParamDef): React.ReactNode => (
    <Space size={4}>
      <Text>{param.label}</Text>
      {param.description && (
        <Tooltip title={param.description}>
          <QuestionCircleOutlined style={{ color: token.colorTextTertiary, cursor: 'help' }} />
        </Tooltip>
      )}
    </Space>
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
            {param.options?.map((opt) => (
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
      title={manifest ? `${manifest.name} - 参数配置` : '参数配置'}
      placement="right"
      width={400}
      open={open}
      onClose={onClose}
      destroyOnHidden
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" onClick={handleSubmit}>
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
