import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Typography,
  Button,
  Steps,
  Switch,
  Card,
  Modal,
  Input,
  List,
  App,
  Space,
  theme
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  SettingOutlined,
  CheckCircleOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useWorkspaceStore } from '../../stores/useWorkspaceStore'
import {
  ROLE_MODULE_TEMPLATES,
  ROLE_LABELS,
  ROLE_LABELS_EN,
  SETTINGS_MODULE_CARDS,
  type SetupRole,
  type ModuleVisibility
} from '../../constants/module-visibility'
import { useT } from '../../i18n'
import appIcon from '../../../../../resources/icon.svg'

const { Title, Text, Paragraph } = Typography

// ─── Role selector ───────────────────────────────────────────────────────────

const roleOptions: SetupRole[] = ['general', 'design', 'tech', 'art']

const RoleSelector: React.FC<{
  value: SetupRole
  onChange: (role: SetupRole) => void
}> = ({ value, onChange }) => {
  const { token } = theme.useToken()
  const language = useSettingsStore((s) => s.language)

  const labels = language === 'en' ? ROLE_LABELS_EN : ROLE_LABELS

  return (
    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 24 }}>
      {roleOptions.map((role) => {
        const active = value === role
        return (
          <div
            key={role}
            onClick={() => onChange(role)}
            style={{
              width: 140,
              padding: '16px 12px',
              borderRadius: token.borderRadiusLG,
              border: `2px solid ${active ? token.colorPrimary : token.colorBorderSecondary}`,
              background: active ? token.colorPrimaryBg : token.colorBgContainer,
              cursor: 'pointer',
              textAlign: 'center',
              transition: 'all 0.2s',
              userSelect: 'none'
            }}
          >
            <div
              style={{
                fontSize: 28,
                marginBottom: 8,
                lineHeight: 1
              }}
            >
              {role === 'design' ? '🎨' : role === 'tech' ? '💻' : role === 'art' ? '✨' : '🛠️'}
            </div>
            <Text strong style={{ fontSize: 15, color: active ? token.colorPrimary : token.colorText }}>
              {labels[role]}
            </Text>
          </div>
        )
      })}
    </div>
  )
}

// ─── Module toggle cards ─────────────────────────────────────────────────────

const ModuleToggles: React.FC<{
  value: ModuleVisibility
  onChange: (v: ModuleVisibility) => void
}> = ({ value, onChange }) => {
  const { token } = theme.useToken()
  const t = useT()

  const handleToggle = (key: keyof ModuleVisibility) => {
    onChange({ ...value, [key]: !value[key] })
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: '100%',
        maxWidth: 600,
        margin: '0 auto',
        // Bound to the viewport so the list scrolls instead of pushing the
        // page past the footer when the window is short.
        maxHeight: 'calc(100vh - 560px)',
        minHeight: 160,
        overflowY: 'auto',
        paddingRight: 4,
        boxSizing: 'border-box'
      }}
    >
      {SETTINGS_MODULE_CARDS.map((mod) => (
        <Card
          key={mod.key}
          size="small"
          style={{
            borderRadius: token.borderRadiusLG,
            borderColor: value[mod.key] ? token.colorPrimaryBorder : token.colorBorderSecondary
          }}
          styles={{ body: { padding: '10px 14px' } }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <Text strong style={{ fontSize: 13 }}>{t(mod.titleKey)}</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 11 }}>{t(mod.descKey)}</Text>
            </div>
            <Switch
              size="small"
              checked={value[mod.key]}
              onChange={() => handleToggle(mod.key)}
            />
          </div>
        </Card>
      ))}
    </div>
  )
}

// ─── Step 1: Welcome + Role ──────────────────────────────────────────────────

