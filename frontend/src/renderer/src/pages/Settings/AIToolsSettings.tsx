import React, { useEffect, useState, useRef } from 'react'
import {
  Typography,
  Card,
  Radio,
  Input,
  InputNumber,
  Button,
  Space,
  App,
  Tag,
  Progress,
  Switch,
  theme
} from 'antd'
import {
  SearchOutlined,
  DownloadOutlined,
  GithubOutlined,
  LinkOutlined,
  CheckCircleOutlined,
  FolderOpenOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { useT } from '../../i18n'
import { useSettingsStore } from '../../stores/useSettingsStore'
import type { AiToolsConfig } from '../../types/ipc'

const { Text } = Typography

const DEFAULT_CONFIG: AiToolsConfig = {
  webSearch: { provider: 'duckduckgo', braveApiKey: '' },
  webBrowse: { engine: 'http', lightpandaPath: '' },
  feishuKits: { enabled: false, cliPath: '' },
  toolBehavior: { maxToolSteps: 10, maxSearchRounds: 5, toolTimeoutMs: 60000 }
}

const LIGHTPANDA_GITHUB = 'https://github.com/lightpanda-io/browser'
const LIGHTPANDA_DOCS = 'https://lightpanda.io/docs/open-source/installation'
const FEISHU_CLI_GITHUB = 'https://github.com/riba2534/feishu-cli'

const AIToolsSettings: React.FC = () => {
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const t = useT()
  const { aiToolsConfig, fetchAiToolsConfig, updateAiToolsConfig } = useSettingsStore()
  const [testingBrave, setTestingBrave] = useState(false)
  const [braveKeyInput, setBraveKeyInput] = useState('')
  const [detectingLp, setDetectingLp] = useState(false)
  const [installingLp, setInstallingLp] = useState(false)
  const [installProgress, setInstallProgress] = useState<{ percent: number; downloadedMB: string; totalMB: string; stage: string } | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // Feishu Kits state
  const [detectingFk, setDetectingFk] = useState(false)
  const [installingFk, setInstallingFk] = useState(false)
  const [fkInstallProgress, setFkInstallProgress] = useState<{ percent: number; downloadedMB: string; totalMB: string; stage: string } | null>(null)
  const fkCleanupRef = useRef<(() => void) | null>(null)
  const [fkConfigSynced, setFkConfigSynced] = useState(false)
  const [fkHasImCredentials, setFkHasImCredentials] = useState(false)
  const [syncingFkConfig, setSyncingFkConfig] = useState(false)

  const config = aiToolsConfig || DEFAULT_CONFIG

  useEffect(() => {
    fetchAiToolsConfig()
  }, [fetchAiToolsConfig])

  useEffect(() => {
    if (aiToolsConfig?.webSearch.braveApiKey) {
      setBraveKeyInput(aiToolsConfig.webSearch.braveApiKey)
    }
  }, [aiToolsConfig?.webSearch.braveApiKey])

  // Check feishu-cli config status + IM credentials availability
  useEffect(() => {
    window.api.settings.checkFeishuCliConfig().then((res) => {
      setFkConfigSynced(res.exists && res.hasCredentials)
    }).catch(() => {})
    // Check if IM feishu credentials are configured
    window.api.aiWorkbench.getIMConfig().then((cfg: any) => {
      const feishu = cfg?.feishu
      setFkHasImCredentials(!!(feishu?.appId && feishu?.appSecret))
    }).catch(() => {})
  }, [])

  const updateConfig = (patch: Partial<AiToolsConfig>) => {
    const merged = { ...config, ...patch }
    updateAiToolsConfig(merged)
  }

  const handleTestBrave = async () => {
    if (!braveKeyInput || braveKeyInput === '****') return
    setTestingBrave(true)
    try {
      const result = await window.api.settings.testBraveApiKey(braveKeyInput)
      if (result.success) {
        message.success(t('settings.aiTools.testSuccess'))
        updateConfig({
          webSearch: { ...config.webSearch, provider: 'brave', braveApiKey: braveKeyInput }
        })
      } else {
        message.error(`${t('settings.aiTools.testFailed')}: ${result.message}`)
      }
    } catch (err: any) {
      message.error(`${t('settings.aiTools.testFailed')}: ${err.message}`)
    } finally {
      setTestingBrave(false)
    }
  }

  const handleDetectLightpanda = async () => {
    setDetectingLp(true)
    try {
      const result = await window.api.settings.detectLightpanda()
      if (result.found) {
        message.success(t('settings.aiTools.lightpandaDetected', result.path))
        updateConfig({
          webBrowse: { ...config.webBrowse, lightpandaPath: result.path }
        })
      } else {
        message.warning(t('settings.aiTools.lightpandaNotFound'))
      }
    } catch {
      message.warning(t('settings.aiTools.lightpandaNotFound'))
    } finally {
      setDetectingLp(false)
    }
  }

  const handleInstallLightpanda = async () => {
    setInstallingLp(true)
    setInstallProgress({ percent: 0, downloadedMB: '0', totalMB: '?', stage: 'connecting' })

    // Subscribe to progress events
    cleanupRef.current?.()
    cleanupRef.current = window.api.settings.onLightpandaInstallProgress((data) => {
      setInstallProgress(data)
    })

    try {
      const result = await window.api.settings.installLightpanda()
      if (result.success) {
        message.success(t('settings.aiTools.lightpandaInstallSuccess', result.path))
        updateConfig({
          webBrowse: { ...config.webBrowse, engine: 'lightpanda', lightpandaPath: result.path }
        })
      } else {
        message.error(`${t('settings.aiTools.lightpandaInstallFailed')}: ${result.error}`)
      }
    } catch (err: any) {
      message.error(`${t('settings.aiTools.lightpandaInstallFailed')}: ${err.message}`)
    } finally {
      setInstallingLp(false)
      setInstallProgress(null)
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }

  const handleSelectLightpandaPath = async () => {
    const files = await window.api.dialog.selectFiles()
    if (files && files.length > 0) {
      updateConfig({
        webBrowse: { ...config.webBrowse, lightpandaPath: files[0] }
      })
    }
  }

  // ── Feishu Kits handlers ──

  const feishuKits = config.feishuKits || { enabled: false, cliPath: '' }

  const handleDetectFeishuCli = async () => {
    setDetectingFk(true)
    try {
      const result = await window.api.settings.detectFeishuCli()
      if (result.found) {
        message.success(t('settings.aiTools.feishuCliDetected', result.path))
        updateConfig({
          feishuKits: { ...feishuKits, cliPath: result.path }
        })
      } else {
        message.warning(t('settings.aiTools.feishuCliNotFound'))
      }
    } catch {
      message.warning(t('settings.aiTools.feishuCliNotFound'))
    } finally {
      setDetectingFk(false)
    }
  }

  const handleInstallFeishuCli = async () => {
    setInstallingFk(true)
    setFkInstallProgress({ percent: 0, downloadedMB: '0', totalMB: '?', stage: 'installing' })

    fkCleanupRef.current?.()
    fkCleanupRef.current = window.api.settings.onFeishuCliInstallProgress((data) => {
      setFkInstallProgress(data)
    })

    try {
      const result = await window.api.settings.installFeishuCli()
      if (result.success) {
        message.success(t('settings.aiTools.feishuCliInstallSuccess', result.path))
        updateConfig({
          feishuKits: { ...feishuKits, enabled: true, cliPath: result.path }
        })
      } else {
        message.error(`${t('settings.aiTools.feishuCliInstallFailed')}: ${result.error}`)
      }
    } catch (err: any) {
      message.error(`${t('settings.aiTools.feishuCliInstallFailed')}: ${err.message}`)
    } finally {
      setInstallingFk(false)
      setFkInstallProgress(null)
      fkCleanupRef.current?.()
      fkCleanupRef.current = null
    }
  }

  const handleSyncFeishuCliConfig = async () => {
    setSyncingFkConfig(true)
    try {
      const result = await window.api.settings.writeFeishuCliConfig()
      if (result.success) {
        message.success(t('settings.aiTools.feishuCliConfigSynced'))
        setFkConfigSynced(true)
      } else {
        message.error(result.error)
      }
    } catch (err: any) {
      message.error(err.message)
    } finally {
      setSyncingFkConfig(false)
    }
  }

  const handleSelectFeishuCliPath = async () => {
    const files = await window.api.dialog.selectFiles()
    if (files && files.length > 0) {
      updateConfig({
        feishuKits: { ...feishuKits, cliPath: files[0] }
      })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Web Search & Browse — corresponds to the "Web Search" toggle in AI Chat */}
      <Card
        title={t('settings.aiTools.webSearchGroup')}
        size="small"
        style={{ borderRadius: token.borderRadiusLG, borderColor: token.colorPrimaryBorder }}
        styles={{ body: { padding: '14px 16px' } }}
      >
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 14 }}>
          {t('settings.aiTools.webSearchGroupDesc')}
        </Text>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ── Search engine ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Text strong style={{ fontSize: 13 }}>{t('settings.aiTools.webSearch')}</Text>
            <div>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                {t('settings.aiTools.webSearchProvider')}
              </Text>
              <Radio.Group
                value={config.webSearch.provider}
                onChange={(e) =>
                  updateConfig({
                    webSearch: { ...config.webSearch, provider: e.target.value }
                  })
                }
              >
                <Radio.Button value="duckduckgo">DuckDuckGo</Radio.Button>
                <Radio.Button value="brave">Brave Search</Radio.Button>
              </Radio.Group>
            </div>

            {config.webSearch.provider === 'brave' && (
              <div>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                  {t('settings.aiTools.braveApiKey')}
                </Text>
                <Space.Compact style={{ width: '100%' }}>
                  <Input.Password
                    value={braveKeyInput}
                    onChange={(e) => setBraveKeyInput(e.target.value)}
                    placeholder="BSA-xxxxxxxx"
                    style={{ flex: 1 }}
                  />
                  <Button loading={testingBrave} onClick={handleTestBrave}>
                    {t('settings.aiTools.testConnection')}
                  </Button>
                </Space.Compact>
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                  {t('settings.aiTools.braveApiKeyHelp')}
                </Text>
              </div>
            )}
          </div>

          {/* divider */}
          <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}` }} />

          {/* ── Browse engine ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Text strong style={{ fontSize: 13 }}>{t('settings.aiTools.webBrowse')}</Text>
            <div>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                {t('settings.aiTools.webBrowseEngine')}
              </Text>
              <Radio.Group
                value={config.webBrowse.engine}
                onChange={(e) =>
                  updateConfig({
                    webBrowse: { ...config.webBrowse, engine: e.target.value }
                  })
                }
              >
                <Radio.Button value="http">{t('settings.aiTools.builtinHttp')}</Radio.Button>
                <Radio.Button value="lightpanda">Lightpanda</Radio.Button>
              </Radio.Group>
            </div>

            {config.webBrowse.engine === 'lightpanda' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('settings.aiTools.lightpandaDesc')}
                </Text>

                {/* Path input + detect + file select */}
                <div>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                    {t('settings.aiTools.lightpandaPath')}
                  </Text>
                  <Space.Compact style={{ width: '100%' }}>
                    <Input
                      value={config.webBrowse.lightpandaPath}
                      onChange={(e) =>
                        updateConfig({
                          webBrowse: { ...config.webBrowse, lightpandaPath: e.target.value }
                        })
                      }
                      placeholder="~/.lightpanda/lightpanda"
                      style={{ flex: 1 }}
                    />
                    <Button
                      icon={<FolderOpenOutlined />}
                      onClick={handleSelectLightpandaPath}
                    />
                    <Button
                      icon={<SearchOutlined />}
                      loading={detectingLp}
                      onClick={handleDetectLightpanda}
                    >
                      {t('settings.aiTools.lightpandaDetect')}
                    </Button>
                  </Space.Compact>
                  {config.webBrowse.lightpandaPath && (
                    <Tag
                      icon={<CheckCircleOutlined />}
                      color="success"
                      style={{ marginTop: 4 }}
                    >
                      {config.webBrowse.lightpandaPath}
                    </Tag>
                  )}
                </div>

                {/* Install (only when no path configured) + links */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {!config.webBrowse.lightpandaPath && (
                      <Button
                        type="primary"
                        icon={<DownloadOutlined />}
                        loading={installingLp}
                        onClick={handleInstallLightpanda}
                        size="small"
                      >
                        {installingLp
                          ? t('settings.aiTools.lightpandaInstalling')
                          : t('settings.aiTools.lightpandaInstall')}
                      </Button>
                    )}
                    <Button
                      type="link"
                      icon={<GithubOutlined />}
                      size="small"
                      href={LIGHTPANDA_GITHUB}
                      target="_blank"
                      style={{ padding: '0 4px' }}
                    >
                      {t('settings.aiTools.lightpandaGitHub')}
                    </Button>
                    <Button
                      type="link"
                      icon={<LinkOutlined />}
                      size="small"
                      href={LIGHTPANDA_DOCS}
                      target="_blank"
                      style={{ padding: '0 4px' }}
                    >
                      {t('settings.aiTools.lightpandaDocs')}
                    </Button>
                  </div>
                  {installingLp && installProgress && (
                    <div>
                      <Progress
                        percent={installProgress.percent >= 0 ? installProgress.percent : 0}
                        size="small"
                        status={installProgress.stage === 'error' ? 'exception' : installProgress.percent >= 100 ? 'success' : 'active'}
                        format={() =>
                          installProgress.stage === 'connecting'
                            ? t('settings.aiTools.lightpandaConnecting')
                            : installProgress.stage === 'writing'
                              ? t('settings.aiTools.lightpandaWriting')
                              : `${installProgress.downloadedMB} / ${installProgress.totalMB} MB`
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Feishu Kits */}
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{t('settings.aiTools.feishuKits')}</span>
            <Switch
              size="small"
              checked={feishuKits.enabled}
              onChange={(checked) =>
                updateConfig({ feishuKits: { ...feishuKits, enabled: checked } })
              }
            />
          </div>
        }
        size="small"
        style={{ borderRadius: token.borderRadiusLG, borderColor: token.colorPrimaryBorder }}
        styles={{ body: { padding: '14px 16px' } }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('settings.aiTools.feishuKitsDesc')}
          </Text>

          {/* CLI Path input + detect + file select */}
          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
              {t('settings.aiTools.feishuCliPath')}
            </Text>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                value={feishuKits.cliPath}
                onChange={(e) =>
                  updateConfig({
                    feishuKits: { ...feishuKits, cliPath: e.target.value }
                  })
                }
                placeholder="~/.local/bin/feishu-cli"
                style={{ flex: 1 }}
              />
              <Button
                icon={<FolderOpenOutlined />}
                onClick={handleSelectFeishuCliPath}
              />
              <Button
                icon={<SearchOutlined />}
                loading={detectingFk}
                onClick={handleDetectFeishuCli}
              >
                {t('settings.aiTools.feishuCliDetect')}
              </Button>
            </Space.Compact>
            {feishuKits.cliPath && (
              <Tag
                icon={<CheckCircleOutlined />}
                color="success"
                style={{ marginTop: 4 }}
              >
                {feishuKits.cliPath}
              </Tag>
            )}
          </div>

          {/* Install + links */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {!feishuKits.cliPath && (
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  loading={installingFk}
                  onClick={handleInstallFeishuCli}
                  size="small"
                >
                  {installingFk
                    ? t('settings.aiTools.feishuCliInstalling')
                    : t('settings.aiTools.feishuCliInstall')}
                </Button>
              )}
              <Button
                type="link"
                icon={<GithubOutlined />}
                size="small"
                href={FEISHU_CLI_GITHUB}
                target="_blank"
                style={{ padding: '0 4px' }}
              >
                GitHub
              </Button>
            </div>
            {installingFk && fkInstallProgress && (
              <div>
                <Progress
                  percent={fkInstallProgress.percent >= 0 ? fkInstallProgress.percent : 0}
                  size="small"
                  status={fkInstallProgress.stage === 'error' ? 'exception' : fkInstallProgress.percent >= 100 ? 'success' : 'active'}
                  format={() =>
                    fkInstallProgress.stage === 'installing'
                      ? t('settings.aiTools.feishuCliInstalling')
                      : fkInstallProgress.stage === 'verifying'
                        ? t('settings.aiTools.feishuCliVerifying')
                        : fkInstallProgress.stage === 'done'
                          ? t('settings.aiTools.feishuCliDone')
                          : t('settings.aiTools.feishuCliInstalling')
                  }
                />
              </div>
            )}
          </div>

          {/* Sync config from IM credentials */}
          {fkHasImCredentials && (
            <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <Text style={{ fontSize: 13 }}>{t('settings.aiTools.feishuCliConfigSync')}</Text>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t('settings.aiTools.feishuCliConfigSyncDesc')}
                    </Text>
                  </div>
                </div>
                <Button
                  icon={fkConfigSynced ? <CheckCircleOutlined /> : <SettingOutlined />}
                  loading={syncingFkConfig}
                  onClick={handleSyncFeishuCliConfig}
                  size="small"
                  type={fkConfigSynced ? 'default' : 'primary'}
                >
                  {fkConfigSynced
                    ? t('settings.aiTools.feishuCliConfigResync')
                    : t('settings.aiTools.feishuCliConfigSyncBtn')}
                </Button>
              </div>
              {fkConfigSynced && (
                <Tag icon={<CheckCircleOutlined />} color="success" style={{ marginTop: 6 }}>
                  ~/.feishu-cli/config.yaml
                </Tag>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Tool Behavior */}
      <Card
        title={t('settings.aiTools.toolBehavior')}
        size="small"
        style={{ borderRadius: token.borderRadiusLG, borderColor: token.colorPrimaryBorder }}
        styles={{ body: { padding: '14px 16px' } }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Text style={{ minWidth: 140 }}>{t('settings.aiTools.maxToolSteps')}</Text>
            <InputNumber
              min={1}
              max={50}
              value={config.toolBehavior.maxToolSteps}
              onChange={(val) =>
                updateConfig({
                  toolBehavior: { ...config.toolBehavior, maxToolSteps: val ?? 10 }
                })
              }
              style={{ width: 120 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Text style={{ minWidth: 140 }}>{t('settings.aiTools.maxSearchRounds')}</Text>
            <InputNumber
              min={1}
              max={20}
              value={config.toolBehavior.maxSearchRounds}
              onChange={(val) =>
                updateConfig({
                  toolBehavior: { ...config.toolBehavior, maxSearchRounds: val ?? 5 }
                })
              }
              style={{ width: 120 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Text style={{ minWidth: 140 }}>{t('settings.aiTools.toolTimeout')}</Text>
            <InputNumber
              min={10}
              max={300}
              value={Math.round(config.toolBehavior.toolTimeoutMs / 1000)}
              onChange={(val) =>
                updateConfig({
                  toolBehavior: { ...config.toolBehavior, toolTimeoutMs: (val ?? 60) * 1000 }
                })
              }
              style={{ width: 120 }}
            />
          </div>
        </div>
      </Card>
    </div>
  )
}

export default AIToolsSettings
