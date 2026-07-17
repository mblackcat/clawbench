import React, { useEffect, useState, useRef } from 'react'
import {
  Typography,
  Card,
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
  CheckCircleOutlined,
  FolderOpenOutlined
} from '@ant-design/icons'
import { useT } from '../../i18n'
import { useSettingsStore } from '../../stores/useSettingsStore'
import type { AiToolsConfig } from '../../types/ipc'

const { Text } = Typography

const DEFAULT_CONFIG: AiToolsConfig = {
  webSearch: { provider: 'duckduckgo', braveApiKey: '' },
  webBrowse: { engine: 'http', lightpandaPath: '' },
  feishuKits: { enabled: false, cliPath: '' },
  // maxToolSteps / maxSearchRounds unused by agent loop
  toolBehavior: { maxToolSteps: 0, maxSearchRounds: 0, toolTimeoutMs: 60000 }
}

const LARK_CLI_GITHUB = 'https://github.com/larksuite/cli'

/**
 * AI Tools settings — Feishu kits + tool timeout only.
 * Web search/fetch backends are internalized (DDG + HTTP; optional Brave/Lightpanda if present on disk).
 */
const AIToolsSettings: React.FC = () => {
  const { token } = theme.useToken()
  const { message, modal } = App.useApp()
  const t = useT()
  const { aiToolsConfig, fetchAiToolsConfig, updateAiToolsConfig } = useSettingsStore()

  const [detectingFk, setDetectingFk] = useState(false)
  const [installingFk, setInstallingFk] = useState(false)
  const [fkInstallProgress, setFkInstallProgress] = useState<{
    percent: number
    downloadedMB: string
    totalMB: string
    stage: string
  } | null>(null)
  const fkCleanupRef = useRef<(() => void) | null>(null)
  const [isFeishuUser, setIsFeishuUser] = useState(false)

  const config = aiToolsConfig || DEFAULT_CONFIG

  useEffect(() => {
    fetchAiToolsConfig()
  }, [fetchAiToolsConfig])

  useEffect(() => {
    window.api.settings
      .getFeishuKitsAuthStatus()
      .then((res) => {
        setIsFeishuUser(!!res.isFeishuUser)
      })
      .catch(() => setIsFeishuUser(false))
  }, [])

  const updateConfig = (patch: Partial<AiToolsConfig>) => {
    const merged = { ...config, ...patch }
    updateAiToolsConfig(merged)
  }

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
          feishuKits: { ...feishuKits, cliPath: result.path }
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

  const handleSelectFeishuCliPath = async () => {
    const files = await window.api.dialog.selectFiles()
    if (files && files.length > 0) {
      updateConfig({
        feishuKits: { ...feishuKits, cliPath: files[0] }
      })
    }
  }

  const handleToggleFeishuKits = (checked: boolean) => {
    if (!checked) {
      updateConfig({ feishuKits: { ...feishuKits, enabled: false } })
      return
    }

    if (!isFeishuUser) {
      modal.warning({
        title: t('settings.aiTools.feishuKitsNeedLoginTitle'),
        content: t('settings.aiTools.feishuKitsNeedLoginDesc'),
      })
      return
    }

    modal.confirm({
      title: t('settings.aiTools.feishuKitsEnableTitle'),
      content: t('settings.aiTools.feishuKitsEnableDesc'),
      okText: t('settings.aiTools.feishuKitsEnableOk'),
      cancelText: t('common.cancel'),
      onOk: () => {
        updateConfig({ feishuKits: { ...feishuKits, enabled: true } })
        message.success(t('settings.aiTools.feishuKitsEnabled'))
      },
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Web tools — zero-config note */}
      <Card
        title={t('settings.aiTools.webSearchGroup')}
        size="small"
        style={{ borderRadius: token.borderRadiusLG, borderColor: token.colorPrimaryBorder }}
        styles={{ body: { padding: '14px 16px' } }}
      >
        <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
          {t('settings.aiTools.webToolsAutoDesc')}
        </Text>
      </Card>

      {/* Feishu Kits */}
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{t('settings.aiTools.feishuKits')}</span>
            <Switch
              size="small"
              checked={feishuKits.enabled}
              onChange={handleToggleFeishuKits}
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

          <div>
            {isFeishuUser ? (
              <Tag icon={<CheckCircleOutlined />} color="success">
                {t('settings.aiTools.feishuKitsAuthOk')}
              </Tag>
            ) : (
              <Tag color="warning">{t('settings.aiTools.feishuKitsAuthMissing')}</Tag>
            )}
          </div>

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
                placeholder="lark-cli"
                style={{ flex: 1 }}
              />
              <Button icon={<FolderOpenOutlined />} onClick={handleSelectFeishuCliPath} />
              <Button
                icon={<SearchOutlined />}
                loading={detectingFk}
                onClick={handleDetectFeishuCli}
              >
                {t('settings.aiTools.feishuCliDetect')}
              </Button>
            </Space.Compact>
            {feishuKits.cliPath && (
              <Tag icon={<CheckCircleOutlined />} color="success" style={{ marginTop: 4 }}>
                {feishuKits.cliPath}
              </Tag>
            )}
          </div>

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
                href={LARK_CLI_GITHUB}
                target="_blank"
                style={{ padding: '0 4px' }}
              >
                GitHub
              </Button>
            </div>
            {installingFk && fkInstallProgress && (
              <Progress
                percent={fkInstallProgress.percent >= 0 ? fkInstallProgress.percent : 0}
                size="small"
                status={
                  fkInstallProgress.stage === 'error'
                    ? 'exception'
                    : fkInstallProgress.percent >= 100
                      ? 'success'
                      : 'active'
                }
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
            )}
          </div>
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
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('settings.aiTools.toolBehaviorHint')}
          </Text>
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
            <Text type="secondary" style={{ fontSize: 12 }}>s</Text>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default AIToolsSettings