const StepWelcome: React.FC<{
  role: SetupRole
  onRoleChange: (role: SetupRole) => void
  moduleVisibility: ModuleVisibility
  onModulesChange: (v: ModuleVisibility) => void
}> = ({ role, onRoleChange, moduleVisibility, onModulesChange }) => {
  const { token } = theme.useToken()
  const t = useT()

  const handleRoleChange = (newRole: SetupRole) => {
    onRoleChange(newRole)
    onModulesChange(ROLE_MODULE_TEMPLATES[newRole])
  }

  return (
    <div style={{ textAlign: 'center', maxWidth: 600, margin: '0 auto' }}>
      {/* Logo + tagline */}
      <div style={{ marginBottom: 32 }}>
        <img
          src={appIcon}
          alt="ClawBench"
          style={{ width: 72, height: 72, marginBottom: 16 }}
        />
        <Title level={2} style={{ marginBottom: 4 }}>{t('setup.welcomeTitle')}</Title>
        <Text type="secondary" style={{ fontSize: 15 }}>
          {t('setup.welcomeDesc')}
        </Text>
      </div>

      {/* Role selector */}
      <Text strong style={{ display: 'block', marginBottom: 12, fontSize: 14 }}>
        {t('setup.selectRole')}
      </Text>
      <RoleSelector value={role} onChange={handleRoleChange} />

      {/* Module toggles */}
      <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
        {t('setup.moduleHint')}
      </Text>
      <ModuleToggles value={moduleVisibility} onChange={onModulesChange} />
    </div>
  )
}

// ─── Step 2: Workspace ───────────────────────────────────────────────────────

