import React from 'react'
import { Modal, Descriptions, Typography, Space } from 'antd'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import { useT } from '../i18n'

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
  const t = useT()
  const hasParams = params && Object.keys(params).length > 0

  return (
    <Modal
      title={
        <Space>
          <ExclamationCircleOutlined style={{ color: '#faad14', fontSize: 20 }} />
          <span>{t('confirmRun.title')}</span>
        </Space>
      }
      open={open}
      onOk={onConfirm}
      onCancel={onCancel}
      okText={t('paramDrawer.run')}
      cancelText={t('common.cancel')}
      centered
      destroyOnHidden
    >
      <div style={{ marginBottom: hasParams ? 16 : 0, marginTop: 8 }}>
        <Text>
          {t('confirmRun.contentPrefix')}<Text strong>{appName}</Text>{t('confirmRun.contentSuffix')}
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
                    ? t('aiModel.yes')
                    : t('aiModel.no')
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
