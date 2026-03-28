import React from 'react'
import { Modal, Descriptions, Typography, Space } from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons'

const { Text } = Typography

interface ConfirmRunDialogProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  appName: string
  params: Record<string, unknown> | null
}

const ConfirmRunDialog: React.FC<ConfirmRunDialogProps> = ({
  open,
  onConfirm,
  onCancel,
  appName,
  params
}) => {
  const hasParams = params && Object.keys(params).length > 0

  return (
    <Modal
      title={
        <Space>
          <ExclamationCircleOutlined style={{ color: '#faad14', fontSize: 20 }} />
          <span>确认执行</span>
        </Space>
      }
      open={open}
      onOk={onConfirm}
      onCancel={onCancel}
      okText="执行"
      cancelText="取消"
      centered
      destroyOnHidden
    >
      <div style={{ marginBottom: hasParams ? 16 : 0, marginTop: 8 }}>
        <Text>
          确定要执行 「<Text strong>{appName}</Text>」 吗？
        </Text>
      </div>

      {hasParams && (
        <Descriptions
          bordered
          column={1}
          size="small"
          style={{ marginTop: 8 }}
        >
          {Object.entries(params!).map(([key, value]) => (
            <Descriptions.Item key={key} label={key}>
              <Text style={{ wordBreak: 'break-all' }}>
                {typeof value === 'boolean'
                  ? value
                    ? '是'
                    : '否'
                  : value === null || value === undefined
                    ? '-'
                    : String(value)}
              </Text>
            </Descriptions.Item>
          ))}
        </Descriptions>
      )}
    </Modal>
  )
}

export default ConfirmRunDialog
