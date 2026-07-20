import React, { useEffect, useState } from 'react'
import { Button, Space, Input, App, theme, Tooltip } from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  SettingOutlined,
  CheckCircleOutlined,
  ExportOutlined,
  CloudSyncOutlined,
  LinkOutlined
} from '@ant-design/icons'
import { useCopiperStore } from '../../stores/useCopiperStore'
import { useT } from '../../i18n'
import { getFeishuLinkFromDb } from '../../types/copiper'

interface CopiperToolbarProps {
  onOpenColumnEditor: () => void
  onOpenExportModal: () => void
  onOpenFeishuLink?: () => void
  onSyncNow?: () => void
}

/** Wrap disabled buttons so Tooltip can still receive hover events. */
function IconActionButton({
  title,
  icon,
  disabled,
  onClick,
  danger
}: {
  title: string
  icon: React.ReactNode
  disabled?: boolean
  onClick?: () => void | Promise<void>
  danger?: boolean
}) {
  return (
    <Tooltip title={title}>
      <span style={{ display: 'inline-flex' }}>
        <Button
          size="small"
          icon={icon}
          disabled={disabled}
          danger={danger}
          onClick={() => {
            void onClick?.()
          }}
        />
      </span>
    </Tooltip>
  )
}

const CopiperToolbar: React.FC<CopiperToolbarProps> = ({
  onOpenColumnEditor,
  onOpenExportModal,
  onOpenFeishuLink,
  onSyncNow
}) => {
  const t = useT()
  const { token } = theme.useToken()
  const { message } = App.useApp()

  const activeTableName = useCopiperStore((s) => s.activeTableName)
  const activeFilePath = useCopiperStore((s) => s.activeFilePath)
  const activeDatabase = useCopiperStore((s) => s.activeDatabase)
  const selectedRowIndices = useCopiperStore((s) => s.selectedRowIndices)
  const searchText = useCopiperStore((s) => s.searchText)
  const addRow = useCopiperStore((s) => s.addRow)
  const deleteSelectedRows = useCopiperStore((s) => s.deleteSelectedRows)
  const validateCurrentTable = useCopiperStore((s) => s.validateCurrentTable)
  const setSearchText = useCopiperStore((s) => s.setSearchText)

  const [feishuAvailable, setFeishuAvailable] = useState(false)
  useEffect(() => {
    void window.api.copiper.feishuAvailability().then((a) => setFeishuAvailable(a.available))
  }, [])

  const feishuLinked = !!(getFeishuLinkFromDb(activeDatabase)?.enabled)
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
        <IconActionButton
          title={t('copiper.addRow')}
          icon={<PlusOutlined />}
          disabled={disabled}
          onClick={addRow}
        />
        <IconActionButton
          title={t('copiper.deleteSelected')}
          icon={<DeleteOutlined />}
          disabled={disabled || selectedRowIndices.length === 0}
          onClick={deleteSelectedRows}
        />
        <IconActionButton
          title={t('copiper.columnManager')}
          icon={<SettingOutlined />}
          disabled={disabled}
          onClick={onOpenColumnEditor}
        />
        {feishuAvailable && (
          <>
            <IconActionButton
              title={t('copiper.feishu.connectMenu')}
              icon={<LinkOutlined />}
              disabled={!activeFilePath}
              onClick={onOpenFeishuLink}
            />
            <IconActionButton
              title={t('copiper.feishu.syncNow')}
              icon={<CloudSyncOutlined />}
              disabled={!activeFilePath || !feishuLinked}
              onClick={onSyncNow}
            />
          </>
        )}
        <IconActionButton
          title={t('copiper.validate')}
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
        />
        <IconActionButton
          title={t('copiper.export')}
          icon={<ExportOutlined />}
          disabled={disabled}
          onClick={onOpenExportModal}
        />
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
