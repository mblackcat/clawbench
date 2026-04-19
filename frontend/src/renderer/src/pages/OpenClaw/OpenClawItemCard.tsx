import React, { useState } from 'react'
import { Tooltip, theme, Typography, Button, Modal, Steps, Alert } from 'antd'
import { LinkOutlined, BookOutlined, QuestionCircleOutlined, ApiOutlined, GoogleOutlined, CheckCircleOutlined, LoadingOutlined } from '@ant-design/icons'
import type { OpenClawItem } from '../../types/openclaw'
import FeishuGuideModal from '../../components/FeishuGuideModal'
import { useOpenClawStore } from '../../stores/useOpenClawStore'
import { useT } from '../../i18n'
import AgentConfigCard from '../../components/AgentConfigCard'
import AgentConfigFields, { type AgentConfigField } from '../../components/AgentConfigFields'
import { getProviderIcon, hasProviderIcon } from '../../components/ProviderIcons'

const { Text } = Typography

interface OpenClawItemCardProps {
  item: OpenClawItem
  onToggle: (id: string, enabled: boolean) => void
  onConfigChange: (id: string, key: string, value: string) => void
  onFeishuPairing?: () => void
}

const OpenClawItemCard: React.FC<OpenClawItemCardProps> = ({ item, onToggle, onConfigChange, onFeishuPairing }) => {
  const { token } = theme.useToken()
  const t = useT()
  const [feishuGuideOpen, setFeishuGuideOpen] = useState(false)
  const [oauthModalOpen, setOauthModalOpen] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [oauthStep, setOauthStep] = useState(0)
  const [oauthError, setOauthError] = useState('')
  const startGoogleOAuth = useOpenClawStore((s) => s.startGoogleOAuth)

  const itemDesc = t(`openclaw.desc.${item.id}`) !== `openclaw.desc.${item.id}` ? t(`openclaw.desc.${item.id}`) : item.description
  const itemName = t(`openclaw.name.${item.id}`) !== `openclaw.name.${item.id}` ? t(`openclaw.name.${item.id}`) : item.name
  const fieldLabel = (field: { key: string; label: string }) => {
    const key = field.key === 'provider' ? 'ttsProvider' : field.key
    const translationKey = `openclaw.field.${key}`
    return t(translationKey) !== translationKey ? t(translationKey) : field.label
  }
  const fieldPlaceholder = (field: { key: string; placeholder?: string; defaultValue?: string }) => {
    if (field.key === 'models') {
      const translationKey = item.id === 'custom' ? 'openclaw.field.modelsPlaceholderCustom' : 'openclaw.field.modelsPlaceholder'
      return t(translationKey) !== translationKey ? t(translationKey) : field.placeholder
    }
    if (field.key === 'oauthEmail') {
      const translationKey = 'openclaw.field.oauthPlaceholder'
      return t(translationKey) !== translationKey ? t(translationKey) : field.placeholder
    }
    return field.placeholder || field.defaultValue || ''
  }
  const selectOptionLabel = (field: { key: string }, option: { label: string; value: string }) => {
    if (field.key === 'authMode' && option.value === 'oauth') return t('openclaw.field.authOAuth') !== 'openclaw.field.authOAuth' ? t('openclaw.field.authOAuth') : option.label
    if (field.key === 'provider' && option.value === 'edge') return t('openclaw.field.edgeFree') !== 'openclaw.field.edgeFree' ? t('openclaw.field.edgeFree') : option.label
    if (field.key === 'apiKey' && item.id === 'google-gemini-cli') return t('openclaw.field.apiKeyOnlyApiKey') !== 'openclaw.field.apiKeyOnlyApiKey' ? t('openclaw.field.apiKeyOnlyApiKey') : option.label
    return option.label
  }

  const isGoogleCli = item.id === 'google-gemini-cli'
  const authMode = isGoogleCli ? (item.configValues.authMode || 'oauth') : null
  const hasLinks = item.docsUrl || item.openclawDocsUrl || item.id === 'feishu'

  const handleGoogleOAuth = async () => {
    setOauthStep(1)
    setOauthError('')
    setOauthLoading(true)
    const result = await startGoogleOAuth()
    setOauthLoading(false)
    if (result.success || result.url) {
      setOauthStep(2)
    } else {
      setOauthError(result.error || t('agents.oauthFailed'))
      setOauthStep(0)
    }
  }

  const handleOauthModalClose = () => {
    setOauthModalOpen(false)
    setOauthStep(0)
    setOauthError('')
    setOauthLoading(false)
  }

  const shouldShowField = (fieldKey: string): boolean => {
    if (!isGoogleCli) return true
    if (fieldKey === 'apiKey') return authMode === 'api_key'
    if (fieldKey === 'oauthEmail') return authMode === 'oauth'
    return true
  }

  const iconNode = hasProviderIcon(item.id)
    ? (() => {
        const ProviderIconComp = getProviderIcon(item.id)
        return <ProviderIconComp style={{ width: 15, height: 15, display: 'block', objectFit: 'contain' }} />
      })()
    : <span>{item.icon || itemName[0]}</span>

  const iconBackground = hasProviderIcon(item.id)
    ? (item.enabled ? token.colorFillTertiary : token.colorFillQuaternary)
    : (item.enabled ? token.colorPrimary : token.colorTextDisabled)

  const actions = (
    <>
      {item.docsUrl && (
        <Button
          type="link"
          size="small"
          icon={<LinkOutlined />}
          href={item.docsUrl}
          target="_blank"
          style={{ padding: '0 4px', fontSize: 11, height: 20 }}
        >
          {t('agents.officialSite')}
        </Button>
      )}
      {item.openclawDocsUrl && (
        <Button
          type="link"
          size="small"
          icon={<BookOutlined />}
          href={item.openclawDocsUrl}
          target="_blank"
          style={{ padding: '0 4px', fontSize: 11, height: 20 }}
        >
          {t('agents.openclawGuide')}
        </Button>
      )}
      {item.id === 'feishu' && (
        <Button
          type="link"
          size="small"
          icon={<QuestionCircleOutlined />}
          onClick={() => setFeishuGuideOpen(true)}
          style={{ padding: '0 4px', fontSize: 11, height: 20 }}
        >
          {t('agents.configGuide')}
        </Button>
      )}
      {item.id === 'feishu' && (
        <Button
          type="link"
          size="small"
          icon={<ApiOutlined />}
          onClick={onFeishuPairing}
          style={{ padding: '0 4px', fontSize: 11, height: 20 }}
        >
          {t('agents.pairing')}
        </Button>
      )}
    </>
  )

  const fields: AgentConfigField[] = item.configFields
    .filter((field) => shouldShowField(field.key))
    .map((field) => ({
      key: field.key,
      label: fieldLabel(field),
      type: field.type,
      placeholder: fieldPlaceholder(field),
      options: field.options?.map((option) => ({ ...option, label: selectOptionLabel(field, option) })),
      value: field.type === 'model-tags'
        ? (item.configValues[field.key] ? item.configValues[field.key].split(',').map((value) => value.trim()).filter(Boolean) : [])
        : (item.configValues[field.key] || ''),
      disabled: field.key === 'oauthEmail' ? true : !item.enabled,
      required: field.required,
      onChange: (value) => {
        if (Array.isArray(value)) {
          onConfigChange(item.id, field.key, value.join(','))
          return
        }
        onConfigChange(item.id, field.key, String(value))
      },
      extra: field.key === 'oauthEmail' && item.configValues[field.key]
        ? <CheckCircleOutlined style={{ color: token.colorSuccess }} />
        : undefined,
    }))

  const footerNote = isGoogleCli && authMode === 'oauth' ? (
    <Button
      size="small"
      icon={oauthLoading ? <LoadingOutlined /> : <GoogleOutlined />}
      disabled={!item.enabled}
      onClick={() => {
        setOauthModalOpen(true)
        setOauthStep(0)
        setOauthError('')
      }}
      style={{ marginTop: 2 }}
    >
      {item.configValues.oauthEmail ? t('agents.reauthorizeGoogle') : t('agents.authorizeGoogle')}
    </Button>
  ) : undefined

  return (
    <div>
      <AgentConfigCard
        icon={iconNode}
        iconBackground={iconBackground}
        title={itemName}
        description={itemDesc ? (
          <Tooltip title={itemDesc}>
            <Text
              type="secondary"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                fontSize: 12,
                lineHeight: '18px',
              }}
            >
              {itemDesc}
            </Text>
          </Tooltip>
        ) : undefined}
        enabled={item.enabled}
        onToggle={(checked) => onToggle(item.id, checked)}
        actions={hasLinks ? actions : undefined}
        fields={<AgentConfigFields fields={fields} />}
        footerNote={footerNote}
      />

      {item.id === 'feishu' && (
        <FeishuGuideModal open={feishuGuideOpen} onCancel={() => setFeishuGuideOpen(false)} />
      )}

      <Modal
        title={
          <span>
            <GoogleOutlined style={{ marginRight: 8 }} />
            {t('agents.oauthTitle')}
          </span>
        }
        open={oauthModalOpen}
        onCancel={handleOauthModalClose}
        footer={
          oauthStep === 0 ? [
            <Button key="cancel" onClick={handleOauthModalClose}>{t('common.cancel')}</Button>,
            <Button key="start" type="primary" loading={oauthLoading} onClick={handleGoogleOAuth}>
              {t('agents.oauthOpenBrowser')}
            </Button>
          ] : oauthStep === 2 ? [
            <Button key="done" type="primary" onClick={handleOauthModalClose}>{t('agents.oauthDone')}</Button>
          ] : [
            <Button key="cancel" onClick={handleOauthModalClose} disabled={oauthLoading}>{t('common.cancel')}</Button>
          ]
        }
        width={520}
      >
        <Steps
          direction="vertical"
          size="small"
          current={oauthStep}
          style={{ marginBottom: 16 }}
          items={[
            {
              title: t('agents.oauthStep1'),
              description: t('agents.oauthStep1Desc'),
              icon: oauthStep > 0 ? <CheckCircleOutlined /> : undefined
            },
            {
              title: t('agents.oauthStep2'),
              description: (
                <>
                  <div>{t('agents.oauthStep2Desc')}</div>
                  <div style={{ marginTop: 4, color: token.colorTextSecondary, fontSize: 12 }}>
                    {t('agents.oauthStep2WinNote')}
                  </div>
                </>
              ),
              icon: oauthLoading ? <LoadingOutlined /> : oauthStep > 1 ? <CheckCircleOutlined /> : undefined
            },
            {
              title: t('agents.oauthStep3'),
              description: t('agents.oauthStep3Desc'),
              icon: oauthStep === 2 ? <CheckCircleOutlined /> : undefined
            }
          ]}
        />
        {oauthError && <Alert type="error" message={oauthError} style={{ marginTop: 8 }} />}
        {oauthStep === 2 && <Alert type="success" message={t('agents.oauthSuccess')} style={{ marginTop: 8 }} />}
      </Modal>
    </div>
  )
}

export default OpenClawItemCard
