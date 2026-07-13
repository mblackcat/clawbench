import React from 'react'
import { Button, Space, Input, App, theme } from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  SettingOutlined,
  CheckCircleOutlined,
  ExportOutlined
} from '@ant-design/icons'
import { useCopiperStore } from '../../stores/useCopiperStore'
import { useT } from '../../i18n'

interface CopiperToolbarProps {
  onOpenColumnEditor: () => void
  onOpenExportModal: () => void
}

const CopiperToolbar: React.FC<CopiperToolbarProps> = ({
  onOpenColumnEditor,
  onOpenExportModal
}) => {
  const t = useT()
  const { token } = theme.useToken()
  const { message } = App.useApp()

  const activeTableName = useCopiperStore((s) => s.activeTableName)
  const selectedRowIndices = useCopiperStore((s) => s.selectedRowIndices)
  const searchText = useCopiperStore((s) => s.searchText)
  const addRow = useCopiperStore((s) => s.addRow)
  const deleteSelectedRows = useCopiperStore((s) => s.deleteSelectedRows)
  const validateCurrentTable = useCopiperStore((s) => s.validateCurrentTable)
  const setSearchText = useCopiperStore((s) => s.setSearchText)

  const disabled = !activeTableName

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 16px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer
      }}
    >
      <Space>
        <Button
          size="small"
          icon={<PlusOutlined />}
          disabled={disabled}
          onClick={addRow}
        >
          {t('copiper.addRow')}
        </Button>
        <Button
          size="small"
          icon={<DeleteOutlined />}
          disabled={disabled || selectedRowIndices.length === 0}
          onClick={deleteSelectedRows}
        >
          {t('copiper.deleteSelected')}
        </Button>
        <Button
          size="small"
          icon={<SettingOutlined />}
          disabled={disabled}
          onClick={onOpenColumnEditor}
        >
          {t('copiper.columnManager')}
        </Button>
        <Button
          size="small"
          icon={<CheckCircleOutlined />}
          disabled={disabled}
          onClick={async () => {
            await validateCurrentTable()
            const issues = useCopiperStore.getState().validationIssues
            if (issues.length === 0) {
              message.success(t('copiper.validationPassed'))
            } else {
              const errors = issues.filter(i => i.level === 'error').length
              const warnings = issues.filter(i => i.level === 'warning').length
              message.warning(t('copiper.validationIssues', errors, warnings))
            }
          }}
        >
          {t('copiper.validate')}
        </Button>
        <Button
          size="small"
          icon={<ExportOutlined />}
          disabled={disabled}
          onClick={onOpenExportModal}
        >
          {t('copiper.export')}
        </Button>
      </Space>
      <Input.Search
        size="small"
        placeholder={t('copiper.search')}
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        allowClear
        style={{ width: 200 }}
      />
    </div>
  )
}

export default CopiperToolbar
