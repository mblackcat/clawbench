import React, { useEffect, useRef, useState } from 'react'
import { Tabs, Row, Col, Spin, Modal, Input, Checkbox, Typography, App, theme, Divider, Steps, Button } from 'antd'
import type { InputRef } from 'antd'
import Icon from '@ant-design/icons'
import {
  ExclamationCircleFilled,
  MessageOutlined,
  ThunderboltOutlined,
  BuildOutlined,
  ScheduleOutlined,
  ApiOutlined,
  ArrowLeftOutlined,
  LinkOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useT } from '../../i18n'
import { useOpenClawStore } from '../../stores/useOpenClawStore'
import NotInstalledView from './NotInstalledView'
import StatusBar from './StatusBar'
import OpenClawItemCard from './OpenClawItemCard'
import BottomBar from './BottomBar'
import CommunitySkillCard from './CommunitySkillCard'
import CronJobManager from './CronJobManager'
import ModelPriorityPanel from './ModelPriorityPanel'

const BrainSvg = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M13 3a5 5 0 0 1 4.36 2.56A4 4 0 0 1 20 9a4 4 0 0 1-1.19 2.83c.12.37.19.76.19 1.17a4 4 0 0 1-2 3.46V18a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-1.54A4 4 0 0 1 5 13c0-.41.07-.8.19-1.17A4 4 0 0 1 4 9a4 4 0 0 1 2.64-3.44A5 5 0 0 1 11 3c.7 0 1.38.14 2 .4A5 5 0 0 1 13 3z"/>
    <rect x="11" y="3" width="2" height="17" fill="rgba(0,0,0,0.18)" rx="1"/>
  </svg>
)
const BrainIcon = (props: any) => <Icon component={BrainSvg} {...props} />
const { Text } = Typography

