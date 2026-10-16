import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Typography,
  Button,
  Steps,
  Switch,
  Card,
  List,
  App,
  Spin,
  Tag,
  theme
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  SettingOutlined,
  CheckCircleOutlined,
  AppstoreOutlined,
  CodeOutlined,
  ProjectOutlined,
  ReloadOutlined,
  TeamOutlined
} from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import { useSettingsStore, type AppMode } from '../../stores/useSettingsStore'
import { useWorkspaceStore } from '../../stores/useWorkspaceStore'
import { useAuthStore } from '../../stores/useAuthStore'
import { apiClient } from '../../services/apiClient'
import type { Project } from '../../types/api'
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
        maxHeight: 'calc(100vh - 440px)',
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

// ─── Step 1: Welcome + Mode (通用 / 研发) ─────────────────────────────────────

const StepMode: React.FC<{
  mode: AppMode
  onModeChange: (mode: AppMode) => void
}> = ({ mode, onModeChange }) => {
  const { token } = theme.useToken()
  const t = useT()

  const options: { key: AppMode; icon: React.ReactNode; title: string; desc: string }[] = [
    {
      key: 'general',
      icon: <AppstoreOutlined style={{ fontSize: 28 }} />,
      title: t('topbar.modeGeneral'),
      desc: t('setup.modeGeneralDesc')
    },
    {
      key: 'pro',
      icon: <CodeOutlined style={{ fontSize: 28 }} />,
      title: t('topbar.modePro'),
      desc: t('setup.modeProDesc')
    }
  ]

  return (
    <div style={{ textAlign: 'center', maxWidth: 560, margin: '0 auto' }}>
      <div style={{ marginBottom: 32 }}>
        <img src={appIcon} alt="ClawBench" style={{ width: 72, height: 72, marginBottom: 16 }} />
        <Title level={2} style={{ marginBottom: 4 }}>{t('setup.welcomeTitle')}</Title>
        <Text type="secondary" style={{ fontSize: 15 }}>{t('setup.welcomeDesc')}</Text>
      </div>

      <Text strong style={{ display: 'block', marginBottom: 16, fontSize: 14 }}>
        {t('setup.selectMode')}
      </Text>

      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
        {options.map((opt) => {
          const active = mode === opt.key
          return (
            <div
              key={opt.key}
              role="button"
              tabIndex={0}
              onClick={() => onModeChange(opt.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onModeChange(opt.key)
              }}
              style={{
                width: 220,
                padding: '24px 18px',
                borderRadius: token.borderRadiusLG,
                border: `2px solid ${active ? token.colorPrimary : token.colorBorderSecondary}`,
                background: active ? token.colorPrimaryBg : token.colorBgContainer,
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all 0.2s',
                userSelect: 'none'
              }}
            >
              <div style={{ color: active ? token.colorPrimary : token.colorTextSecondary, marginBottom: 12 }}>
                {opt.icon}
              </div>
              <Text
                strong
                style={{
                  fontSize: 16,
                  display: 'block',
                  marginBottom: 8,
                  color: active ? token.colorPrimary : token.colorText
                }}
              >
                {opt.title}
              </Text>
              <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>{opt.desc}</Text>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Step 2: Role + modules ──────────────────────────────────────────────────

const StepRole: React.FC<{
  role: SetupRole
  onRoleChange: (role: SetupRole) => void
  moduleVisibility: ModuleVisibility
  onModulesChange: (v: ModuleVisibility) => void
}> = ({ role, onRoleChange, moduleVisibility, onModulesChange }) => {
  const t = useT()

  const handleRoleChange = (newRole: SetupRole) => {
    onRoleChange(newRole)
    onModulesChange(ROLE_MODULE_TEMPLATES[newRole])
  }

  return (
    <div style={{ textAlign: 'center', maxWidth: 600, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 16 }}>{t('setup.selectRole')}</Title>
      <RoleSelector value={role} onChange={handleRoleChange} />

      <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
        {t('setup.moduleHint')}
      </Text>
      <ModuleToggles value={moduleVisibility} onChange={onModulesChange} />
    </div>
  )
}

// ─── Step 3: Project (from server) ───────────────────────────────────────────

const StepProject: React.FC<{
  projects: Project[]
  loading: boolean
  loadError: boolean
  isLocalMode: boolean
  selectedProjectId: string | null
  onSelect: (projectId: string) => void
  onRetry: () => void
}> = ({ projects, loading, loadError, isLocalMode, selectedProjectId, onSelect, onRetry }) => {
  const { token } = theme.useToken()
  const t = useT()

  const placeholder = (content: React.ReactNode): React.ReactNode => (
    <div
      style={{
        textAlign: 'center',
        padding: '32px 16px',
        border: `1px dashed ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG
      }}
    >
      {content}
    </div>
  )

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ marginBottom: 8 }}>{t('setup.projectTitle')}</Title>
        <Paragraph type="secondary" style={{ fontSize: 14, marginBottom: 0 }}>
          {t('setup.projectDesc')}
        </Paragraph>
      </div>

      {isLocalMode ? (
        placeholder(
          <>
            <ProjectOutlined style={{ fontSize: 32, color: token.colorTextQuaternary, marginBottom: 8 }} />
            <br />
            <Text type="secondary">{t('setup.projectLocalMode')}</Text>
          </>
        )
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <Spin />
        </div>
      ) : loadError ? (
        placeholder(
          <>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              {t('setup.projectLoadFailed')}
            </Text>
            <Button icon={<ReloadOutlined />} onClick={onRetry}>{t('setup.projectRetry')}</Button>
          </>
        )
      ) : projects.length === 0 ? (
        placeholder(
          <>
            <ProjectOutlined style={{ fontSize: 32, color: token.colorTextQuaternary, marginBottom: 8 }} />
            <br />
            <Text type="secondary">{t('setup.projectEmpty')}</Text>
          </>
        )
      ) : (
        <List
          dataSource={projects}
          style={{ maxHeight: 320, overflowY: 'auto' }}
          renderItem={(project) => {
            const active = selectedProjectId === project.projectId
            return (
              <Card
                size="small"
                onClick={() => onSelect(project.projectId)}
                style={{
                  marginBottom: 8,
                  cursor: 'pointer',
                  borderRadius: token.borderRadiusLG,
                  borderWidth: 2,
                  borderColor: active ? token.colorPrimary : token.colorBorderSecondary,
                  background: active ? token.colorPrimaryBg : token.colorBgContainer,
                  transition: 'all 0.2s'
                }}
                styles={{ body: { padding: '10px 14px' } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ProjectOutlined
                    style={{ fontSize: 20, color: active ? token.colorPrimary : token.colorTextSecondary }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Text strong style={{ fontSize: 13 }}>{project.name}</Text>
                      {project.vcsType !== 'none' && (
                        <Tag style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '16px' }}>
                          {project.vcsType.toUpperCase()}
                        </Tag>
                      )}
                    </div>
                    {project.description && (
                      <Text
                        type="secondary"
                        style={{ fontSize: 11, display: 'block' }}
                        ellipsis={{ tooltip: project.description }}
                      >
                        {project.description}
                      </Text>
                    )}
                  </div>
                  <Text type="secondary" style={{ fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap' }}>
                    <TeamOutlined style={{ marginRight: 4 }} />
                    {t('setup.projectMembers', String(project.memberCount ?? 0))}
                  </Text>
                </div>
              </Card>
            )
          }}
        />
      )}
    </div>
  )
}

/** Last path segment as the default workspace name (Windows / POSIX). */
function basenameFromPath(dir: string): string {
  const normalized = dir.replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || dir
}

// ─── Step 4: Workspace / local directory (at least one required) ─────────────

const StepWorkspace: React.FC<{ mode: AppMode }> = ({ mode }) => {
  const { token } = theme.useToken()
  const t = useT()
  const { message } = App.useApp()
  const { workspaces, activeWorkspace, fetchWorkspaces, createWorkspace, deleteWorkspace, setActiveWorkspace } =
    useWorkspaceStore()
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  const [adding, setAdding] = useState(false)
  const isGeneral = mode === 'general'
  const [seeding, setSeeding] = useState(isGeneral)

  /** General mode: the user-apps root follows the default local directory. */
  const syncUserAppDir = useCallback(
    async (dirPath: string) => {
      if (!isGeneral || !dirPath) return
      try {
        await updateSetting('userAppDir', dirPath)
      } catch {
        // Non-fatal here; finish() re-applies from the active workspace
      }
    },
    [isGeneral, updateSetting]
  )

  useEffect(() => {
    let cancelled = false
    const bootstrap = async (): Promise<void> => {
      await fetchWorkspaces()
      if (cancelled) return
      if (!isGeneral) {
        setSeeding(false)
        return
      }
      const existing = useWorkspaceStore.getState().workspaces
      if (existing.length > 0) {
        const active = useWorkspaceStore.getState().activeWorkspace
        if (active?.path) await syncUserAppDir(active.path)
        if (!cancelled) setSeeding(false)
        return
      }
      // General mode with no workspace: seed the default user-apps directory as
      // an editable / removable default entry.
      try {
        const dir = useSettingsStore.getState().userAppDir
        if (dir) {
          try {
            await createWorkspace(basenameFromPath(dir), dir)
          } catch {
            // StrictMode re-entry may race on the same path — just reload
            await fetchWorkspaces()
          }
        }
      } catch (err) {
        console.warn('Failed to seed default general workspace:', err)
      } finally {
        if (!cancelled) setSeeding(false)
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [isGeneral, fetchWorkspaces, createWorkspace, syncUserAppDir])

  /** Pick a folder; the name defaults to its last path segment. */
  const handleAdd = useCallback(async () => {
    const dir = await window.api.dialog.selectDirectory()
    if (!dir) return
    setAdding(true)
    try {
      // The first workspace is auto-activated inside createWorkspace
      const ws = await createWorkspace(basenameFromPath(dir), dir)
      const active = useWorkspaceStore.getState().activeWorkspace
      await syncUserAppDir(active?.path ?? ws.path)
    } catch {
      message.error(t('setup.wsAddFailed'))
    } finally {
      setAdding(false)
    }
  }, [createWorkspace, message, t, syncUserAppDir])

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const wasDefault = useWorkspaceStore.getState().activeWorkspace?.id === id
        await deleteWorkspace(id)
        // Deleting the default promotes the first remaining entry
        if (wasDefault) {
          const rest = useWorkspaceStore.getState().workspaces
          if (rest.length > 0) {
            await setActiveWorkspace(rest[0].id)
            await syncUserAppDir(rest[0].path)
          }
        }
      } catch {
        message.error(t('setup.wsDeleteFailed'))
      }
    },
    [deleteWorkspace, setActiveWorkspace, message, t, syncUserAppDir]
  )

  const handleSetDefault = useCallback(
    async (id: string) => {
      try {
        await setActiveWorkspace(id)
        const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === id)
        if (ws) await syncUserAppDir(ws.path)
      } catch {
        message.error(t('setup.wsSetDefaultFailed'))
      }
    },
    [setActiveWorkspace, message, t, syncUserAppDir]
  )

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ marginBottom: 8 }}>
          {t(isGeneral ? 'setup.wsTitleGeneral' : 'setup.wsTitle')}
        </Title>
        <Paragraph type="secondary" style={{ fontSize: 14, marginBottom: 8 }}>
          {t(isGeneral ? 'setup.wsDescGeneral' : 'setup.wsDesc')}
        </Paragraph>
        {workspaces.length === 0 && !seeding && (
          <Text type="danger" style={{ fontSize: 13 }}>{t('setup.wsRequired')}</Text>
        )}
      </div>

      {seeding ? (
        <div style={{ textAlign: 'center', padding: '48px 16px' }}>
          <Spin />
        </div>
      ) : (
        <>
          {workspaces.length > 0 && (
            <List
              style={{ marginBottom: 16 }}
              dataSource={workspaces}
              renderItem={(ws) => {
                const isDefault = activeWorkspace?.id === ws.id
                return (
                  <Card
                    size="small"
                    style={{
                      marginBottom: 8,
                      borderRadius: token.borderRadiusLG,
                      borderColor: isDefault ? token.colorPrimaryBorder : token.colorBorderSecondary
                    }}
                    styles={{ body: { padding: '10px 14px' } }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                      {isDefault ? (
                        <Tag color="blue" icon={<CheckCircleOutlined />} style={{ marginInlineEnd: 0 }}>
                          {t('setup.wsDefault')}
                        </Tag>
                      ) : (
                        <Button size="small" type="dashed" onClick={() => handleSetDefault(ws.id)}>
                          {t('setup.wsSetDefault')}
                        </Button>
                      )}
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => handleDelete(ws.id)}
                      />
                    </div>
                  </Card>
                )
              }}
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

          <Button
            type="dashed"
            icon={<PlusOutlined />}
            block
            loading={adding}
            onClick={handleAdd}
            style={{ height: 40 }}
          >
            {t('setup.wsAdd')}
          </Button>
        </>
      )}
    </div>
  )
}

// ─── Step 5: LLM reminder ────────────────────────────────────────────────────

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

const STEP_MODE = 0
const STEP_ROLE = 1
const STEP_PROJECT = 2
const STEP_WORKSPACE = 3
const STEP_LLM = 4
const LAST_STEP = STEP_LLM

const SetupWizard: React.FC = () => {
  // forceShow (set by the avatar-menu "引导" entry) re-opens the wizard even
  // after setup is complete, prefilled with the user's current choices.
  const forceShow = (useLocation().state as { forceShow?: boolean } | null)?.forceShow === true

  const [step, setStep] = useState(STEP_MODE)
  const [mode, setMode] = useState<AppMode>(() => useSettingsStore.getState().appMode)
  const [role, setRole] = useState<SetupRole>('general')
  const [modules, setModules] = useState<ModuleVisibility>(() =>
    forceShow ? useSettingsStore.getState().moduleVisibility : ROLE_MODULE_TEMPLATES.general
  )
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsLoadError, setProjectsLoadError] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => useSettingsStore.getState().activeProject?.projectId ?? null
  )

  const { token } = theme.useToken()
  const t = useT()
  const { message } = App.useApp()
  const navigate = useNavigate()

  const { updateSetting, completeSetup, hasCompletedSetup, setAppMode, setActiveProject } = useSettingsStore()
  const settingsLoaded = useSettingsStore((s) => !s.loading)
  const isLocalMode = useAuthStore((s) => s.isLocalMode)
  const workspaces = useWorkspaceStore((s) => s.workspaces)

  // Snapshot userAppDir so a detour through 通用 (which re-points it at the
  // chosen local directory) is undone when the user finishes in 研发.
  const initialUserAppDirRef = useRef<string | null>(null)
  useEffect(() => {
    if (settingsLoaded && initialUserAppDirRef.current === null) {
      initialUserAppDirRef.current = useSettingsStore.getState().userAppDir
    }
  }, [settingsLoaded])

  // Redirect if already completed setup (unless the user explicitly re-opened it)
  useEffect(() => {
    if (!forceShow && settingsLoaded && hasCompletedSetup) {
      navigate('/ai-chat', { replace: true })
    }
  }, [forceShow, settingsLoaded, hasCompletedSetup, navigate])

  // forceShow: restore the previously chosen role (modules stay as configured)
  useEffect(() => {
    if (!forceShow) return
    window.api.settings
      .getAgentSettings()
      .then((s) => {
        if (roleOptions.includes(s.setupRole as SetupRole)) setRole(s.setupRole as SetupRole)
      })
      .catch(() => { /* keep default */ })
  }, [forceShow])

  const fetchProjects = useCallback(async () => {
    if (isLocalMode) return
    setProjectsLoading(true)
    setProjectsLoadError(false)
    try {
      const list = await apiClient.listProjects()
      setProjects(list)
      if (list.length === 1) setSelectedProjectId(list[0].projectId)
    } catch {
      setProjectsLoadError(true)
    } finally {
      setProjectsLoading(false)
    }
  }, [isLocalMode])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  // Project step is skippable when there is nothing to choose (local mode,
  // empty list, or unreachable backend); otherwise a selection is required.
  const projectStepSatisfied =
    isLocalMode || projectsLoadError || projects.length === 0 || !!selectedProjectId

  const handleNext = useCallback(() => {
    if (step === STEP_PROJECT && !projectStepSatisfied) {
      message.warning(t('setup.projectSelectRequired'))
      return
    }
    if (step === STEP_WORKSPACE && workspaces.length === 0) {
      message.warning(t('setup.wsRequiredWarn'))
      return
    }
    setStep((s) => s + 1)
  }, [step, projectStepSatisfied, workspaces.length, message, t])

  const handleFinish = useCallback(async () => {
    if (workspaces.length === 0) {
      message.warning(t('setup.wsRequiredWarn'))
      setStep(STEP_WORKSPACE)
      return
    }
    try {
      setAppMode(mode)
      // Save module visibility
      await updateSetting('moduleVisibility', modules)

      // 通用: user-apps root follows the default local directory.
      // 研发: keep the directory from before the wizard.
      if (mode === 'general') {
        const dir = useWorkspaceStore.getState().activeWorkspace?.path ?? workspaces[0]?.path
        if (dir) await updateSetting('userAppDir', dir)
      } else {
        const initial = initialUserAppDirRef.current
        if (initial && useSettingsStore.getState().userAppDir !== initial) {
          await updateSetting('userAppDir', initial)
        }
      }

      // Persist selected project + self-join as member (best effort)
      const selected = projects.find((p) => p.projectId === selectedProjectId)
      if (selected) {
        await setActiveProject({
          projectId: selected.projectId,
          name: selected.name,
          vcsType: selected.vcsType,
          repoUrl: selected.repoUrl ?? undefined
        })
        apiClient.joinProject(selected.projectId).catch(() => {
          // Non-fatal: membership can be granted later by an admin
        })
      }

      // Persist role + initialize persona template for first-time users
      await window.api.settings.setAgentSettings({ setupRole: role })
      await window.api.agent.initSoulFromRole(role)
      // Mark setup as complete
      await completeSetup()
      message.success(t('setup.success'))
      navigate(mode === 'general' ? '/workbench/installed' : '/ai-chat', { replace: true })
    } catch {
      message.error(t('setup.saveFailed'))
    }
  }, [
    workspaces,
    mode,
    modules,
    role,
    projects,
    selectedProjectId,
    setAppMode,
    updateSetting,
    setActiveProject,
    completeSetup,
    navigate,
    message,
    t
  ])

  const stepItems = useMemo(
    () => [
      { title: t('setup.stepMode') },
      { title: t('setup.stepRole') },
      { title: t('setup.stepProject') },
      { title: t(mode === 'general' ? 'setup.stepWorkspaceGeneral' : 'setup.stepWorkspace') },
      { title: t('setup.stepLLM') }
    ],
    [t, mode]
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
      <div style={{ padding: '28px 32px 0', display: 'flex', justifyContent: 'center' }}>
        <Steps current={step} items={stepItems} style={{ maxWidth: 640, width: '100%' }} size="small" />
      </div>

      {/* Step content */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 32px' }}>
        <div style={{ width: '100%', maxWidth: 640 }}>
          {step === STEP_MODE && <StepMode mode={mode} onModeChange={setMode} />}
          {step === STEP_ROLE && (
            <StepRole
              role={role}
              onRoleChange={setRole}
              moduleVisibility={modules}
              onModulesChange={setModules}
            />
          )}
          {step === STEP_PROJECT && (
            <StepProject
              projects={projects}
              loading={projectsLoading}
              loadError={projectsLoadError}
              isLocalMode={isLocalMode}
              selectedProjectId={selectedProjectId}
              onSelect={setSelectedProjectId}
              onRetry={fetchProjects}
            />
          )}
          {step === STEP_WORKSPACE && <StepWorkspace mode={mode} />}
          {step === STEP_LLM && <StepLLM />}
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
        {step < LAST_STEP ? (
          <Button type="primary" onClick={handleNext}>
            {t('setup.next')}
          </Button>
        ) : (
          <Button
            type="primary"
            onClick={handleFinish}
            icon={<CheckCircleOutlined />}
            disabled={workspaces.length === 0}
          >
            {t('setup.finish')}
          </Button>
        )}
      </div>
    </div>
  )
}

export default SetupWizard
