/**
 * SkillsManager
 *
 * The AI-skill section of the "My Contributions" page. Aggregates four kinds of
 * skills and offers the appropriate per-skill actions:
 *   - self        skills authored / managed in user-apps (edit + publish via editor)
 *   - local       skills loaded from disk by drag-in / picker (install + publish)
 *   - global      skills found in ~/.claude|.codex|.gemini  (全局生效 badge + publish)
 *   - project     skills found in the active workspace       (项目生效 badge + publish)
 *
 * Importing: drag a folder/file onto the dropzone, pick a folder/files, or
 * one-click import everything already present in the user's global tool dirs.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Typography, Tag, Tooltip, theme, Button, Space, Empty, App, Spin } from 'antd'
import {
  EditOutlined,
  CloudUploadOutlined,
  DownloadOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  FileAddOutlined,
  ImportOutlined,
  InboxOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import { useSkillStore } from '../stores/useSkillStore'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { useAuthStore } from '../stores/useAuthStore'
import { useNavigate } from 'react-router-dom'
import { applicationManager } from '../services/applicationManager'
import { SkillToolTag } from './ProviderIcons'
import SkillInstallModal from './SkillInstallModal'
import type { SkillInstallMode, SkillTool, ScannedSkill, SkillSource } from '../types/skill'
import type { SubAppManifest } from '../types/subapp'
import { useT } from '../i18n'

const { Text } = Typography

/** A self-created/managed skill living in user-apps. */
export interface SelfSkill {
  id: string
  manifest: SubAppManifest
  appType: 'draft' | 'local' | 'published'
}

interface SkillsManagerProps {
  selfSkills: SelfSkill[]
  onEditSelf: (appId: string) => void
  onPublishSelf: (appId: string) => void
  onDetailSelf: (appId: string) => void
}

interface Badge {
  label: string
  color: string
}

interface CardAction {
  key: string
  icon: React.ReactNode
  label: string
  color: string
  onClick: () => void
}

