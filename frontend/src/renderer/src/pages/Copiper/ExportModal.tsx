import React, { useState, useMemo } from 'react'
import { Modal, Checkbox, Table, Tag, Typography, Alert, Space, Progress, App, theme } from 'antd'
import {
  ExportOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  MinusCircleOutlined
} from '@ant-design/icons'
import { useCopiperStore } from '../../stores/useCopiperStore'
import { useT } from '../../i18n'
import type { ExportConfig, ExportResult } from '../../types/copiper'

const { Text } = Typography

const EXPORT_FORMATS_KEY = 'copiper_export_formats'

function loadSavedFormats(): ('python' | 'json')[] {
  try {
    const saved = localStorage.getItem(EXPORT_FORMATS_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch { /* ignore */ }
  return ['python', 'json']
}

interface ExportModalProps {
  open: boolean
  onClose: () => void
}

const ExportModal: React.FC<ExportModalProps> = ({ open, onClose }) => {
  const t = useT()
  const { token } = theme.useToken()
  const { message } = App.useApp()

  const activeDatabase = useCopiperStore((s) => s.activeDatabase)
  const exporting = useCopiperStore((s) => s.exporting)
  const exportCurrentTable = useCopiperStore((s) => s.exportCurrentTable)
  const exportAll = useCopiperStore((s) => s.exportAll)

  const [formats, setFormats] = useState<('python' | 'json')[]>(loadSavedFormats)
  const [selectedTables, setSelectedTables] = useState<string[]>([])
  const [results, setResults] = useState<ExportResult[]>([])
  const [hasRun, setHasRun] = useState(false)

  const tableNames = useMemo(() => {
    if (!activeDatabase) return []
    return Object.keys(activeDatabase)
  }, [activeDatabase])

  // Initialize selection when opening
  React.useEffect(() => {
    if (open) {
      setSelectedTables(tableNames)
      setResults([])
      setHasRun(false)
    }
  }, [open, tableNames])

  const handleExport = async () => {
    if (formats.length === 0) {
      message.warning(t('copiper.selectAtLeastOneFormat'))
      return
    }

    const config: ExportConfig = {
      formats,
      tableNames: selectedTables
    }

    try {
      const exportResults = await exportAll(config)
      setResults(exportResults)
      setHasRun(true)
      const successCount = exportResults.filter((r) => r.success && !r.skipped).length
      const skipCount = exportResults.filter((r) => r.skipped).length
      const failCount = exportResults.filter((r) => !r.success).length
      if (failCount === 0) {
        const parts = [t('copiper.exportSuccessCount', successCount)]
        if (skipCount > 0) parts.push(t('copiper.exportSkipCount', skipCount))
        message.success(parts.join(', '))
      } else {
        message.warning(
          skipCount > 0
            ? t('copiper.exportPartialWithSkip', successCount, failCount, skipCount)
            : t('copiper.exportPartial', successCount, failCount)
        )
      }
    } catch (err) {
      message.error(t('copiper.exportFailed', err instanceof Error ? err.message : String(err)))
    }
  }

  // Extract unique check/post-process info per table for display
  const hookSummaries = useMemo(() => {
    if (!hasRun || results.length === 0) return []

    const seen = new Set<string>()
    const summaries: { tableName: string; checkInfo?: string; postProcessInfo?: string }[] = []

    for (const r of results) {
      if (seen.has(r.tableName)) continue
      seen.add(r.tableName)
      if (r.checkInfo || r.postProcessInfo) {
        summaries.push({
          tableName: r.tableName,
          checkInfo: r.checkInfo,
          postProcessInfo: r.postProcessInfo
        })
      }
    }
    return summaries
  }, [results, hasRun])

  const resultColumns = [
    {
      title: t('copiper.colTableName'),
      dataIndex: 'tableName',
      key: 'tableName',
      width: 160
    },
    {
      title: t('copiper.colFormat'),
      dataIndex: 'format',
      key: 'format',
      width: 80,
      render: (fmt: string) => <Tag>{fmt}</Tag>
    },
    {
      title: t('copiper.colRowCount'),
      dataIndex: 'rowCount',
      key: 'rowCount',
      width: 70
    },
    {
      title: t('copiper.colStatus'),
      dataIndex: 'success',
      key: 'success',
      width: 100,
      render: (_success: boolean, record: ExportResult) =>
        record.skipped ? (
          <Tag color="default" icon={<MinusCircleOutlined />}>{t('copiper.statusSkipped')}</Tag>
        ) : record.success ? (
          <Tag color="success" icon={<CheckCircleOutlined />}>{t('copiper.statusOk')}</Tag>
        ) : (
          <Tag color="error" icon={<CloseCircleOutlined />}>{t('copiper.statusFailed')}</Tag>
        )
    },
    {
      title: t('copiper.colOutputPath'),
      dataIndex: 'outputPath',
      key: 'outputPath',
      ellipsis: true,
      render: (path: string, record: ExportResult) =>
        record.skipped ? (
          <Text type="secondary" style={{ fontSize: 12 }}>{t('copiper.noData')}</Text>
        ) : record.success ? (
          <Text style={{ fontSize: 12 }} copyable={{ text: path }}>
            {path}
          </Text>
        ) : (
          <Text type="danger" style={{ fontSize: 12 }}>{record.error || t('copiper.unknownError')}</Text>
        )
    }
  ]

  return (
    <Modal
      title={
        <span>
          <ExportOutlined style={{ marginRight: 8 }} />
          {t('copiper.exportData')}
        </span>
      }
      open={open}
      onOk={handleExport}
      onCancel={onClose}
      okText={exporting ? t('copiper.exporting') : t('copiper.export')}
      cancelText={t('copiper.close')}
      okButtonProps={{ loading: exporting, disabled: formats.length === 0 || selectedTables.length === 0 }}
      width={720}
      destroyOnHidden
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Format selection */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>{t('copiper.exportFormat')}</Text>
          <Checkbox.Group
            value={formats}
            onChange={(vals) => {
              const newFormats = vals as ('python' | 'json')[]
              setFormats(newFormats)
              try {
                localStorage.setItem(EXPORT_FORMATS_KEY, JSON.stringify(newFormats))
              } catch { /* ignore */ }
            }}
          >
            <Checkbox value="python">Python</Checkbox>
            <Checkbox value="json">JSON</Checkbox>
          </Checkbox.Group>
        </div>

        {/* Table selection */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            {t('copiper.exportTables', selectedTables.length, tableNames.length)}
          </Text>
          <Checkbox.Group
            value={selectedTables}
            onChange={(vals) => setSelectedTables(vals as string[])}
            style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
          >
            {tableNames.map((name) => (
              <Checkbox key={name} value={name}>
                {name}
              </Checkbox>
            ))}
          </Checkbox.Group>
        </div>

        {/* Progress */}
        {exporting && (
          <Progress percent={0} status="active" />
        )}

        {/* Results */}
        {hasRun && results.length > 0 && (
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>{t('copiper.exportResults')}</Text>
            <Table
              columns={resultColumns}
              dataSource={results}
              rowKey={(r) => `${r.tableName}-${r.format}`}
              size="small"
              pagination={false}
              scroll={{ y: 200 }}
            />
          </div>
        )}

        {/* Hook execution summaries */}
        {hasRun && hookSummaries.length > 0 && (
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              <InfoCircleOutlined style={{ marginRight: 4 }} />
              {t('copiper.scriptExecution')}
            </Text>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {hookSummaries.map((s) => (
                <div key={s.tableName} style={{
                  background: token.colorBgLayout,
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: 13
                }}>
                  <Text strong style={{ fontSize: 13 }}>{s.tableName}</Text>
                  {s.checkInfo && (
                    <div style={{ marginTop: 4 }}>
                      <Tag color="blue" style={{ fontSize: 11 }}>{t('copiper.check')}</Tag>
                      <Text style={{ fontSize: 12 }}>{s.checkInfo}</Text>
                    </div>
                  )}
                  {s.postProcessInfo && (
                    <div style={{ marginTop: 4 }}>
                      <Tag color="purple" style={{ fontSize: 11 }}>{t('copiper.postProcess')}</Tag>
                      <Text style={{ fontSize: 12 }}>{s.postProcessInfo}</Text>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No hooks found notice */}
        {hasRun && hookSummaries.length === 0 && results.length > 0 && (
          <Alert
            type="info"
            showIcon
            message={t('copiper.noScriptsDetected')}
            description={t('copiper.noScriptsDescription')}
            style={{ fontSize: 12 }}
          />
        )}
      </div>
    </Modal>
  )
}

export default ExportModal
