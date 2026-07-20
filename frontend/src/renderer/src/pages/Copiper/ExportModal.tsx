import React, { useState, useMemo } from 'react'
import {
  Modal,
  Checkbox,
  Table,
  Tag,
  Typography,
  Alert,
  Progress,
  App,
  theme,
  Switch,
  Input,
  Collapse,
  Space
} from 'antd'
import {
  ExportOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  MinusCircleOutlined,
  LinkOutlined,
  GithubOutlined
} from '@ant-design/icons'
import { useCopiperStore } from '../../stores/useCopiperStore'
import { useT } from '../../i18n'
import { openExternalLink } from '../../utils/markdown-links'
import type { ExportConfig, ExportFormat, ExportResult, LubanExportOptions } from '../../types/copiper'

const { Text, Link } = Typography

const EXPORT_FORMATS_KEY = 'copiper_export_formats'
const LUBAN_OPTS_KEY = 'copiper_luban_export_opts'

const LUBAN_DOCS_URL = 'https://www.datable.cn/docs/intro'
const LUBAN_GITHUB_URL = 'https://github.com/focus-creative-games/luban'

const ALL_FORMATS: ExportFormat[] = ['python', 'json', 'luban']

function loadSavedFormats(): ExportFormat[] {
  try {
    const saved = localStorage.getItem(EXPORT_FORMATS_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter((f: string): f is ExportFormat =>
          ALL_FORMATS.includes(f as ExportFormat)
        )
      }
    }
  } catch { /* ignore */ }
  return ['python', 'json']
}

interface SavedLubanUiOpts {
  runLuban: boolean
  moduleName: string
  lubanDllPath: string
  lubanConfPath: string
  intermediateDataDir: string
  intermediateSchemaDir: string
  outputCodeDir: string
  outputDataDir: string
}

function loadSavedLubanOpts(): SavedLubanUiOpts {
  const defaults: SavedLubanUiOpts = {
    runLuban: true,
    moduleName: 'jdb',
    lubanDllPath: '',
    lubanConfPath: '',
    intermediateDataDir: '',
    intermediateSchemaDir: '',
    outputCodeDir: '',
    outputDataDir: ''
  }
  try {
    const saved = localStorage.getItem(LUBAN_OPTS_KEY)
    if (saved) {
      return { ...defaults, ...JSON.parse(saved) }
    }
  } catch { /* ignore */ }
  return defaults
}

