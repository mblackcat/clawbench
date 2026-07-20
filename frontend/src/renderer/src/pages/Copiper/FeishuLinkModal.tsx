import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Modal,
  Radio,
  Input,
  Button,
  Space,
  Table,
  Select,
  Alert,
  App,
  theme,
  Typography,
  Spin
} from 'antd'
import {
  LinkOutlined,
  CloudUploadOutlined,
  ExperimentOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined
} from '@ant-design/icons'
import { useT } from '../../i18n'
import type { FeishuLinkConfig, FeishuSheetMap, FeishuTestResult } from '../../types/copiper'
import { listTableNames } from '../../types/copiper'
import { useCopiperStore } from '../../stores/useCopiperStore'

interface RemoteSheet {
  sheetId: string
  title: string
  index: number
}

interface FeishuLinkModalProps {
  open: boolean
  filePath: string | null
  onClose: () => void
  onSaved?: () => void
}

const FeishuLinkModal: React.FC<FeishuLinkModalProps> = ({
  open,
  filePath,
  onClose,
  onSaved
}) => {
  const t = useT()
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const activeDatabase = useCopiperStore((s) => s.activeDatabase)
  const loadDatabase = useCopiperStore((s) => s.loadDatabase)

  const [mode, setMode] = useState<'create' | 'link'>('link')
  const [available, setAvailable] = useState(true)
  const [availReason, setAvailReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [tokenStr, setTokenStr] = useState('')
  const [remoteSheets, setRemoteSheets] = useState<RemoteSheet[]>([])
  const [sheetMaps, setSheetMaps] = useState<FeishuSheetMap[]>([])
  const [testResult, setTestResult] = useState<FeishuTestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [existing, setExisting] = useState<FeishuLinkConfig | null>(null)

  const tableNames = useMemo(() => listTableNames(activeDatabase), [activeDatabase])

  const resetFromLink = useCallback((link: FeishuLinkConfig | null) => {
    if (!link) {
      setMode('link')
      setTitle('')
      setUrl('')
      setTokenStr('')
      setRemoteSheets([])
      setSheetMaps(
        tableNames.map((tn) => ({
          jdbTable: tn,
          sheetId: '',
          sheetTitle: tn,
          headerMode: 'name',
          keyColumn: 'id',
          headerRow: 1,
          dataStartRow: 2
        }))
      )
      setTestResult(null)
      return
    }
    setMode('link')
    setTitle(link.title || '')
    setUrl(link.spreadsheetUrl || '')
    setTokenStr(link.spreadsheetToken || '')
    setSheetMaps(
      tableNames.map((tn) => {
        const m = link.sheetMaps.find((x) => x.jdbTable === tn)
        return (
          m || {
            jdbTable: tn,
            sheetId: '',
            sheetTitle: tn,
            headerMode: 'name' as const,
            keyColumn: 'id',
            headerRow: 1,
            dataStartRow: 2
          }
        )
      })
    )
    setTestResult(link.lastTestResult || null)
  }, [tableNames])

  useEffect(() => {
    if (!open || !filePath) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const avail = await window.api.copiper.feishuAvailability()
        if (cancelled) return
        setAvailable(avail.available)
        setAvailReason(avail.reason || '')
        const link = await window.api.copiper.feishuGetLink(filePath)
        if (cancelled) return
        setExisting(link)
        resetFromLink(link)
        if (link?.spreadsheetToken) {
          const listed = await window.api.copiper.feishuListSheets(link.spreadsheetToken)
          if (!cancelled && listed.ok && listed.sheets) {
            setRemoteSheets(listed.sheets)
          }
        }
      } catch (err) {
        console.error(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, filePath, resetFromLink])

  const mappingComplete = useMemo(
    () =>
      tableNames.length > 0 &&
      tableNames.every((tn) => {
        const m = sheetMaps.find((x) => x.jdbTable === tn)
        return m && m.sheetId
      }),
    [tableNames, sheetMaps]
  )

  const handleFetchSheets = async () => {
    if (!url.trim() && !tokenStr.trim()) {
      message.warning(t('copiper.feishu.needUrl'))
      return
    }
    setLoading(true)
    try {
      const listed = await window.api.copiper.feishuListSheets(url.trim() || tokenStr.trim())
      if (!listed.ok) {
        message.error(listed.error || t('copiper.feishu.listFailed'))
        return
      }
      setTokenStr(listed.token || tokenStr)
      setTitle(listed.meta?.title || title)
      if (listed.meta?.url) setUrl(listed.meta.url)
      setRemoteSheets(listed.sheets || [])
      // Auto-map by title
      setSheetMaps((prev) =>
        prev.map((m) => {
          const match = (listed.sheets || []).find((s) => s.title === m.jdbTable)
          if (match) {
            return { ...m, sheetId: match.sheetId, sheetTitle: match.title }
          }
          return m
        })
      )
      message.success(t('copiper.feishu.sheetsLoaded'))
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!filePath) return
    const tTitle = title.trim() || 'CoPiper Tables'
    setLoading(true)
    try {
      const res = await window.api.copiper.feishuCreateSpreadsheet(filePath, tTitle)
      if (!res.ok) {
        message.error(res.error || t('copiper.feishu.createFailed'))
        return
      }
      message.success(t('copiper.feishu.created'))
      if (res.meta?.url) setUrl(res.meta.url)
      if (res.meta?.spreadsheetToken) setTokenStr(res.meta.spreadsheetToken)
      setTitle(res.meta?.title || tTitle)
      // reload link + sheets
      const link = await window.api.copiper.feishuGetLink(filePath)
      setExisting(link)
      resetFromLink(link)
      if (res.meta?.spreadsheetToken) {
        const listed = await window.api.copiper.feishuListSheets(res.meta.spreadsheetToken)
        if (listed.ok && listed.sheets) setRemoteSheets(listed.sheets)
      }
      await loadDatabase(filePath)
      onSaved?.()
    } finally {
      setLoading(false)
    }
  }

  const handleTest = async () => {
    if (!filePath && !tokenStr && !url) return
    setTesting(true)
    try {
      const tok =
        tokenStr ||
        (await window.api.copiper.feishuParseToken(url)) ||
        ''
      const res = await window.api.copiper.feishuTest(
        filePath || tok,
        tok || undefined
      )
      setTestResult(res)
      if (res.ok) message.success(res.message)
      else message.error(res.message)
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!filePath) return
    if (!tokenStr) {
      message.warning(t('copiper.feishu.needUrl'))
      return
    }
    if (!mappingComplete) {
      message.warning(t('copiper.feishu.mappingRequired'))
      return
    }
    setLoading(true)
    try {
      const link: FeishuLinkConfig = {
        spreadsheetUrl: url || `https://feishu.cn/sheets/${tokenStr}`,
        spreadsheetToken: tokenStr,
        title: title || undefined,
        enabled: true,
        syncMode: 'bidirectional',
        pollIntervalSec: 15,
        sheetMaps,
        onRemoteDelete: existing?.onRemoteDelete || 'prompt',
        lastTestAt: testResult?.checkedAt,
        lastTestResult: testResult,
        createdAt: existing?.createdAt,
        updatedAt: Date.now()
      }
      const res = await window.api.copiper.feishuSaveLink(filePath, link)
      if (!res.ok) {
        message.error(res.error || t('copiper.feishu.saveFailed'))
        return
      }
      message.success(t('copiper.feishu.saved'))
      await loadDatabase(filePath)
      onSaved?.()
      onClose()
    } finally {
      setLoading(false)
    }
  }

  const sheetOptions = remoteSheets.map((s) => ({
    value: s.sheetId,
    label: `${s.title} (${s.sheetId})`
  }))

  return (
    <Modal
      open={open}
      title={
        <Space>
          <LinkOutlined />
          {t('copiper.feishu.linkTitle')}
        </Space>
      }
      onCancel={onClose}
      width={720}
      destroyOnClose
      footer={
        <Space>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            icon={<ExperimentOutlined />}
            loading={testing}
            disabled={!available || (!tokenStr && !url)}
            onClick={handleTest}
          >
            {t('copiper.feishu.test')}
          </Button>
          <Button
            type="primary"
            loading={loading}
            disabled={!available || !mappingComplete}
            onClick={handleSave}
          >
            {t('copiper.feishu.saveLink')}
          </Button>
        </Space>
      }
    >
      <Spin spinning={loading}>
        {!available && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={t('copiper.feishu.needLogin')}
            description={
              availReason === 'feishu_login_required'
                ? t('copiper.feishu.needLoginDesc')
                : availReason
            }
          />
        )}

        <Radio.Group
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          style={{ marginBottom: 16 }}
          disabled={!available}
        >
          <Radio.Button value="link">{t('copiper.feishu.modeLink')}</Radio.Button>
          <Radio.Button value="create">{t('copiper.feishu.modeCreate')}</Radio.Button>
        </Radio.Group>

        {mode === 'create' ? (
          <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
            <Typography.Text type="secondary">{t('copiper.feishu.createHint')}</Typography.Text>
            <Input
              placeholder={t('copiper.feishu.sheetTitle')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!available}
            />
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              disabled={!available}
              onClick={handleCreate}
            >
              {t('copiper.feishu.createAndMap')}
            </Button>
          </Space>
        ) : (
          <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
            <Input
              placeholder={t('copiper.feishu.urlPlaceholder')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={!available}
              allowClear
            />
            <Button disabled={!available} onClick={handleFetchSheets}>
              {t('copiper.feishu.fetchSheets')}
            </Button>
          </Space>
        )}

        {(tokenStr || title) && (
          <div
            style={{
              marginBottom: 12,
              padding: 8,
              background: token.colorFillQuaternary,
              borderRadius: token.borderRadius
            }}
          >
            <Typography.Text type="secondary">
              {t('copiper.feishu.token')}: {tokenStr || '—'}
            </Typography.Text>
            {title ? (
              <div>
                <Typography.Text>{title}</Typography.Text>
              </div>
            ) : null}
          </div>
        )}

        <Typography.Title level={5} style={{ marginTop: 8 }}>
          {t('copiper.feishu.sheetMapping')}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          {t('copiper.feishu.mappingHint')}
        </Typography.Paragraph>

        <Table
          size="small"
          pagination={false}
          rowKey="jdbTable"
          dataSource={sheetMaps}
          columns={[
            {
              title: t('copiper.feishu.localTable'),
              dataIndex: 'jdbTable',
              width: 160
            },
            {
              title: t('copiper.feishu.remoteSheet'),
              render: (_, row) => (
                <Select
                  style={{ width: '100%' }}
                  placeholder={t('copiper.feishu.selectSheet')}
                  options={sheetOptions}
                  value={row.sheetId || undefined}
                  disabled={!available}
                  onChange={(sheetId) => {
                    const sheet = remoteSheets.find((s) => s.sheetId === sheetId)
                    setSheetMaps((prev) =>
                      prev.map((m) =>
                        m.jdbTable === row.jdbTable
                          ? {
                              ...m,
                              sheetId,
                              sheetTitle: sheet?.title || m.sheetTitle
                            }
                          : m
                      )
                    )
                  }}
                />
              )
            }
          ]}
        />

        {testResult && (
          <Alert
            style={{ marginTop: 16 }}
            type={testResult.ok ? 'success' : 'error'}
            showIcon
            icon={testResult.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
            message={testResult.message}
            description={
              <span>
                R:{testResult.canRead ? '✓' : '✗'} W:{testResult.canWrite ? '✓' : '✗'}
              </span>
            }
          />
        )}
      </Spin>
    </Modal>
  )
}

export default FeishuLinkModal
