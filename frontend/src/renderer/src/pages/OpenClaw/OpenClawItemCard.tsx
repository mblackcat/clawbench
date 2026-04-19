import React, { useState } from 'react'
import { Switch, Input, Tooltip, Avatar, Select, theme, Typography, Button, Space, Modal, Steps, Alert } from 'antd'
import { LinkOutlined, BookOutlined, QuestionCircleOutlined, ApiOutlined, GoogleOutlined, CheckCircleOutlined, LoadingOutlined, DownOutlined, UpOutlined } from '@ant-design/icons'
import type { OpenClawItem } from '../../types/openclaw'
import FeishuGuideModal from '../../components/FeishuGuideModal'
import { useOpenClawStore } from '../../stores/useOpenClawStore'
import { useT } from '../../i18n'
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
  const [expanded, setExpanded] = useState(false)
  const [feishuGuideOpen, setFeishuGuideOpen] = useState(false)
  const [oauthModalOpen, setOauthModalOpen] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [oauthStep, setOauthStep] = useState(0)
  const [oauthError, setOauthError] = useState('')
  const startGoogleOAuth = useOpenClawStore((s) => s.startGoogleOAuth)

  // Translate item description, name, and field labels from main process defaults
  const itemDesc = t(`openclaw.desc.${item.id}`) !== `openclaw.desc.${item.id}` ? t(`openclaw.desc.${item.id}`) : item.description
  const itemName = t(`openclaw.name.${item.id}`) !== `openclaw.name.${item.id}` ? t(`openclaw.name.${item.id}`) : item.name
  const fieldLabel = (field: { key: string; label: string }) => {
    const k = field.key === 'provider' ? 'ttsProvider' : field.key
    const tk = `openclaw.field.${k}`
    return t(tk) !== tk ? t(tk) : field.label
  }
  const fieldPlaceholder = (field: { key: string; placeholder?: string }) => {
    if (field.key === 'models') {
      const tk = item.id === 'custom' ? 'openclaw.field.modelsPlaceholderCustom' : 'openclaw.field.modelsPlaceholder'
      return t(tk) !== tk ? t(tk) : field.placeholder
    }
    if (field.key === 'oauthEmail') {
      const tk = 'openclaw.field.oauthPlaceholder'
      return t(tk) !== tk ? t(tk) : field.placeholder
    }
    return field.placeholder
  }
  const selectOptionLabel = (field: { key: string }, opt: { label: string; value: string }) => {
    if (field.key === 'authMode' && opt.value === 'oauth') return t('openclaw.field.authOAuth') !== 'openclaw.field.authOAuth' ? t('openclaw.field.authOAuth') : opt.label
    if (field.key === 'provider' && opt.value === 'edge') return t('openclaw.field.edgeFree') !== 'openclaw.field.edgeFree' ? t('openclaw.field.edgeFree') : opt.label
    if (field.key === 'apiKey' && item.id === 'google-gemini-cli') return t('openclaw.field.apiKeyOnlyApiKey') !== 'openclaw.field.apiKeyOnlyApiKey' ? t('openclaw.field.apiKeyOnlyApiKey') : opt.label
    return opt.label
  }

  const isGoogleCli = item.id === 'google-gemini-cli'
  const authMode = isGoogleCli ? (item.configValues.authMode || 'oauth') : null
  const hasLinks = item.docsUrl || item.openclawDocsUrl || item.id === 'feishu'
  const hasContent = item.configFields.length > 0 || hasLinks || item.description

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

  return (
    <div className="cb-glass-card">
      <div style={{ padding: '8px 12px' }}>
        {/* Header row: Icon + Name + Expand + Switch */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {hasProviderIcon(item.id) ? (
            (() => {
              const ProviderIconComp = getProviderIcon(item.id)
              return (
                <div style={{
                  width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                  background: item.enabled ? token.colorFillTertiary : token.colorFillQuaternary,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.2s'
                }}>
                  <ProviderIconComp style={{ width: 15, height: 15, display: 'block', objectFit: 'contain' }} />
                </div>
              )
            })()
          ) : (
            <Avatar
              size={24}
              style={{
                backgroundColor: item.enabled ? token.colorPrimary : token.colorTextDisabled,
                flexShrink: 0,
                fontSize: 11
              }}
            >
              {item.icon || itemName[0]}
            </Avatar>
          )}
          <Text
            strong
            style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}
          >
            {itemName}
          </Text>
          {hasContent && (
            <Button
              type="text"
              size="small"
              icon={expanded ? <UpOutlined style={{ fontSize: 10 }} /> : <DownOutlined style={{ fontSize: 10 }} />}
              onClick={() => setExpanded((v) => !v)}
              style={{ padding: '0 4px', height: 20, flexShrink: 0, color: token.colorTextTertiary }}
            />
          )}
          <Switch
            size="small"
            checked={item.enabled}
            onChange={(checked) => onToggle(item.id, checked)}
          />
        </div>

        {/* Expanded content */}
        {expanded && (
          <div style={{ marginTop: 8 }}>
            {/* Description */}
            {itemDesc && (
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
                    marginBottom: hasLinks || item.configFields.length > 0 ? 8 : 0
                  }}
                >
                  {itemDesc}
                </Text>
              </Tooltip>
            )}

            {/* Doc links */}
            {hasLinks && (
              <Space size={4} wrap style={{ marginBottom: item.configFields.length > 0 ? 8 : 0 }}>
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
              </Space>
            )}

            {/* Config fields */}
            {item.configFields.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {item.configFields.filter((f) => shouldShowField(f.key)).map((field) => (
                  <div key={field.key}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>
                      {fieldLabel(field)}
                      {field.required && <span style={{ color: token.colorError }}> *</span>}
                    </Text>
                    {field.type === 'model-tags' ? (
                      <Select
                        mode="tags"
                        size="small"
                        style={{ width: '100%' }}
                        disabled={!item.enabled}
                        value={
                          item.configValues[field.key]
                            ? item.configValues[field.key].split(',').map((m) => m.trim()).filter(Boolean)
                            : []
                        }
                        placeholder={fieldPlaceholder(field)}
                        options={field.options?.map((o) => ({ ...o, label: selectOptionLabel(field, o) }))}
                        tokenSeparators={[',']}
                        onChange={(values: string[]) => onConfigChange(item.id, field.key, values.join(','))}
                      />
                    ) : field.type === 'select' ? (
                      <Select
                        size="small"
                        style={{ width: '100%' }}
                        disabled={!item.enabled}
                        value={item.configValues[field.key] || undefined}
                        placeholder={fieldPlaceholder(field)}
                        options={field.options?.map((o) => ({ ...o, label: selectOptionLabel(field, o) }))}
                        onChange={(val) => onConfigChange(item.id, field.key, val)}
                      />
                    ) : field.key === 'oauthEmail' ? (
                      <Input
                        size="small"
                        disabled
                        value={item.configValues[field.key] || ''}
                        placeholder={fieldPlaceholder(field)}
                        suffix={item.configValues[field.key] ? <CheckCircleOutlined style={{ color: token.colorSuccess }} /> : undefined}
                      />
                    ) : (
                      <Input
                        size="small"
                        type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                        disabled={!item.enabled}
                        value={item.configValues[field.key] || ''}
                        placeholder={fieldPlaceholder(field) || field.defaultValue}
                        onChange={(e) => onConfigChange(item.id, field.key, e.target.value)}
                      />
                    )}
                  </div>
                ))}

                {/* Google OAuth login button */}
                {isGoogleCli && authMode === 'oauth' && (
                  <Button
                    size="small"
                    icon={oauthLoading ? <LoadingOutlined /> : <GoogleOutlined />}
                    disabled={!item.enabled}
                    onClick={() => { setOauthModalOpen(true); setOauthStep(0); setOauthError('') }}
                    style={{ marginTop: 2 }}
                  >
                    {item.configValues.oauthEmail ? t('agents.reauthorizeGoogle') : t('agents.authorizeGoogle')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {item.id === 'feishu' && (
        <FeishuGuideModal open={feishuGuideOpen} onCancel={() => setFeishuGuideOpen(false)} />
      )}

      {/* Google OAuth modal */}
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