function persistLubanOpts(opts: SavedLubanUiOpts): void {
  try {
    localStorage.setItem(LUBAN_OPTS_KEY, JSON.stringify(opts))
  } catch { /* ignore */ }
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
  const exportAll = useCopiperStore((s) => s.exportAll)

  const [formats, setFormats] = useState<ExportFormat[]>(loadSavedFormats)
  const [lubanOpts, setLubanOpts] = useState<SavedLubanUiOpts>(loadSavedLubanOpts)
  const [selectedTables, setSelectedTables] = useState<string[]>([])
  const [results, setResults] = useState<ExportResult[]>([])
  const [hasRun, setHasRun] = useState(false)

  const tableNames = useMemo(() => {
    if (!activeDatabase) return []
    return Object.keys(activeDatabase)
  }, [activeDatabase])

  const wantLuban = formats.includes('luban')

  // Initialize selection when opening
  React.useEffect(() => {
    if (open) {
      setSelectedTables(tableNames)
      setResults([])
      setHasRun(false)
      setFormats(loadSavedFormats())
      setLubanOpts(loadSavedLubanOpts())
    }
  }, [open, tableNames])

  const updateLubanOpt = <K extends keyof SavedLubanUiOpts>(key: K, value: SavedLubanUiOpts[K]) => {
    setLubanOpts((prev) => {
      const next = { ...prev, [key]: value }
      persistLubanOpts(next)
      return next
    })
  }

  const buildLubanConfig = (): LubanExportOptions => {
    const o: LubanExportOptions = {
      runLuban: lubanOpts.runLuban,
      moduleName: lubanOpts.moduleName.trim() || 'jdb'
    }
    if (lubanOpts.lubanDllPath.trim()) o.lubanDllPath = lubanOpts.lubanDllPath.trim()
    if (lubanOpts.lubanConfPath.trim()) o.lubanConfPath = lubanOpts.lubanConfPath.trim()
    if (lubanOpts.intermediateDataDir.trim()) o.intermediateDataDir = lubanOpts.intermediateDataDir.trim()
    if (lubanOpts.intermediateSchemaDir.trim()) o.intermediateSchemaDir = lubanOpts.intermediateSchemaDir.trim()
    if (lubanOpts.outputCodeDir.trim()) o.outputCodeDir = lubanOpts.outputCodeDir.trim()
    if (lubanOpts.outputDataDir.trim()) o.outputDataDir = lubanOpts.outputDataDir.trim()
    return o
  }

  const handleExport = async () => {
    if (formats.length === 0) {
      message.warning(t('copiper.selectAtLeastOneFormat'))
      return
    }

    const config: ExportConfig = {
      formats,
      tableNames: selectedTables,
      ...(wantLuban ? { luban: buildLubanConfig() } : {})
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
      width: 90,
      render: (fmt: string) => (
        <Tag color={fmt === 'luban' ? 'geekblue' : undefined}>{fmt}</Tag>
      )
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
            {record.schemaPath ? (
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                schema: {record.schemaPath}
              </Text>
            ) : null}
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
      width={760}
      destroyOnHidden
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Format selection */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>{t('copiper.exportFormat')}</Text>
          <Checkbox.Group
            value={formats}
            onChange={(vals) => {
              const newFormats = vals as ExportFormat[]
              setFormats(newFormats)
              try {
                localStorage.setItem(EXPORT_FORMATS_KEY, JSON.stringify(newFormats))
              } catch { /* ignore */ }
            }}
          >
            <Checkbox value="python">Python</Checkbox>
            <Checkbox value="json">JSON</Checkbox>
            <Checkbox value="luban">
              Luban
              <Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>
                {t('copiper.lubanFormatHint')}
              </Text>
            </Checkbox>
          </Checkbox.Group>
          <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
            {t('copiper.exportFormatNativeKeep')}
          </Text>
        </div>

        {/* Luban panel */}
        {wantLuban && (
          <div
            style={{
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: token.borderRadiusLG,
              padding: 12,
              background: token.colorFillAlter
            }}
          >
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <Text strong>{t('copiper.lubanSectionTitle')}</Text>
                <Space size={12}>
                  <Link
                    onClick={(e) => {
                      e.preventDefault()
                      openExternalLink(LUBAN_DOCS_URL)
                    }}
                    style={{ fontSize: 12 }}
                  >
                    <LinkOutlined /> {t('copiper.lubanDocsLink')}
                  </Link>
                  <Link
                    onClick={(e) => {
                      e.preventDefault()
                      openExternalLink(LUBAN_GITHUB_URL)
                    }}
                    style={{ fontSize: 12 }}
                  >
                    <GithubOutlined /> {t('copiper.lubanGithubLink')}
                  </Link>
                </Space>
              </div>

              <Alert
                type="info"
                showIcon
                message={t('copiper.lubanPipelineHint')}
                description={
                  <div style={{ fontSize: 12 }}>
                    <div>{t('copiper.lubanPipelineStep1')}</div>
                    <div>{t('copiper.lubanPipelineStep2')}</div>
                    <div>{t('copiper.lubanPipelineStep3')}</div>
                    <div style={{ marginTop: 6 }}>
                      <Text code style={{ fontSize: 11 }}>{LUBAN_DOCS_URL}</Text>
                      <br />
                      <Text code style={{ fontSize: 11 }}>{LUBAN_GITHUB_URL}</Text>
                    </div>
                  </div>
                }
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Switch
                  checked={lubanOpts.runLuban}
                  onChange={(v) => updateLubanOpt('runLuban', v)}
                  size="small"
                />
                <Text style={{ fontSize: 13 }}>{t('copiper.lubanRunCli')}</Text>
              </div>

              <Collapse
                size="small"
                items={[
                  {
                    key: 'paths',
                    label: t('copiper.lubanAdvancedPaths'),
                    children: (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>{t('copiper.lubanModuleName')}</Text>
                          <Input
                            size="small"
                            value={lubanOpts.moduleName}
                            placeholder="jdb"
                            onChange={(e) => updateLubanOpt('moduleName', e.target.value)}
                          />
                        </div>
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>{t('copiper.lubanDllPath')}</Text>
                          <Input
                            size="small"
                            value={lubanOpts.lubanDllPath}
                            placeholder="tools/Luban/Luban.dll"
                            onChange={(e) => updateLubanOpt('lubanDllPath', e.target.value)}
                          />
                        </div>
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>{t('copiper.lubanConfPath')}</Text>
                          <Input
                            size="small"
                            value={lubanOpts.lubanConfPath}
                            placeholder="config/luban.conf"
                            onChange={(e) => updateLubanOpt('lubanConfPath', e.target.value)}
                          />
                        </div>
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>{t('copiper.lubanIntermediateData')}</Text>
                          <Input
                            size="small"
                            value={lubanOpts.intermediateDataDir}
                            placeholder="config/Datas/_jdb"
                            onChange={(e) => updateLubanOpt('intermediateDataDir', e.target.value)}
                          />
                        </div>
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>{t('copiper.lubanIntermediateSchema')}</Text>
                          <Input
                            size="small"
                            value={lubanOpts.intermediateSchemaDir}
                            placeholder="config/Defines/_jdb_gen"
                            onChange={(e) => updateLubanOpt('intermediateSchemaDir', e.target.value)}
                          />
                        </div>
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>{t('copiper.lubanOutputCodeDir')}</Text>
                          <Input
                            size="small"
                            value={lubanOpts.outputCodeDir}
                            placeholder="output/luban/code"
                            onChange={(e) => updateLubanOpt('outputCodeDir', e.target.value)}
                          />
                        </div>
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>{t('copiper.lubanOutputDataDir')}</Text>
                          <Input
                            size="small"
                            value={lubanOpts.outputDataDir}
                            placeholder="output/luban/data"
                            onChange={(e) => updateLubanOpt('outputDataDir', e.target.value)}
                          />
                        </div>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {t('copiper.lubanPathHint')}
                        </Text>
                      </div>
                    )
                  }
                ]}
              />
            </Space>
          </div>
        )}

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

        {/* No hooks found notice (native only; hide if pure luban) */}
        {hasRun && hookSummaries.length === 0 && results.length > 0 && formats.some((f) => f !== 'luban') && (
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
