import React, { useMemo, useState } from 'react'
import { Modal, Table, Radio, Space, Button, Typography, App } from 'antd'
import { useT } from '../../i18n'
import type { RowData } from '../../types/copiper'

export interface SyncConflictItem {
  tableName: string
  rowKey: string
  local: RowData | null
  remote: RowData | null
  reason: string
}

interface SyncConflictModalProps {
  open: boolean
  filePath: string | null
  conflicts: SyncConflictItem[]
  onClose: () => void
  onResolved?: () => void
}

const SyncConflictModal: React.FC<SyncConflictModalProps> = ({
  open,
  filePath,
  conflicts,
  onClose,
  onResolved
}) => {
  const t = useT()
  const { message } = App.useApp()
  const [choices, setChoices] = useState<Record<string, 'local' | 'remote' | 'skip'>>({})
  const [saving, setSaving] = useState(false)

  const rows = useMemo(
    () =>
      conflicts.map((c) => ({
        ...c,
        key: `${c.tableName}::${c.rowKey}`
      })),
    [conflicts]
  )

  const handleResolve = async () => {
    if (!filePath) return
    setSaving(true)
    try {
      const resolutions: Record<string, 'local' | 'remote' | 'skip'> = {}
      for (const r of rows) {
        resolutions[r.key] = choices[r.key] || 'skip'
      }
      const result = await window.api.copiper.feishuSyncNow(filePath, resolutions)
      if (result.ok) {
        message.success(t('copiper.feishu.syncDone'))
        onResolved?.()
        onClose()
      } else if (result.conflicts?.length) {
        message.warning(t('copiper.feishu.conflictsRemain'))
      } else {
        message.error(result.error || t('copiper.feishu.syncFailed'))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={t('copiper.feishu.conflictTitle')}
      onCancel={onClose}
      width={800}
      footer={
        <Space>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="primary" loading={saving} onClick={handleResolve}>
            {t('copiper.feishu.applyResolutions')}
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">
        {t('copiper.feishu.conflictHint')}
      </Typography.Paragraph>
      <Table
        size="small"
        pagination={false}
        dataSource={rows}
        columns={[
          {
            title: t('copiper.feishu.localTable'),
            dataIndex: 'tableName',
            width: 120
          },
          {
            title: 'Key',
            dataIndex: 'rowKey',
            width: 80
          },
          {
            title: t('copiper.feishu.reason'),
            dataIndex: 'reason',
            width: 120
          },
          {
            title: t('copiper.feishu.local'),
            render: (_, r) => (
              <Typography.Text code style={{ fontSize: 11 }}>
                {r.local ? JSON.stringify(r.local).slice(0, 80) : '—'}
              </Typography.Text>
            )
          },
          {
            title: t('copiper.feishu.remote'),
            render: (_, r) => (
              <Typography.Text code style={{ fontSize: 11 }}>
                {r.remote ? JSON.stringify(r.remote).slice(0, 80) : '—'}
              </Typography.Text>
            )
          },
          {
            title: t('copiper.feishu.resolution'),
            width: 200,
            render: (_, r) => (
              <Radio.Group
                size="small"
                value={choices[r.key] || 'skip'}
                onChange={(e) =>
                  setChoices((prev) => ({ ...prev, [r.key]: e.target.value }))
                }
              >
                <Radio.Button value="local">{t('copiper.feishu.keepLocal')}</Radio.Button>
                <Radio.Button value="remote">{t('copiper.feishu.keepRemote')}</Radio.Button>
                <Radio.Button value="skip">{t('copiper.feishu.skip')}</Radio.Button>
              </Radio.Group>
            )
          }
        ]}
      />
    </Modal>
  )
}

export default SyncConflictModal