const StepWorkspace: React.FC = () => {
  const { token } = theme.useToken()
  const t = useT()
  const { message } = App.useApp()
  const { workspaces, fetchWorkspaces, createWorkspace, deleteWorkspace } = useWorkspaceStore()
  const [modalOpen, setModalOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPath, setNewPath] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    fetchWorkspaces()
  }, [fetchWorkspaces])

  const handleSelectDir = useCallback(async () => {
    const dir = await window.api.dialog.selectDirectory()
    if (dir) setNewPath(dir)
  }, [])

  const handleAdd = useCallback(async () => {
    if (!newName.trim()) {
      message.warning(t('setup.wsNameRequired'))
      return
    }
    if (!newPath.trim()) {
      message.warning(t('setup.wsPathRequired'))
      return
    }
    setAdding(true)
    try {
      await createWorkspace(newName.trim(), newPath.trim())
      setNewName('')
      setNewPath('')
      setModalOpen(false)
    } catch {
      message.error(t('setup.wsAddFailed'))
    } finally {
      setAdding(false)
    }
  }, [newName, newPath, createWorkspace, message, t])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteWorkspace(id)
    } catch {
      message.error(t('setup.wsDeleteFailed'))
    }
  }, [deleteWorkspace, message, t])

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {/* Explanation */}
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ marginBottom: 8 }}>{t('setup.wsTitle')}</Title>
        <Paragraph type="secondary" style={{ fontSize: 14, marginBottom: 0 }}>
          {t('setup.wsDesc')}
        </Paragraph>
      </div>

      {/* Workspace list */}
      {workspaces.length > 0 && (
        <List
          style={{ marginBottom: 16 }}
          dataSource={workspaces}
          renderItem={(ws) => (
            <Card
              size="small"
              style={{ marginBottom: 8, borderRadius: token.borderRadiusLG }}
              styles={{ body: { padding: '10px 14px' } }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text strong style={{ fontSize: 13 }}>{ws.name}</Text>
                  <br />
                  <Text
                    type="secondary"
                    style={{ fontSize: 11, wordBreak: 'break-all' }}
                    ellipsis={{ tooltip: ws.path }}
                  >
                    {ws.path}
                  </Text>
                </div>
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(ws.id)}
                />
              </div>
            </Card>
          )}
        />
      )}

      {workspaces.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '32px 16px',
            border: `1px dashed ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
            marginBottom: 16
          }}
        >
          <FolderOpenOutlined style={{ fontSize: 32, color: token.colorTextQuaternary, marginBottom: 8 }} />
          <br />
          <Text type="secondary">{t('setup.wsEmpty')}</Text>
        </div>
      )}

      {/* Add button */}
      <Button
        type="dashed"
        icon={<PlusOutlined />}
        block
        onClick={() => setModalOpen(true)}
        style={{ height: 40 }}
      >
        {t('setup.wsAdd')}
      </Button>

      {/* Add modal */}
      <Modal
        title={t('setup.wsAddTitle')}
        open={modalOpen}
        onOk={handleAdd}
        onCancel={() => {
          setModalOpen(false)
          setNewName('')
          setNewPath('')
        }}
        confirmLoading={adding}
        okText={t('setup.wsAddOk')}
        cancelText={t('setup.wsAddCancel')}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <Text style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
              {t('setup.wsNameLabel')}
            </Text>
            <Input
              placeholder={t('setup.wsNamePlaceholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div>
            <Text style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
              {t('setup.wsPathLabel')}
            </Text>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder={t('setup.wsPathPlaceholder')}
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button icon={<FolderOpenOutlined />} onClick={handleSelectDir}>
                {t('setup.wsBrowse')}
              </Button>
            </Space.Compact>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─── Step 3: LLM reminder ────────────────────────────────────────────────────

const StepLLM: React.FC = () => {
  const { token } = theme.useToken()
  const t = useT()
  const navigate = useNavigate()

  return (
    <div style={{ textAlign: 'center', maxWidth: 500, margin: '0 auto' }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: token.colorPrimaryBg,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20
        }}
      >
        <SettingOutlined style={{ fontSize: 28, color: token.colorPrimary }} />
      </div>

      <Title level={4} style={{ marginBottom: 8 }}>{t('setup.llmTitle')}</Title>
      <Paragraph type="secondary" style={{ fontSize: 14, marginBottom: 0 }}>
        {t('setup.llmDesc')}
      </Paragraph>

      <div
        style={{
          marginTop: 24,
          padding: '14px 18px',
          borderRadius: token.borderRadiusLG,
          background: token.colorFillAlter,
          textAlign: 'left'
        }}
      >
        <Text style={{ fontSize: 13 }}>
          {t('setup.llmHint')}
        </Text>
      </div>

      <div style={{ marginTop: 32 }}>
        <Button
          type="default"
          onClick={() => navigate('/settings')}
          icon={<SettingOutlined />}
          style={{ marginRight: 12 }}
        >
          {t('setup.goSettings')}
        </Button>
      </div>
    </div>
  )
}

// ─── Main Setup Wizard ───────────────────────────────────────────────────────

const SetupWizard: React.FC = () => {
  const [step, setStep] = useState(0)
  const [role, setRole] = useState<SetupRole>('general')
  const [modules, setModules] = useState<ModuleVisibility>(
    () => ROLE_MODULE_TEMPLATES.general
  )

  const { token } = theme.useToken()
  const t = useT()
  const { message } = App.useApp()
  const navigate = useNavigate()

  const { updateSetting, completeSetup, hasCompletedSetup } = useSettingsStore()
  const settingsLoaded = useSettingsStore((s) => !s.loading)

  // Redirect if already completed setup
  useEffect(() => {
    if (settingsLoaded && hasCompletedSetup) {
      navigate('/ai-chat', { replace: true })
    }
  }, [settingsLoaded, hasCompletedSetup, navigate])

  const handleFinish = useCallback(async () => {
    try {
      // Save module visibility
      await updateSetting('moduleVisibility', modules)
      // Mark setup as complete
      await completeSetup()
      message.success(t('setup.success'))
      // Navigate to main app
      navigate('/ai-chat', { replace: true })
    } catch {
      message.error(t('setup.saveFailed'))
    }
  }, [modules, updateSetting, completeSetup, navigate, message, t])

  const stepItems = useMemo(
    () => [
      { title: t('setup.stepRole') },
      { title: t('setup.stepWorkspace') },
      { title: t('setup.stepLLM') }
    ],
    [t]
  )

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: token.colorBgLayout
      }}
    >
      {/* Header with steps */}
      <div
        style={{
          padding: '28px 32px 0',
          display: 'flex',
          justifyContent: 'center'
        }}
      >
        <Steps
          current={step}
          items={stepItems}
          style={{ maxWidth: 480, width: '100%' }}
          size="small"
        />
      </div>

      {/* Step content */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 32px' }}>
        <div style={{ width: '100%', maxWidth: 640 }}>
          {step === 0 && (
            <StepWelcome
              role={role}
              onRoleChange={setRole}
              moduleVisibility={modules}
              onModulesChange={setModules}
            />
          )}
          {step === 1 && <StepWorkspace />}
          {step === 2 && <StepLLM />}
        </div>
      </div>

      {/* Bottom navigation */}
      <div
        style={{
          padding: '16px 32px 24px',
          display: 'flex',
          justifyContent: 'center',
          gap: 12,
          borderTop: `1px solid ${token.colorBorderSecondary}`
        }}
      >
        {step > 0 && (
          <Button onClick={() => setStep((s) => s - 1)}>
            {t('setup.prev')}
          </Button>
        )}
        {step < 2 ? (
          <Button type="primary" onClick={() => setStep((s) => s + 1)}>
            {t('setup.next')}
          </Button>
        ) : (
          <Button type="primary" onClick={handleFinish} icon={<CheckCircleOutlined />}>
            {t('setup.finish')}
          </Button>
        )}
      </div>
    </div>
  )
}

export default SetupWizard
