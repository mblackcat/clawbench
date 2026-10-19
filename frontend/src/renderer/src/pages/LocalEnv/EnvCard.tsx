import React, { useCallback, useEffect, useState } from 'react'
import { Tag, Button, Typography, Tooltip, Popconfirm, Switch, Popover, App, Spin } from 'antd'
import {
  DownloadOutlined,
  GlobalOutlined,
  FolderOutlined,
  ReloadOutlined,
  DeleteOutlined,
  ArrowUpOutlined,
  AppstoreOutlined,
  SettingOutlined,
  PoweroffOutlined,
  LoadingOutlined
} from '@ant-design/icons'
import { theme } from 'antd'
import type { ToolDetectionResult, PackageManagerInfo, MirrorSourceStatus, MirrorToolId } from '../../types/local-env'
import { AI_CODING_TOOL_ID_SET, MIRROR_TOOL_ID_SET } from '../../types/local-env'
import { openExternalLink } from '../../utils/markdown-links'
import { useT } from '../../i18n'
import { ProviderIcon } from '../../components/ProviderIcons'
import { EnvToolIcon, hasEnvToolIcon } from '../../components/ToolIcons'
import { FolderCard } from '../../components/FolderCard'

const { Text } = Typography

interface EnvCardProps {
  tool: ToolDetectionResult
  packageManagers: PackageManagerInfo | null
  platform: string
  installing: boolean
  refreshing: boolean
  uninstalling?: boolean
  upgrading?: boolean
  /** Latest published version (from npm registry), if known — AI coding tools only */
  latestVersion?: string | null
  /** Whether this coding tool is enabled for AI Coding module (AI tools only) */
  codingEnabled?: boolean
  onInstall: (toolId: string) => void
  onRefresh: (toolId: string) => void
  onUninstall?: (toolId: string) => void
  onUpgrade?: (toolId: string) => void
  onOpenPackages?: (kind: 'pip' | 'npm', pythonPath?: string) => void
  onCodingEnabledChange?: (toolId: string, enabled: boolean) => void
}

// Brand provider key for AI coding CLI tools that already have an icon in ProviderIcons.tsx
const AI_TOOL_PROVIDERS: Record<string, string> = {
  'claude-code': 'claude',
  'codex-cli': 'codex',
  'gemini-cli': 'google',
  'grok-cli': 'grok',
  opencode: 'opencode',
  traecli: 'trae',
  'qoder-cli': 'qoder',
  'kimi-code': 'kimi',
  zcode: 'zhipu',
  'mimo-code': 'mimo',
  'antigravity-cli': 'antigravity',
  omp: 'omp'
}

function renderToolIcon(toolId: string, size = 20) {
  if (hasEnvToolIcon(toolId)) {
    return <EnvToolIcon toolId={toolId} size={size} />
  }
  const provider = AI_TOOL_PROVIDERS[toolId] ?? toolId
  return <ProviderIcon provider={provider} size={size} />
}

/** Simple dotted-numeric version comparator (mirrors applicationManager.ts) */
function isNewerVersion(current: string, latest: string): boolean {
  const currentParts = current.split('.').map(Number)
  const latestParts = latest.split('.').map(Number)
  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const c = currentParts[i] || 0
    const l = latestParts[i] || 0
    if (l > c) return true
    if (l < c) return false
  }
  return false
}

const NPM_TOOL_IDS = new Set(['gemini-cli', 'codex-cli', 'qoder-cli', 'kimi-code', 'mimo-code', 'opencode'])

/** Official homepage per tool, shown as a link button on the card. */
const TOOL_HOMEPAGE_URLS: Record<string, string> = {
  python: 'https://www.python.org',
  nodejs: 'https://nodejs.org',
  docker: 'https://www.docker.com',
  git: 'https://git-scm.com',
  mysql: 'https://www.mysql.com',
  postgresql: 'https://www.postgresql.org',
  mongodb: 'https://www.mongodb.com',
  redis: 'https://redis.io',
  java: 'https://adoptium.net',
  go: 'https://go.dev',
  homebrew: 'https://brew.sh',
  svn: 'https://subversion.apache.org',
  perforce: 'https://www.perforce.com',
  'claude-code': 'https://docs.anthropic.com/en/docs/claude-code',
  'codex-cli': 'https://github.com/openai/codex',
  'gemini-cli': 'https://github.com/google-gemini/gemini-cli',
  'grok-cli': 'https://x.ai/cli',
  opencode: 'https://opencode.ai',
  traecli: 'https://www.trae.ai',
  'qoder-cli': 'https://docs.qoder.com/cli/install',
  'kimi-code': 'https://code.kimi.com',
  zcode: 'https://zcode.z.ai/en',
  'mimo-code': 'https://mimo.xiaomi.com/mimocode/start',
  'antigravity-cli': 'https://antigravity.google',
  omp: 'https://omp.sh'
}

