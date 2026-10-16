import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Row, Col, Spin, Button, Typography, App, theme, Divider } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { useLocalEnvStore } from '../../stores/useLocalEnvStore'
import EnvCard from './EnvCard'
import PackageListDrawer from './PackageListDrawer'
import { useT } from '../../i18n'
import { AI_CODING_TOOL_IDS, AI_CODING_TOOL_ID_SET, isCodingToolEnabledInMap } from '../../types/local-env'
import { invalidateCodingToolsCache } from '../AICoding/AICodingNewSessionDialog'

const { Title, Text } = Typography

const BASE_DEV_IDS = new Set(['homebrew', 'python', 'nodejs', 'go', 'java', 'docker'])
const DATABASE_IDS = new Set(['mysql', 'postgresql', 'mongodb', 'redis'])
const VCS_IDS = new Set(['git', 'svn', 'perforce'])

/** Route state / hash that asks the page to scroll to (and flash) the AI tools group. */
const LOCAL_ENV_AI_TOOLS_ANCHOR = 'ai-tools'

interface PackageDrawerState {
  kind: 'pip' | 'npm'
  pythonPath?: string
  title: string
}

const LocalEnvPage: React.FC = () => {
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const t = useT()
  const location = useLocation()
  const navigate = useNavigate()

  const tools = useLocalEnvStore((s) => s.tools)
  const packageManagers = useLocalEnvStore((s) => s.packageManagers)
  const platform = useLocalEnvStore((s) => s.platform)
  const detecting = useLocalEnvStore((s) => s.detecting)
  const installing = useLocalEnvStore((s) => s.installing)
  const uninstalling = useLocalEnvStore((s) => s.uninstalling)
  const upgrading = useLocalEnvStore((s) => s.upgrading)
  const refreshingOne = useLocalEnvStore((s) => s.refreshingOne)
  const latestVersions = useLocalEnvStore((s) => s.latestVersions)
  const detectAll = useLocalEnvStore((s) => s.detectAll)
  const detectOne = useLocalEnvStore((s) => s.detectOne)
  const installTool = useLocalEnvStore((s) => s.installTool)
  const uninstallTool = useLocalEnvStore((s) => s.uninstallTool)
  const upgradeTool = useLocalEnvStore((s) => s.upgradeTool)
  const checkLatestVersions = useLocalEnvStore((s) => s.checkLatestVersions)

  const [packageDrawer, setPackageDrawer] = useState<PackageDrawerState | null>(null)
  /** Explicit user overrides only; missing keys use DEFAULT_ENABLED_CODING_TOOL_IDS */
  const [codingToolsEnabled, setCodingToolsEnabled] = useState<Record<string, boolean>>({})
  const aiSectionRef = useRef<HTMLDivElement>(null)
  const [highlightAi, setHighlightAi] = useState(false)

  // Deep link: navigate('/local-env', { state: { scrollTo: 'ai-tools' } }) or
  // '/local-env#ai-tools' scrolls to the AI tools group and briefly highlights it.
  useEffect(() => {
    const state = location.state as { scrollTo?: string } | null | undefined
    const shouldScroll =
      state?.scrollTo === LOCAL_ENV_AI_TOOLS_ANCHOR || location.hash === `#${LOCAL_ENV_AI_TOOLS_ANCHOR}`
    if (!shouldScroll) return

    let clearHighlight: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(() => {
      if (!aiSectionRef.current) return
      aiSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setHighlightAi(true)
      clearHighlight = setTimeout(() => setHighlightAi(false), 2000)
    }, 200)

    // Consume the request so a re-render / back navigation doesn't scroll again
    if (state?.scrollTo) {
      navigate(location.pathname + location.search + location.hash, { replace: true, state: null })
    }

    return () => {
      clearTimeout(timer)
      if (clearHighlight) clearTimeout(clearHighlight)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key, location.hash])

  // Load from cache on mount; force re-detect if the AI coding tool set is stale
  // (new tools added, or cached tool ids that no group knows about any more)
  useEffect(() => {
    const cached = useLocalEnvStore.getState().tools
    const knownIds = new Set(cached.map((t) => t.toolId))
    const missingNew = AI_CODING_TOOL_IDS.some((id) => !knownIds.has(id))
    const hasLegacy = cached.some(
      (tl) =>
        !AI_CODING_TOOL_ID_SET.has(tl.toolId) &&
        !BASE_DEV_IDS.has(tl.toolId) &&
        !DATABASE_IDS.has(tl.toolId) &&
        !VCS_IDS.has(tl.toolId)
    )
    detectAll(missingNew || hasLegacy)
    checkLatestVersions([...AI_CODING_TOOL_IDS], missingNew || hasLegacy)
    window.api.localEnv.getCodingToolsEnabled().then(setCodingToolsEnabled).catch(() => {})
  }, [])

  const { baseTools, dbTools, vcsTools, aiTools } = useMemo(() => {
    const isMac = platform === 'darwin'
    const aiOrder = new Map(AI_CODING_TOOL_IDS.map((id, i) => [id, i]))
    return {
      // Show homebrew only on Mac; filter it out on other platforms
      baseTools: tools.filter((t) => BASE_DEV_IDS.has(t.toolId) && (t.toolId !== 'homebrew' || isMac)),
      dbTools: tools.filter((t) => DATABASE_IDS.has(t.toolId)),
      vcsTools: tools.filter((t) => VCS_IDS.has(t.toolId)),
      // Stable user-facing order (Claude → … → MiMo); drop removed tools e.g. qwen-code
      aiTools: tools
        .filter((t) => AI_CODING_TOOL_ID_SET.has(t.toolId))
        .sort((a, b) => (aiOrder.get(a.toolId as typeof AI_CODING_TOOL_IDS[number]) ?? 99) - (aiOrder.get(b.toolId as typeof AI_CODING_TOOL_IDS[number]) ?? 99))
    }
  }, [tools, platform])

  const handleInstall = async (toolId: string) => {
    // Ignore re-clicks while this tool is already installing (store guards too)
    if (useLocalEnvStore.getState().installing[toolId]) return
    const toolName = tools.find((tl) => tl.toolId === toolId)?.name || toolId
    const hideLoading = message.loading(t('localEnv.installingTool', toolName), 0)
    try {
      const result = await installTool(toolId)
      hideLoading()
      if (result.success) {
        if (result.launchedSetup) {
          message.info(t('localEnv.launchedSetup'))
        } else if (result.openedBrowser) {
          message.info(t('localEnv.openedDownload'))
        } else {
          message.success(t('localEnv.installSuccess'))
        }
      } else {
        message.error(result.error || t('localEnv.installFailed'))
      }
    } catch (err: unknown) {
      hideLoading()
      const errorMsg = err instanceof Error ? err.message : String(err)
      message.error(errorMsg || t('localEnv.installFailed'))
    }
  }

  const handleUninstall = async (toolId: string) => {
    const result = await uninstallTool(toolId)
    if (result.success) {
      message.success(t('localEnv.uninstallSuccess'))
    } else {
      message.error(result.error || t('localEnv.uninstallFailed'))
    }
  }

  const handleUpgrade = async (toolId: string) => {
    const result = await upgradeTool(toolId)
    if (result.success) {
      message.success(t('localEnv.upgradeSuccess'))
    } else {
      message.error(result.error || t('localEnv.upgradeFailed'))
    }
  }

  const handleOpenPackages = (kind: 'pip' | 'npm', pythonPath?: string) => {
    setPackageDrawer({
      kind,
      pythonPath,
      title: kind === 'pip' ? t('localEnv.pkg.pipTitle') : t('localEnv.pkg.npmTitle')
    })
  }

  const handleRefresh = () => {
    invalidateCodingToolsCache()
    detectAll(true)
    checkLatestVersions([...AI_CODING_TOOL_IDS], true)
  }

  const handleRefreshOne = (toolId: string) => {
    detectOne(toolId)
    if (AI_CODING_TOOL_ID_SET.has(toolId)) {
      checkLatestVersions([toolId], true)
    }
  }

  const handleCodingEnabledChange = useCallback(async (toolId: string, enabled: boolean) => {
    // Optimistic UI update
    setCodingToolsEnabled((prev) => ({ ...prev, [toolId]: enabled }))
    try {
      const next = await window.api.localEnv.setCodingToolEnabled(toolId, enabled)
      setCodingToolsEnabled(next)
      // AI Coding tool pickers cache detect results — force a refresh next open
      invalidateCodingToolsCache()
    } catch (err) {
      console.error('Failed to update coding tool enablement:', err)
      // Revert on failure
      setCodingToolsEnabled((prev) => ({ ...prev, [toolId]: !enabled }))
    }
  }, [])

  const renderGroup = (title: string, groupTools: typeof tools) => (
    <>
      <Text strong style={{ fontSize: 14, color: token.colorTextSecondary }}>
        {title}
      </Text>
      <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
        {groupTools.map((tool) => (
          <Col key={tool.toolId} xs={24} sm={12} md={12} lg={6}>
            <EnvCard
              tool={tool}
              packageManagers={packageManagers}
              platform={platform}
              installing={installing[tool.toolId] || false}
              refreshing={refreshingOne[tool.toolId] || false}
              uninstalling={uninstalling[tool.toolId] || false}
              upgrading={upgrading[tool.toolId] || false}
              latestVersion={latestVersions[tool.toolId]}
              codingEnabled={isCodingToolEnabledInMap(codingToolsEnabled, tool.toolId)}
              onInstall={handleInstall}
              onRefresh={handleRefreshOne}
              onUninstall={handleUninstall}
              onUpgrade={handleUpgrade}
              onOpenPackages={handleOpenPackages}
              onCodingEnabledChange={handleCodingEnabledChange}
            />
          </Col>
        ))}
      </Row>
    </>
  )

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 24
      }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>{t('localEnv.title')}</Title>
          <Text type="secondary">{t('localEnv.subtitle')}</Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={handleRefresh}
          loading={detecting}
        >
          {t('localEnv.refreshAll')}
        </Button>
      </div>

      <Spin spinning={detecting && tools.length === 0}>
        {renderGroup(t('localEnv.groupBase'), baseTools)}

        <Divider style={{ margin: '24px 0 16px' }} />

        {renderGroup(t('localEnv.groupDB'), dbTools)}

        <Divider style={{ margin: '24px 0 16px' }} />

        {renderGroup(t('localEnv.groupVCS'), vcsTools)}

        <Divider style={{ margin: '24px 0 16px' }} />

        <div
          ref={aiSectionRef}
          id={LOCAL_ENV_AI_TOOLS_ANCHOR}
          style={{
            scrollMarginTop: 24,
            borderRadius: token.borderRadiusLG,
            padding: highlightAi ? 12 : 0,
            margin: highlightAi ? '-12px -12px 0' : 0,
            backgroundColor: highlightAi ? token.colorPrimaryBg : 'transparent',
            boxShadow: highlightAi ? `0 0 0 2px ${token.colorPrimaryBorder}` : 'none',
            transition: 'all 0.4s ease'
          }}
        >
          {renderGroup(t('localEnv.groupAI'), aiTools)}
        </div>
      </Spin>

      <PackageListDrawer
        open={!!packageDrawer}
        title={packageDrawer?.title || ''}
        onClose={() => setPackageDrawer(null)}
        loadPackages={async () => {
          if (!packageDrawer) return { success: false }
          return packageDrawer.kind === 'pip'
            ? window.api.localEnv.listPipPackages(packageDrawer.pythonPath)
            : window.api.localEnv.listNpmPackages()
        }}
        uninstallPackage={async (name) => {
          if (!packageDrawer) return { success: false }
          return packageDrawer.kind === 'pip'
            ? window.api.localEnv.uninstallPipPackage(name, packageDrawer.pythonPath)
            : window.api.localEnv.uninstallNpmPackage(name)
        }}
      />
    </div>
  )
}

export default LocalEnvPage
