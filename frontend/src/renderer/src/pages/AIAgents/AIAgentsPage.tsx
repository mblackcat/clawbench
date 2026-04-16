import React, { useEffect } from 'react'
import { Typography, Spin, App } from 'antd'
import { useOpenClawStore } from '../../stores/useOpenClawStore'
import OpenClawCard from './OpenClawCard'
import { useT } from '../../i18n'
import HermesCard from './HermesCard'
import { useHermesStore } from '../../stores/useHermesStore'

const { Title } = Typography

const AIAgentsPage: React.FC = () => {
  const { message, modal } = App.useApp()
  const t = useT()

  const installCheck = useOpenClawStore((s) => s.installCheck)
  const installing = useOpenClawStore((s) => s.installing)
  const nodes = useOpenClawStore((s) => s.nodes)
  const serviceStatus = useOpenClawStore((s) => s.serviceStatus)
  const checkInstalled = useOpenClawStore((s) => s.checkInstalled)
  const fetchStatus = useOpenClawStore((s) => s.fetchStatus)
  const fetchConfig = useOpenClawStore((s) => s.fetchConfig)
  const buildNodes = useOpenClawStore((s) => s.buildNodes)
  const installOpenClaw = useOpenClawStore((s) => s.installOpenClaw)
  const subscribeActivityState = useOpenClawStore((s) => s.subscribeActivityState)

  const hermesInstallCheck = useHermesStore((s) => s.installCheck)
  const hermesInstalling = useHermesStore((s) => s.installing)
  const hermesServiceStatus = useHermesStore((s) => s.serviceStatus)
  const checkHermesInstalled = useHermesStore((s) => s.checkInstalled)
  const fetchHermesStatus = useHermesStore((s) => s.fetchStatus)
  const installHermes = useHermesStore((s) => s.installHermes)

  useEffect(() => {
    checkInstalled()
  }, [])

  useEffect(() => {
    if (installCheck?.installed) {
      fetchStatus()
      fetchConfig()
    }
  }, [installCheck?.installed])

  // Build nodes whenever relevant data changes
  useEffect(() => {
    buildNodes()
  }, [installCheck, serviceStatus])

  useEffect(() => {
    checkHermesInstalled()
  }, [])

  useEffect(() => {
    if (hermesInstallCheck?.installed) {
      fetchHermesStatus()
    }
  }, [hermesInstallCheck?.installed])

  // Subscribe to activity state when service is running
  useEffect(() => {
    if (serviceStatus === 'running') {
      const unsub = subscribeActivityState()
      return unsub
    }
  }, [serviceStatus])

  const handleInstall = async () => {
    const result = await installOpenClaw()
    if (result.success) {
      message.success(t('agents.installSuccess'))
    } else {
      modal.error({
        title: t('agents.installFailed'),
        content: result.error || t('agents.installFailedContent'),
        okText: t('agents.gotIt'),
        width: 480
      })
    }
  }

  const handleInstallHermes = async () => {
    const result = await installHermes()
    if (result.success) {
      message.success(t('hermes.installSuccess'))
    } else {
      modal.error({
        title: t('hermes.installFailed'),
        content: result.error || t('hermes.installFailedContent'),
        okText: t('agents.gotIt'),
        width: 480
      })
    }
  }

  // Loading state
  if (installCheck === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
      <Title level={4} style={{ marginBottom: 24 }}>{t('agents.title')}</Title>

      <OpenClawCard
        isInstalled={installCheck.installed}
        installing={installing}
        nodes={nodes}
        onInstall={handleInstall}
      />

      {hermesInstallCheck !== null && (
        <HermesCard
          isInstalled={hermesInstallCheck.installed}
          installing={hermesInstalling}
          serviceStatus={hermesServiceStatus}
          onInstall={handleInstallHermes}
        />
      )}
    </div>
  )
}

export default AIAgentsPage