const SkillsManager: React.FC<SkillsManagerProps> = ({
  selfSkills,
  onEditSelf,
  onPublishSelf,
  onDetailSelf
}) => {
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const t = useT()
  const navigate = useNavigate()

  const handleDetailPath = useCallback((skillPath: string) => {
    navigate(`/workbench/skill-detail/_ws?path=${encodeURIComponent(skillPath)}`)
  }, [navigate])

  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace)
  const { loggedIn, isLocalMode } = useAuthStore()
  const canPublish = loggedIn && !isLocalMode

  const localSources = useSkillStore((s) => s.localSources)
  const globalSkills = useSkillStore((s) => s.globalSkills)
  const projectSkills = useSkillStore((s) => s.projectSkills)
  const loading = useSkillStore((s) => s.loading)
  const fetchAll = useSkillStore((s) => s.fetchAll)
  const loadLocal = useSkillStore((s) => s.loadLocal)
  const removeLocalSource = useSkillStore((s) => s.removeLocalSource)
  const install = useSkillStore((s) => s.install)

  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const [publishingKey, setPublishingKey] = useState<string | null>(null)

  // Install modal state
  const [installOpen, setInstallOpen] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installTarget, setInstallTarget] = useState<{ sourceDir: string; name: string } | null>(
    null
  )

  const workspacePath = activeWorkspace?.path

  useEffect(() => {
    fetchAll(workspacePath)
  }, [fetchAll, workspacePath])

  // ---- Import handlers ---------------------------------------------------

  const importPath = useCallback(
    async (inputPath: string) => {
      setImporting(true)
      try {
        const res = await loadLocal(inputPath)
        if (res.success) {
          message.success(t('skill.import.loaded'))
        } else {
          message.error(res.error || t('skill.import.failed'))
        }
      } finally {
        setImporting(false)
      }
    },
    [loadLocal, message, t]
  )

  const handlePickFolder = useCallback(async () => {
    const dir = await window.api.dialog.selectDirectory()
    if (dir) await importPath(dir)
  }, [importPath])

  const handlePickFiles = useCallback(async () => {
    const files = await window.api.dialog.selectFiles()
    if (files && files.length > 0) await importPath(files[0])
  }, [importPath])

  const handleImportGlobal = useCallback(async () => {
    setImporting(true)
    try {
      await useSkillStore.getState().fetchGlobalSkills()
      message.success(t('skill.import.globalDone'))
    } finally {
      setImporting(false)
    }
  }, [message, t])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const files = Array.from(e.dataTransfer.files)
      if (files.length === 0) return
      // Electron exposes the absolute path on the File object.
      const p = (files[0] as File & { path?: string }).path
      if (p) await importPath(p)
    },
    [importPath]
  )

  // ---- Install -----------------------------------------------------------

  const openInstall = (sourceDir: string, name: string) => {
    setInstallTarget({ sourceDir, name })
    setInstallOpen(true)
  }

  const handleConfirmInstall = async (mode: SkillInstallMode, tools: SkillTool[]) => {
    if (!installTarget) return
    setInstalling(true)
    try {
      const res = await install({
        sourceDir: installTarget.sourceDir,
        mode,
        tools,
        workspacePath
      })
      if (res.success) {
        message.success(t('skill.install.done', String(res.installedTo.length)))
        setInstallOpen(false)
        setInstallTarget(null)
        await fetchAll(workspacePath)
      } else {
        message.error(res.error || t('skill.install.failed'))
      }
    } finally {
      setInstalling(false)
    }
  }

  // ---- Publish a referenced skill directory ------------------------------

  const publishDir = async (sourceDir: string, key: string) => {
    if (!canPublish) {
      message.warning(isLocalMode ? t('skill.publish.localMode') : t('skill.publish.loginRequired'))
      return
    }
    setPublishingKey(key)
    try {
      const pkg = await window.api.developer.packageDir(sourceDir)
      const manifest = pkg.manifest as SubAppManifest & { category?: string }
      const userApps = await applicationManager.fetchUserApplications()
      const existing = userApps.find((a) => a.name === manifest.name)
      let applicationId: string
      if (existing) {
        await applicationManager.updateApplication(existing.applicationId, {
          name: manifest.name,
          description: manifest.description,
          metadata: { entry: manifest.entry, type: 'ai-skill' }
        })
        applicationId = existing.applicationId
      } else {
        const created = await applicationManager.createApplication({
          name: manifest.name,
          description: manifest.description,
          version: manifest.version,
          category: manifest.category || 'general',
          type: 'ai-skill',
          metadata: { entry: manifest.entry }
        })
        applicationId = created.applicationId
      }
      const file = new File([new Uint8Array(pkg.buffer)], pkg.fileName, {
        type: 'application/zip'
      })
      await applicationManager.uploadApplication(
        applicationId,
        file,
        manifest.version,
        t('skill.publish.changelog', manifest.name, manifest.version)
      )
      message.success(t('skill.publish.done', manifest.name))
    } catch (err) {
      console.error('Publish skill failed:', err)
      message.error(err instanceof Error ? err.message : t('skill.publish.failed'))
    } finally {
      setPublishingKey(null)
    }
  }

  const handleRemoveLocal = async (id: string) => {
    await removeLocalSource(id)
    message.success(t('skill.import.removed'))
  }

  // ---- Card rendering ----------------------------------------------------

  const renderCard = (opts: {
    key: string
    title: string
    version?: string
    desc?: string
    badges: Badge[]
    tools: SkillTool[]
    actions: CardAction[]
  }) => {
    const { key, title, version, desc, badges, tools, actions } = opts
    return (
      <div key={key} className="cb-glass-card">
        <div style={{ padding: '12px 16px', minHeight: 72, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 8, minHeight: 44 }}>
            <Tooltip title={desc || title}>
              <Text
                strong
                style={{
                  flex: 1,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  wordBreak: 'break-word',
                  lineHeight: '22px',
                  minHeight: 44
                }}
              >
                {title}
              </Text>
            </Tooltip>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {version && <Tag style={{ margin: 0 }}>v{version}</Tag>}
            {badges.map((b) => (
              <Tag key={b.label} color={b.color} style={{ margin: 0 }}>
                {b.label}
              </Tag>
            ))}
            {tools.map((tool) => (
              <SkillToolTag key={tool} tool={tool} />
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', borderTop: `1px solid ${token.colorBorderSecondary}` }}>
          {actions.map((a, i) => (
            <React.Fragment key={a.key}>
              {i > 0 && (
                <div style={{ width: 1, alignSelf: 'stretch', background: token.colorBorderSecondary }} />
              )}
              <div
                onClick={a.onClick}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  color: a.color,
                  fontWeight: 500,
                  fontSize: 13
                }}
              >
                {a.icon} {a.label}
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    )
  }

  const selfTypeBadge = (appType: SelfSkill['appType']): Badge => {
    switch (appType) {
      case 'draft':
        return { label: t('mine.draft'), color: 'orange' }
      case 'published':
        return { label: t('mine.published'), color: 'green' }
      default:
        return { label: t('mine.local'), color: 'default' }
    }
  }

  // Group scanned skills by name so claude/codex/gemini variants of the same
  // skill collapse into a single card carrying multiple tool tags.
  const groupScanned = (skills: ScannedSkill[]): Map<string, ScannedSkill[]> => {
    const map = new Map<string, ScannedSkill[]>()
    for (const s of skills) {
      const arr = map.get(s.name) || []
      arr.push(s)
      map.set(s.name, arr)
    }
    return map
  }

  const globalGrouped = useMemo(() => groupScanned(globalSkills), [globalSkills])
  const projectGrouped = useMemo(() => groupScanned(projectSkills), [projectSkills])

  const hasAny =
    selfSkills.length > 0 ||
    localSources.length > 0 ||
    globalSkills.length > 0 ||
    projectSkills.length > 0

  const subHeader = (label: string): React.ReactNode => (
    <Text type="secondary" style={{ display: 'block', margin: '4px 0 8px', fontSize: 12 }}>
      {label}
    </Text>
  )

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 16,
    marginBottom: 16
  }

  return (
    <div>
      {/* Import toolbar + dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{
          border: `1px dashed ${dragOver ? token.colorPrimary : token.colorBorder}`,
          background: dragOver ? token.colorPrimaryBg : token.colorFillQuaternary,
          borderRadius: 10,
          padding: '16px 20px',
          marginBottom: 20,
          transition: 'all 0.2s'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <InboxOutlined style={{ fontSize: 22, color: token.colorTextSecondary }} />
          <Text type="secondary" style={{ flex: 1, minWidth: 180, fontSize: 13 }}>
            {t('skill.import.dropHint')}
          </Text>
          <Space wrap>
            <Button icon={<FolderOpenOutlined />} onClick={handlePickFolder} loading={importing}>
              {t('skill.import.pickFolder')}
            </Button>
            <Button icon={<FileAddOutlined />} onClick={handlePickFiles} loading={importing}>
              {t('skill.import.pickFiles')}
            </Button>
            <Button icon={<ImportOutlined />} onClick={handleImportGlobal} loading={importing}>
              {t('skill.import.globalBtn')}
            </Button>
          </Space>
        </div>
      </div>

      {loading && !hasAny ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      ) : !hasAny ? (
        <Empty description={t('skill.empty')} />
      ) : (
        <>
          {/* Self-created / managed */}
          {selfSkills.length > 0 && (
            <>
              {subHeader(t('skill.section.self'))}
              <div style={gridStyle}>
                {selfSkills.map((s) =>
                  renderCard({
                    key: `self-${s.id}`,
                    title: s.manifest.name,
                    version: s.manifest.version,
                    desc: s.manifest.description,
                    badges: [selfTypeBadge(s.appType)],
                    tools: [],
                    actions: [
                      {
                        key: 'edit',
                        icon: <EditOutlined />,
                        label: t('mine.edit'),
                        color: token.colorTextSecondary,
                        onClick: () => onEditSelf(s.id)
                      },
                      {
                        key: 'detail',
                        icon: <FileTextOutlined />,
                        label: t('skillDetail.detail'),
                        color: token.colorPrimary,
                        onClick: () => onDetailSelf(s.id)
                      },
                      {
                        key: 'publish',
                        icon: <CloudUploadOutlined />,
                        label: s.appType === 'published' ? t('mine.republish') : t('mine.publish'),
                        color: token.colorPrimary,
                        onClick: () => onPublishSelf(s.id)
                      }
                    ]
                  })
                )}
              </div>
            </>
          )}

          {/* Loaded from disk (reference only) */}
          {localSources.length > 0 && (
            <>
              {subHeader(t('skill.section.local'))}
              <div style={gridStyle}>
                {localSources.map((s: SkillSource) =>
                  renderCard({
                    key: `local-${s.id}`,
                    title: s.name,
                    desc: s.description,
                    badges: [{ label: t('skill.badge.loaded'), color: 'blue' }],
                    tools: [],
                    actions: [
                      {
                        key: 'install',
                        icon: <DownloadOutlined />,
                        label: t('skill.action.install'),
                        color: token.colorPrimary,
                        onClick: () => openInstall(s.sourcePath, s.name)
                      },
                      {
                        key: 'detail',
                        icon: <FileTextOutlined />,
                        label: t('skillDetail.detail'),
                        color: token.colorTextSecondary,
                        onClick: () => handleDetailPath(s.sourcePath)
                      },
                      {
                        key: 'publish',
                        icon: <CloudUploadOutlined />,
                        label: t('mine.publish'),
                        color: token.colorTextSecondary,
                        onClick: () => publishDir(s.sourcePath, `local-${s.id}`)
                      },
                      {
                        key: 'remove',
                        icon: <DeleteOutlined />,
                        label: t('skill.action.remove'),
                        color: token.colorTextTertiary,
                        onClick: () => handleRemoveLocal(s.id)
                      }
                    ]
                  })
                )}
              </div>
            </>
          )}

          {/* Globally effective (~/.claude, ~/.codex, ...) */}
          {globalGrouped.size > 0 && (
            <>
              {subHeader(t('skill.section.global'))}
              <div style={gridStyle}>
                {Array.from(globalGrouped.entries()).map(([name, variants]) => {
                  const first = variants[0]
                  return renderCard({
                    key: `global-${name}`,
                    title: first.displayName || name,
                    version: first.version,
                    desc: first.description,
                    badges: [{ label: t('skill.badge.global'), color: 'gold' }],
                    tools: variants.map((v) => v.tool),
                    actions: [
                      {
                        key: 'detail',
                        icon: <FileTextOutlined />,
                        label: t('skillDetail.detail'),
                        color: token.colorTextSecondary,
                        onClick: () => handleDetailPath(first.path)
                      },
                      {
                        key: 'publish',
                        icon:
                          publishingKey === `global-${name}` ? <Spin size="small" /> : <CloudUploadOutlined />,
                        label: t('mine.publish'),
                        color: token.colorPrimary,
                        onClick: () => publishDir(first.path, `global-${name}`)
                      }
                    ]
                  })
                })}
              </div>
            </>
          )}

          {/* Project effective (workspace .claude/.codex) */}
          {projectGrouped.size > 0 && (
            <>
              {subHeader(t('skill.section.project', activeWorkspace?.name || ''))}
              <div style={gridStyle}>
                {Array.from(projectGrouped.entries()).map(([name, variants]) => {
                  const first = variants[0]
                  return renderCard({
                    key: `project-${name}`,
                    title: first.displayName || name,
                    version: first.version,
                    desc: first.description,
                    badges: [{ label: t('skill.badge.project'), color: 'cyan' }],
                    tools: variants.map((v) => v.tool),
                    actions: [
                      {
                        key: 'detail',
                        icon: <FileTextOutlined />,
                        label: t('skillDetail.detail'),
                        color: token.colorTextSecondary,
                        onClick: () => handleDetailPath(first.path)
                      },
                      {
                        key: 'publish',
                        icon:
                          publishingKey === `project-${name}` ? <Spin size="small" /> : <CloudUploadOutlined />,
                        label: t('mine.publish'),
                        color: token.colorPrimary,
                        onClick: () => publishDir(first.path, `project-${name}`)
                      }
                    ]
                  })
                })}
              </div>
            </>
          )}
        </>
      )}

      <SkillInstallModal
        open={installOpen}
        title={installTarget ? t('skill.install.titleFor', installTarget.name) : undefined}
        hasWorkspace={!!workspacePath}
        workspaceName={activeWorkspace?.name}
        confirmLoading={installing}
        onCancel={() => {
          setInstallOpen(false)
          setInstallTarget(null)
        }}
        onConfirm={handleConfirmInstall}
      />
    </div>
  )
}

export default SkillsManager
