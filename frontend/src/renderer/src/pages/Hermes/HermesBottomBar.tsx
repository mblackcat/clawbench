import React from 'react'
import { Button, Space } from 'antd'
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons'
import { useT } from '../../i18n'

interface HermesBottomBarProps {
  dirty: boolean
  saving: boolean
  applying: boolean
  onSave: () => void
  onApply: () => void
}

const HermesBottomBar: React.FC<HermesBottomBarProps> = ({ dirty, saving, applying, onSave, onApply }) => {
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
          {t('hermes.save')}
        </Button>
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          disabled={!dirty || saving || applying}
          loading={applying}
          onClick={onApply}
        >
          {t('hermes.apply')}
        </Button>
      </Space>
    </div>
  )
}

export default HermesBottomBar