// Tools whose uninstall is intentionally not offered from this card (no safe
// programmatic uninstall path — e.g. removing Homebrew itself is destructive)
const NO_UNINSTALL_IDS = new Set(['homebrew'])

const EnvCard: React.FC<EnvCardProps> = ({
  tool,
  packageManagers,
  platform,
  installing,
  refreshing,
  uninstalling = false,
  upgrading = false,
  latestVersion,
  codingEnabled = true,
  onInstall,
  onRefresh,
  onUninstall,
  onUpgrade,
  onOpenPackages,
  onCodingEnabledChange
}) => {
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const t = useT()

  const isAiCodingTool = AI_CODING_TOOL_ID_SET.has(tool.toolId)
  const supportsMirror = MIRROR_TOOL_ID_SET.has(tool.toolId)
  const homepageUrl = TOOL_HOMEPAGE_URLS[tool.toolId]
  const installedVersion = tool.installations[0]?.version
  const hasUpdate = Boolean(
    latestVersion &&
    installedVersion &&
    installedVersion !== 'app' &&
    installedVersion !== 'installed' &&
    isNewerVersion(installedVersion, latestVersion)
  )

  const [mirrorOpen, setMirrorOpen] = useState(false)
  const [mirrorLoading, setMirrorLoading] = useState(false)
  const [mirrorSaving, setMirrorSaving] = useState(false)
  const [mirrorStatus, setMirrorStatus] = useState<MirrorSourceStatus | null>(null)

  const loadMirrorStatus = useCallback(async (opts?: { silent?: boolean }) => {
    if (!supportsMirror || !tool.installed) return
    if (!opts?.silent) setMirrorLoading(true)
    try {
      const pythonPath = tool.toolId === 'python' ? tool.installations[0]?.path : undefined
      const result = await window.api.localEnv.getMirrorSource(tool.toolId as MirrorToolId, pythonPath)
      if (result.success && result.status) {
        setMirrorStatus(result.status)
      } else if (!opts?.silent) {
        message.error(result.error || t('localEnv.mirror.loadFailed'))
      }
    } catch (err: unknown) {
      if (!opts?.silent) {
        message.error((err instanceof Error && err.message) || t('localEnv.mirror.loadFailed'))
      }
    } finally {
      if (!opts?.silent) setMirrorLoading(false)
    }
  }, [supportsMirror, tool.installed, tool.toolId, tool.installations, message, t])

  // Quiet preload so the gear can highlight when a China mirror is already on
  useEffect(() => {
    if (tool.installed && supportsMirror) {
      void loadMirrorStatus({ silent: true })
    }
  }, [tool.installed, supportsMirror, tool.toolId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMirrorOpenChange = (open: boolean) => {
    setMirrorOpen(open)
    if (open) {
      void loadMirrorStatus()
    }
  }

  const handleMirrorToggle = async (checked: boolean) => {
    setMirrorSaving(true)
    try {
      const pythonPath = tool.toolId === 'python' ? tool.installations[0]?.path : undefined
      const result = await window.api.localEnv.setMirrorSource(
        tool.toolId as MirrorToolId,
        checked,
        pythonPath
      )
      if (result.success && result.status) {
        setMirrorStatus(result.status)
        message.success(
          checked ? t('localEnv.mirror.enabled') : t('localEnv.mirror.disabled')
        )
        if (checked && result.status.needsRestart) {
          message.info(t('localEnv.mirror.dockerRestartHint'))
        }
      } else {
        message.error(result.error || t('localEnv.mirror.setFailed'))
      }
    } catch (err: unknown) {
      message.error((err instanceof Error && err.message) || t('localEnv.mirror.setFailed'))
    } finally {
      setMirrorSaving(false)
    }
  }

  const mirrorPopoverContent = (
    <div style={{ width: 280 }}>
      {mirrorLoading && !mirrorStatus ? (
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <Spin size="small" />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text strong style={{ fontSize: 13 }}>{t('localEnv.mirror.useChina')}</Text>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('localEnv.mirror.useChinaDesc')}
                </Text>
              </div>
            </div>
            <Switch
              checked={mirrorStatus?.enabled ?? false}
              loading={mirrorSaving || mirrorLoading}
              onChange={handleMirrorToggle}
            />
          </div>
          {mirrorStatus && (
            <div style={{ marginTop: 10 }}>
              <Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                {t('localEnv.mirror.current')}: {mirrorStatus.currentSource}
              </Text>
              <div>
                <Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                  {t('localEnv.mirror.china')}: {mirrorStatus.chinaSource}
                </Text>
              </div>
              {mirrorStatus.needsRestart && (
                <div style={{ marginTop: 6 }}>
                  <Text type="warning" style={{ fontSize: 12 }}>
                    {t('localEnv.mirror.dockerRestartHint')}
                  </Text>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )

  const getInstallLabel = (): { label: string; viaPkgMgr: boolean } => {
    if (
      tool.toolId === 'claude-code' || tool.toolId === 'grok-cli' || tool.toolId === 'kimi-code' ||
      tool.toolId === 'mimo-code' || tool.toolId === 'antigravity-cli' || tool.toolId === 'omp'
    ) {
      return { label: t('localEnv.oneClickInstall'), viaPkgMgr: true }
    }
    if (NPM_TOOL_IDS.has(tool.toolId)) {
      return { label: t('localEnv.viaNpm'), viaPkgMgr: true }
    }
    if (platform === 'darwin' || platform === 'linux') {
      if (packageManagers?.brew) {
        return { label: t('localEnv.viaBrew'), viaPkgMgr: true }
      }
    } else if (platform === 'win32') {
      if (packageManagers?.winget) {
        return { label: t('localEnv.viaWinget'), viaPkgMgr: true }
      }
    }
    return { label: t('localEnv.download'), viaPkgMgr: false }
  }

  const { label: installLabel, viaPkgMgr } = getInstallLabel()
  const isActiveCoding = tool.installed && isAiCodingTool && codingEnabled
  const variant = !tool.installed ? 'draft' : isActiveCoding ? 'builtin' : 'regular'
  const tagStyle: React.CSSProperties = { margin: 0, fontSize: 10, lineHeight: '16px', height: 18, padding: '0 5px' }
  const formatVersion = (version: string): string =>
    version === 'app' || version === 'installed' ? t('localEnv.installed') : `v${version}`

  const notchActions = (
    <>
      {homepageUrl && (
        <Tooltip title={t('localEnv.officialWebsite')}>
          <button type="button" className="cb-notch-btn" onClick={() => openExternalLink(homepageUrl)}>
            <GlobalOutlined style={{ fontSize: 13 }} />
          </button>
        </Tooltip>
      )}
      <Tooltip title={t('localEnv.refreshDetect')}>
        <button type="button" className="cb-notch-btn" onClick={() => onRefresh(tool.toolId)}>
          <ReloadOutlined spin={refreshing} style={{ fontSize: 13 }} />
        </button>
      </Tooltip>
    </>
  )

  return (
    <FolderCard
      variant={variant}
      notchActions={notchActions}
      className={isActiveCoding ? 'cb-card-active-coding' : undefined}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 32,
          width: 'calc(100% - 74px)'
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: token.colorFillSecondary,
            flexShrink: 0
          }}
        >
          {renderToolIcon(tool.toolId, 18)}
        </div>
        <Text strong ellipsis style={{ fontSize: 13, lineHeight: '20px' }}>
          {tool.name}
        </Text>
      </div>

      {/* Content */}
      <div style={{ flex: 1, margin: '6px 0 8px 0', minHeight: 44, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {tool.installed ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tool.installations.map((inst, idx) => (
              <div
                key={idx}
                style={{
                  padding: '6px 10px',
                  borderRadius: token.borderRadius,
                  background: token.colorFillAlter,
                  fontSize: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  {/* The primary version sits in the bottom row; list it per row only when there are several */}
                  {tool.installations.length > 1 && (
                    <Tag color="blue" style={tagStyle}>{formatVersion(inst.version)}</Tag>
                  )}
                  {inst.managedBy && (
                    <Tag color="purple" style={tagStyle}>{inst.managedBy}</Tag>
                  )}
                  {idx === 0 && hasUpdate && (
                    <Tag color="success" style={tagStyle}>
                      {t('localEnv.updateAvailable', latestVersion as string)}
                    </Tag>
                  )}
                  {inst.extras && Object.entries(inst.extras).map(([key, val]) => (
                    <Tag key={key} style={tagStyle}>{key} {val}</Tag>
                  ))}
                </div>
                <Tooltip title={inst.path}>
                  <Text
                    className="cb-card-path"
                    style={{
                      fontSize: 12,
                      marginTop: 4,
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <FolderOutlined style={{ marginRight: 4 }} />
                    {inst.path}
                  </Text>
                </Tooltip>
                {tool.toolId === 'python' && onOpenPackages && (
                  <Button
                    type="link"
                    size="small"
                    icon={<AppstoreOutlined />}
                    style={{ padding: '2px 0', height: 'auto', fontSize: 12 }}
                    onClick={() => onOpenPackages('pip', inst.path)}
                  >
                    {t('localEnv.pkg.viewPip')}
                  </Button>
                )}
              </div>
            ))}
            {tool.toolId === 'nodejs' && onOpenPackages && (
              <Button
                type="link"
                size="small"
                icon={<AppstoreOutlined />}
                style={{ padding: '2px 0', height: 'auto', fontSize: 12, alignSelf: 'flex-start' }}
                onClick={() => onOpenPackages('npm')}
              >
                {t('localEnv.pkg.viewNpm')}
              </Button>
            )}
          </div>
        ) : (
          <div style={{ padding: '6px 0' }}>
            <Text className="cb-card-desc" style={{ fontSize: 13 }}>
              {t('localEnv.notDetected', tool.name)}
            </Text>
          </div>
        )}
      </div>

      {/* Bottom row: version on the left, round actions on the right */}
      <div
        style={{
          marginTop: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 8
        }}
      >
        <div>
          {tool.installed ? (
            <Tag color="blue" style={tagStyle}>
              {installedVersion ? formatVersion(installedVersion) : t('localEnv.installed')}
            </Tag>
          ) : (
            <Tag style={tagStyle}>{t('localEnv.notInstalled')}</Tag>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* AI Work enablement toggle — only when installed */}
          {tool.installed && isAiCodingTool && onCodingEnabledChange && (
            <Tooltip title={codingEnabled ? t('localEnv.codingEnabledOn') : t('localEnv.codingEnabledOff')}>
              <button
                type="button"
                aria-pressed={codingEnabled}
                className={`cb-round-action-btn cb-round-action-toggle ${codingEnabled ? 'active' : 'inactive'}`}
                onClick={() => onCodingEnabledChange(tool.toolId, !codingEnabled)}
              >
                <PoweroffOutlined style={{ fontSize: 13 }} />
              </button>
            </Tooltip>
          )}

          {/* China mirror settings (pip / npm / docker) */}
          {tool.installed && supportsMirror && (
            <Popover
              trigger="click"
              open={mirrorOpen}
              onOpenChange={handleMirrorOpenChange}
              title={t('localEnv.mirror.title')}
              content={mirrorPopoverContent}
              placement="bottomRight"
            >
              <Tooltip title={t('localEnv.mirror.settingsTip')}>
                <button
                  type="button"
                  className="cb-round-action-btn cb-round-action-neutral"
                  style={{ color: mirrorStatus?.enabled ? token.colorPrimary : undefined }}
                >
                  <SettingOutlined style={{ fontSize: 13 }} />
                </button>
              </Tooltip>
            </Popover>
          )}

          {/* Only show upgrade when a newer version is known */}
          {tool.installed && isAiCodingTool && hasUpdate && onUpgrade && (
            <Tooltip title={t('localEnv.updateAvailable', latestVersion as string)}>
              <button
                type="button"
                className={`cb-round-action-btn cb-round-action-neutral${upgrading ? ' is-loading' : ''}`}
                disabled={upgrading}
                onClick={() => onUpgrade(tool.toolId)}
              >
                <ArrowUpOutlined spin={upgrading} style={{ fontSize: 13, color: token.colorSuccess }} />
              </button>
            </Tooltip>
          )}

          {tool.installed && !NO_UNINSTALL_IDS.has(tool.toolId) && onUninstall && (
            <Popconfirm
              title={t('localEnv.uninstallConfirm', tool.name)}
              onConfirm={() => onUninstall(tool.toolId)}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
              disabled={uninstalling}
            >
              <Tooltip title={t('localEnv.uninstall')}>
                <button
                  type="button"
                  className={`cb-round-action-btn cb-round-action-danger${uninstalling ? ' is-loading' : ''}`}
                  disabled={uninstalling}
                >
                  {uninstalling ? <LoadingOutlined spin style={{ fontSize: 13 }} /> : <DeleteOutlined style={{ fontSize: 13 }} />}
                </button>
              </Tooltip>
            </Popconfirm>
          )}

          {!tool.installed && (
            <Tooltip title={installing ? t('localEnv.installing') : installLabel}>
              <button
                type="button"
                className={`cb-round-action-btn cb-round-action-primary${installing ? ' is-loading' : ''}`}
                disabled={installing}
                onClick={() => onInstall(tool.toolId)}
              >
                {installing ? (
                  <LoadingOutlined spin style={{ fontSize: 14 }} />
                ) : viaPkgMgr ? (
                  <DownloadOutlined style={{ fontSize: 14 }} />
                ) : (
                  <GlobalOutlined style={{ fontSize: 14 }} />
                )}
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </FolderCard>
  )
}

export default EnvCard
