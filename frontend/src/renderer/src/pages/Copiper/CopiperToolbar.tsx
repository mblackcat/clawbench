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

interface CopiperToolbarProps {
  onOpenColumnEditor: () => void
  onOpenExportModal: () => void
}

const CopiperToolbar: React.FC<CopiperToolbarProps> = ({
  onOpenColumnEditor,
  onOpenExportModal
}) => {
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
          添加行
        </Button>
        <Button
          size="small"
          icon={<DeleteOutlined />}
          disabled={disabled || selectedRowIndices.length === 0}
          onClick={deleteSelectedRows}
        >
          删除选中
        </Button>
        <Button
          size="small"
          icon={<SettingOutlined />}
          disabled={disabled}
          onClick={onOpenColumnEditor}
        >
          列管理
        </Button>
        <Button
          size="small"
          icon={<CheckCircleOutlined />}
          disabled={disabled}
          onClick={async () => {
            await validateCurrentTable()
            const issues = useCopiperStore.getState().validationIssues
            if (issues.length === 0) {
              message.success('验证通过，无问题')
            } else {
              const errors = issues.filter(i => i.level === 'error').length
              const warnings = issues.filter(i => i.level === 'warning').length
              message.warning(`发现 ${errors} 个错误, ${warnings} 个警告`)
            }
          }}
        >
          验证
        </Button>
        <Button
          size="small"
          icon={<ExportOutlined />}
          disabled={disabled}
          onClick={onOpenExportModal}
        >
          导出
        </Button>
      </Space>
      <Input.Search
        size="small"
        placeholder="搜索..."
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        allowClear
        style={{ width: 200 }}
      />
    </div>
  )
}

export default CopiperToolbar
