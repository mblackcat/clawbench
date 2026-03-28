import React from 'react'
import { Button, Space, Badge, theme } from 'antd'
import { SaveOutlined, ExportOutlined } from '@ant-design/icons'
import { useCopiperStore } from '../../stores/useCopiperStore'

interface CopiperBottomBarProps {
  onSave: () => void
  onExport: () => void
}

const CopiperBottomBar: React.FC<CopiperBottomBarProps> = ({ onSave, onExport }) => {
  const { token } = theme.useToken()

  const dirty = useCopiperStore((s) => s.dirty)
  const saving = useCopiperStore((s) => s.saving)
  const exporting = useCopiperStore((s) => s.exporting)
  const validationIssues = useCopiperStore((s) => s.validationIssues)

  const errorCount = validationIssues.filter((i) => i.level === 'error').length
  const warningCount = validationIssues.filter((i) => i.level === 'warning').length

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 24px',
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer
      }}
    >
      <Space size="middle">
        {dirty && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: token.colorWarning,
                display: 'inline-block'
              }}
            />
            <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>未保存</span>
          </span>
        )}
        {(errorCount > 0 || warningCount > 0) && (
          <Space size="small">
            {errorCount > 0 && (
              <Badge
                count={errorCount}
                size="small"
                color={token.colorError}
                title={`${errorCount} 个错误`}
              />
            )}
            {warningCount > 0 && (
              <Badge
                count={warningCount}
                size="small"
                color={token.colorWarning}
                title={`${warningCount} 个警告`}
              />
            )}
          </Space>
        )}
      </Space>
      <Space>
        <Button
          icon={<SaveOutlined />}
          disabled={!dirty || saving || exporting}
          loading={saving}
          onClick={onSave}
        >
          保存
        </Button>
        <Button
          type="primary"
          icon={<ExportOutlined />}
          disabled={saving || exporting}
          loading={exporting}
          onClick={onExport}
        >
          导出
        </Button>
      </Space>
    </div>
  )
}

export default CopiperBottomBar
