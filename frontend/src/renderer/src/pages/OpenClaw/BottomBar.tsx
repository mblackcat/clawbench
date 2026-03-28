import React from 'react'
import { Button, Space, theme } from 'antd'
import { SaveOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { useT } from '../../i18n'

interface BottomBarProps {
  dirty: boolean
  saving: boolean
  applying: boolean
  onSave: () => void
  onApply: () => void
}

const BottomBar: React.FC<BottomBarProps> = ({ dirty, saving, applying, onSave, onApply }) => {
  const { token } = theme.useToken()
  const t = useT()

  return (
    <div
      className="cb-bottombar"
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        padding: '10px 24px'
      }}
    >
      <Space>
        <Button
          icon={<SaveOutlined />}
          disabled={!dirty || saving || applying}
          loading={saving}
          onClick={onSave}
        >
          {t('agents.save')}
        </Button>
        <Button
          type="primary"
          icon={<CheckCircleOutlined />}
          disabled={!dirty || saving || applying}
          loading={applying}
          onClick={onApply}
        >
          {t('agents.apply')}
        </Button>
      </Space>
    </div>
  )
}

export default BottomBar