const OpenClawPage: React.FC = () => {
  const { message, modal } = App.useApp()
  const { token } = theme.useToken()
  const navigate = useNavigate()
  const t = useT()
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('ai_provider')

  // Uninstall dialog state
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const [uninstallCode, setUninstallCode] = useState('')
  const [uninstallInput, setUninstallInput] = useState('')
  const [removeConfig, setRemoveConfig] = useState(false)

  // Feishu pairing dialog state
  const [pairingOpen, setPairingOpen] = useState(false)
  const [pairingCode, setPairingCode] = useState('')
  const [pairingLoading, setPairingLoading] = useState(false)
  const pairingInputRef = useRef<InputRef>(null)

  const installCheck = useOpenClawStore((s) => s.installCheck)
  const serviceStatus = useOpenClawStore((s) => s.serviceStatus)
  const items = useOpenClawStore((s) => s.items)
  const modelPriority = useOpenClawStore((s) => s.modelPriority)
  const configLoading = useOpenClawStore((s) => s.configLoading)
  const dirty = useOpenClawStore((s) => s.dirty)
  const saving = useOpenClawStore((s) => s.saving)
  const applying = useOpenClawStore((s) => s.applying)
  const uninstalling = useOpenClawStore((s) => s.uninstalling)
  const communitySkills = useOpenClawStore((s) => s.communitySkills)
  const installedSkillIds = useOpenClawStore((s) => s.installedSkillIds)
  const skillsLoading = useOpenClawStore((s) => s.skillsLoading)
  const latestVersion = useOpenClawStore((s) => s.latestVersion)
  const upgrading = useOpenClawStore((s) => s.upgrading)

  const checkInstalled = useOpenClawStore((s) => s.checkInstalled)
  const fetchStatus = useOpenClawStore((s) => s.fetchStatus)
  const fetchConfig = useOpenClawStore((s) => s.fetchConfig)
  const updateItemEnabled = useOpenClawStore((s) => s.updateItemEnabled)
  const updateItemConfigValue = useOpenClawStore((s) => s.updateItemConfigValue)
  const updateModelPriority = useOpenClawStore((s) => s.updateModelPriority)
  const saveConfigAction = useOpenClawStore((s) => s.saveConfig)
  const applyConfigAction = useOpenClawStore((s) => s.applyConfig)
  const startServiceAction = useOpenClawStore((s) => s.startService)
  const stopServiceAction = useOpenClawStore((s) => s.stopService)
  const uninstallAction = useOpenClawStore((s) => s.uninstallOpenClaw)
  const fetchCommunitySkills = useOpenClawStore((s) => s.fetchCommunitySkills)
  const installSkillAction = useOpenClawStore((s) => s.installSkill)
  const fetchCronJobs = useOpenClawStore((s) => s.fetchCronJobs)
  const checkUpdate = useOpenClawStore((s) => s.checkUpdate)
  const upgradeOpenClawAction = useOpenClawStore((s) => s.upgradeOpenClaw)
  const pairingApproveAction = useOpenClawStore((s) => s.pairingApprove)

  useEffect(() => {
    checkInstalled()
  }, [])

  useEffect(() => {
    if (installCheck?.installed) {
      fetchStatus()
      fetchConfig()
      checkUpdate()
    }
  }, [installCheck?.installed])

  const handleStart = async () => {
    setStarting(true)
    const result = await startServiceAction()
    setStarting(false)
    if (result.success) {
      message.success(t('agents.started'))
      // Check if minimum config (at least one AI provider + one comm tool) is set.
      // Show a one-time reminder so the user knows what to configure next.
      const hasProvider = items.some((i) => i.category === 'ai_provider' && i.enabled)
      const hasCommTool = items.some((i) => i.category === 'comm_tool' && i.enabled)
      if (!hasProvider || !hasCommTool) {
        const firstMissingTab = !hasProvider ? 'ai_provider' : 'comm_tool'
        modal.info({
          title: t('agents.configStepTitle'),
          content: (
            <div>
              <p style={{ marginTop: 0 }}>
                {t('agents.configStepContent')}
              </p>
              <ul style={{ paddingLeft: 20 }}>
                {!hasProvider && <li>{t('agents.configStepProvider')}</li>}
                {!hasCommTool && <li>{t('agents.configStepComm')}</li>}
              </ul>
            </div>
          ),
          okText: !hasProvider ? t('agents.goConfigProvider') : t('agents.goConfigComm'),
          onOk: () => setActiveTab(firstMissingTab)
        })
      }
    } else {
      modal.error({
        title: t('agents.startFailed'),
        width: 640,
        content: (
          <pre style={{ maxHeight: 360, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {result.error || t('agents.unknownError')}
          </pre>
        )
      })
    }
  }

  const handleStop = () => {
    modal.confirm({
      title: t('agents.confirmStop'),
      icon: <ExclamationCircleFilled />,
      content: t('agents.stopServiceContent'),
      okText: t('agents.confirmStopBtn'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        setStopping(true)
        const result = await stopServiceAction()
        setStopping(false)
        if (result.success) {
          message.success(t('agents.stopped'))
        } else {
          message.error(result.error || t('agents.stopFailed'))
        }
      }
    })
  }

  const handleRestart = () => {
    modal.confirm({
      title: t('agents.confirmRestart'),
      icon: <ExclamationCircleFilled />,
      content: t('agents.restartServiceContent'),
      okText: t('agents.confirmRestartBtn'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        setRestarting(true)
        await stopServiceAction()
        const result = await startServiceAction()
        setRestarting(false)
        if (result.success) {
          message.success(t('agents.restarted'))
        } else {
          message.error(result.error || t('agents.restartFailed'))
        }
      }
    })
  }

  const handleUninstallOpen = () => {
    const code = String(Math.floor(1000 + Math.random() * 9000))
    setUninstallCode(code)
    setUninstallInput('')
    setRemoveConfig(false)
    setUninstallOpen(true)
  }

  const handleUninstallConfirm = async () => {
    if (uninstallInput !== uninstallCode) return
    setUninstallOpen(false)
    const result = await uninstallAction(removeConfig)
    if (result.success) {
      message.success(t('agents.uninstalled'))
    } else {
      message.error(result.error || t('agents.uninstallFailed'))
    }
  }

  const handleSave = async () => {
    await saveConfigAction()
    message.success(t('agents.configSaved'))
  }

  const handleApply = async () => {
    const result = await applyConfigAction()
    if (result.success) {
      message.success(t('agents.configApplied'))
      // If feishu is enabled, prompt user to complete pairing
      const feishuEnabled = items.some((i) => i.id === 'feishu' && i.enabled)
      if (feishuEnabled) {
        setPairingCode('')
        setPairingOpen(true)
      }
    } else {
      message.error(result.error || t('agents.configApplyFailed'))
    }
  }

  const handlePairingConfirm = async () => {
    const code = pairingCode.trim().toUpperCase()
    if (!code) return
    setPairingLoading(true)
    const result = await pairingApproveAction('feishu', code)
    setPairingLoading(false)
    if (result.success) {
      setPairingOpen(false)
      message.success(t('agents.pairingSuccess'))
    } else {
      message.error(result.error || t('agents.pairingFailed'))
    }
  }

  const handleOpenPairing = () => {
    setPairingCode('')
    setPairingOpen(true)
  }

  const handleInstallSkill = async (id: string) => {
    setInstallingSkillId(id)
    const result = await installSkillAction(id)
    setInstallingSkillId(null)
    if (result.success) {
      message.success(t('agents.skillInstalled', id))
    } else {
      message.error(result.output || t('agents.skillInstallFailed'))
    }
  }

  const handleUpgrade = async () => {
    const result = await upgradeOpenClawAction()
    if (result.success) {
      message.success(t('agents.upgraded'))
    } else {
      message.error(result.error || t('agents.upgradeFailed'))
    }
  }

  // Not yet checked
  if (installCheck === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Spin size="large" />
      </div>
    )
  }

  // Not installed
  if (!installCheck.installed) {
    return <NotInstalledView />
  }

  const filterByCategory = (category: string) =>
    items.filter((item) => item.category === category)

  const renderGrid = (category: string, excludeIds?: string[]) => {
    const filtered = filterByCategory(category).filter(
      (item) => !excludeIds || !excludeIds.includes(item.id)
    )
    return (
      <Row gutter={[16, 16]} style={{ padding: '16px 0' }}>
        {filtered.map((item) => (
          <Col key={item.id} xs={24} sm={12} md={8} lg={6}>
            <OpenClawItemCard
              item={item}
              onToggle={updateItemEnabled}
              onConfigChange={updateItemConfigValue}
              onFeishuPairing={item.id === 'feishu' ? handleOpenPairing : undefined}
            />
          </Col>
        ))}
      </Row>
    )
  }

  const skillsTabContent = (
    <div>
      {/* Built-in skills */}
      <Divider orientation="left" plain>
        <Text type="secondary" style={{ fontSize: 12 }}>{t('agents.builtinSkills')}</Text>
      </Divider>
      {renderGrid('skill')}

      {/* Community skills */}
      <Divider orientation="left" plain>
        <span style={{ fontSize: 12, color: 'inherit' }}>
          {t('agents.communitySkills')}
          <LinkOutlined
            style={{ marginLeft: 6, cursor: 'pointer', opacity: 0.65 }}
            onClick={() => window.open('https://clawhub-skills.com/skills/')}
          />
        </span>
      </Divider>
      <Spin spinning={skillsLoading}>
        {communitySkills.length === 0 && !skillsLoading ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('agents.noCommunitySkills')}
          </Text>
        ) : (
          <Row gutter={[16, 16]} style={{ padding: '8px 0' }}>
            {communitySkills.map((skill) => (
              <Col key={skill.id} xs={24} sm={12} md={8} lg={6}>
                <CommunitySkillCard skill={skill} />
              </Col>
            ))}
          </Row>
        )}
      </Spin>
    </div>
  )

  const tabItems = [
    {
      key: 'ai_provider',
      label: (
        <span>
          <BrainIcon /> {t('agents.tabProvider')}
        </span>
      ),
      children: (
        <div>
          <div style={{ padding: '16px 0 0 0' }}>
            <ModelPriorityPanel modelPriority={modelPriority} items={items} onReorder={updateModelPriority} />
          </div>
          {renderGrid('ai_provider')}
        </div>
      )
    },
    {
      key: 'comm_tool',
      label: (
        <span>
          <MessageOutlined /> {t('agents.tabComm')}
        </span>
      ),
      children: renderGrid('comm_tool')
    },
    {
      key: 'skill',
      label: (
        <span>
          <ThunderboltOutlined /> {t('agents.tabSkill')}
        </span>
      ),
      children: skillsTabContent
    },
    {
      key: 'builtin_feature',
      label: (
        <span>
          <BuildOutlined /> {t('agents.tabBuiltin')}
        </span>
      ),
      // Exclude cron from built-in features grid — it has its own tab
      children: renderGrid('builtin_feature', ['cron'])
    },
    {
      key: 'cron',
      label: (
        <span>
          <ScheduleOutlined /> {t('agents.tabCron')}
        </span>
      ),
      children: <CronJobManager />
    }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Back button + Status bar */}
      <div style={{ padding: '16px 24px 0 24px' }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/ai-agents')}
          style={{ marginBottom: 12, paddingLeft: 0 }}
        >
          {t('agents.backToAgents')}
        </Button>
        <StatusBar
          status={serviceStatus}
          version={installCheck.version}
          latestVersion={latestVersion}
          onStart={handleStart}
          onStop={handleStop}
          onRestart={handleRestart}
          onUninstall={handleUninstallOpen}
          onUpgrade={handleUpgrade}
          starting={starting}
          stopping={stopping}
          restarting={restarting}
          upgrading={upgrading}
        />
      </div>

      {/* Tabs content area */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 24px' }}>
        <Spin spinning={configLoading}>
          <Tabs
            activeKey={activeTab}
            items={tabItems}
            onChange={(key) => {
              setActiveTab(key)
              if (key === 'skill' && communitySkills.length === 0) {
                fetchCommunitySkills()
              }
              if (key === 'cron') {
                fetchCronJobs()
              }
            }}
          />
        </Spin>
      </div>

      {/* Bottom bar */}
      <BottomBar
        dirty={dirty}
        saving={saving}
        applying={applying}
        onSave={handleSave}
        onApply={handleApply}
      />

      {/* Uninstall confirmation dialog */}
      <Modal
        title={
          <span style={{ color: token.colorError }}>
            <ExclamationCircleFilled style={{ marginRight: 8 }} />
            {t('agents.uninstallTitle')}
          </span>
        }
        open={uninstallOpen}
        onCancel={() => setUninstallOpen(false)}
        okText={t('agents.confirmUninstall')}
        okType="danger"
        okButtonProps={{
          disabled: uninstallInput !== uninstallCode,
          loading: uninstalling
        }}
        onOk={handleUninstallConfirm}
        cancelText={t('common.cancel')}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Text>
            {t('agents.uninstallDesc')}
          </Text>

          <Checkbox
            checked={removeConfig}
            onChange={(e) => setRemoveConfig(e.target.checked)}
          >
            {t('agents.uninstallRemoveConfig')}
          </Checkbox>

          <div>
            <Text strong style={{ color: token.colorError }}>
              {t('agents.uninstallInputHint', uninstallCode)}
            </Text>
            <Input
              style={{ marginTop: 8 }}
              placeholder={uninstallCode}
              value={uninstallInput}
              onChange={(e) => setUninstallInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
              maxLength={4}
              status={uninstallInput.length === 4 && uninstallInput !== uninstallCode ? 'error' : undefined}
            />
          </div>
        </div>
      </Modal>

      {/* Feishu pairing dialog */}
      <Modal
        title={
          <span>
            <ApiOutlined style={{ marginRight: 8 }} />
            {t('agents.pairingTitle')}
          </span>
        }
        open={pairingOpen}
        onCancel={() => setPairingOpen(false)}
        okText={t('agents.pairingConfirm')}
        okButtonProps={{
          disabled: !pairingCode.trim(),
          loading: pairingLoading
        }}
        onOk={handlePairingConfirm}
        cancelText={t('agents.pairingLater')}
        afterOpenChange={(open) => {
          if (open) pairingInputRef.current?.focus()
        }}
      >
        <Steps
          direction="vertical"
          size="small"
          style={{ marginBottom: 16 }}
          items={[
            {
              title: t('agents.pairingStep1'),
              description: t('agents.pairingStep1Desc'),
              status: 'process'
            },
            {
              title: t('agents.pairingStep2'),
              description: (
                <>
{t('agents.pairingStep2Desc')}
                </>
              ),
              status: 'wait'
            },
            {
              title: t('agents.pairingStep3'),
              description: t('agents.pairingStep3Desc'),
              status: 'wait'
            }
          ]}
        />
        <Input
          ref={pairingInputRef}
          placeholder={t('agents.pairingPlaceholder')}
          value={pairingCode}
          onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
          onPressEnter={handlePairingConfirm}
          allowClear
        />
      </Modal>
    </div>
  )
}

export default OpenClawPage
