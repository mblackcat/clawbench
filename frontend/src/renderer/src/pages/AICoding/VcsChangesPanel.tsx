import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Button, Input, theme, App, Dropdown, Badge, Segmented, Tree, Tooltip } from 'antd'
import {
  SyncOutlined,
  CloudUploadOutlined,
  CloudDownloadOutlined,
  ReloadOutlined,
  UnorderedListOutlined,
  ApartmentOutlined,
  FolderOutlined
} from '@ant-design/icons'
import { MONO_FONT_STACK } from '../../utils/mono-font'
import type { VcsType } from '../../types/ipc'
import { useVcsSelectionStore } from '../../stores/useVcsSelectionStore'
import { EnvToolIcon, hasEnvToolIcon } from '../../components/ToolIcons'
import DiffViewerModal from './DiffViewerModal'
import { useT } from '../../i18n'

interface ChangedFile {
  path: string
  status: string
  staged: boolean
  additions: number
  deletions: number
}

interface VcsChangesPanelProps {
  workingDir: string
  visible: boolean
}

type ViewMode = 'flat' | 'tree'

type ThemeToken = ReturnType<typeof theme.useToken>['token']

/** Status letter colors, derived from theme tokens so dark mode follows. */
function statusColor(status: string, token: ThemeToken): string {
  switch (status) {
    case 'M': return token.colorWarning
    case 'A': return token.colorSuccess
    case 'D':
    case 'U': return token.colorError
    case 'R':
    case 'C': return token.colorPrimary
    default: return token.colorTextTertiary
  }
}

const VCS_LABELS: Record<VcsType, string> = {
  git: 'Git',
  svn: 'SVN',
  perforce: 'Perforce',
  none: 'VCS'
}

const VIEW_STORAGE_KEY = 'cb-workbench-vcs-view'

// Stable empty array so the `availableVcs` selector returns the same reference
// when a working directory has no detected VCS (avoids zustand re-render loops).
const EMPTY_VCS_LIST: VcsType[] = []

// ── file-path → tree builder ──

interface FileTreeNode {
  key: string
  title: React.ReactNode
  children?: FileTreeNode[]
  isLeaf?: boolean
}

interface DirAgg { type: 'dir'; name: string; children: Map<string, DirAgg | FileAgg> }
interface FileAgg { type: 'file'; name: string; file: ChangedFile }

function insertPath(root: DirAgg, file: ChangedFile): void {
  const parts = file.path.split('/').filter(Boolean)
  let cursor = root
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const isLeaf = i === parts.length - 1
    if (isLeaf) {
      cursor.children.set(part, { type: 'file', name: part, file })
    } else {
      const existing = cursor.children.get(part)
      if (!existing || existing.type === 'file') {
        cursor.children.set(part, { type: 'dir', name: part, children: new Map() })
      }
      cursor = cursor.children.get(part) as DirAgg
    }
  }
}

function countFiles(node: DirAgg): number {
  let n = 0
  for (const child of node.children.values()) {
    n += child.type === 'file' ? 1 : countFiles(child)
  }
  return n
}

function pullFailedKey(vcsType: VcsType): string {
  return vcsType === 'svn' ? 'coding.vcsUpdateFailed' : vcsType === 'perforce' ? 'coding.vcsSyncFailed' : 'coding.vcsPullFailed'
}

const VcsChangesPanel: React.FC<VcsChangesPanelProps> = ({ workingDir, visible }) => {
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const t = useT()
  // `t` is a new function every render; read it through a ref inside callbacks
  // so it doesn't invalidate them.
  const tRef = useRef(t)
  tRef.current = t

  // VCS selection is shared (with the sidebar badge + the toggle icon) via the
  // store, keyed by working directory — see useVcsSelectionStore.
  const availableVcs = useVcsSelectionStore((s) => s.available[workingDir] ?? EMPTY_VCS_LIST)
  const selectedVcs = useVcsSelectionStore((s) => s.selection[workingDir] ?? null)
  const setAvailable = useVcsSelectionStore((s) => s.setAvailable)
  const setSelection = useVcsSelectionStore((s) => s.setSelection)

  const [vcsType, setVcsType] = useState<VcsType>('none')
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [commitMsg, setCommitMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_STORAGE_KEY) as ViewMode) || 'flat'
  )
  // Path whose diff is open in the viewer (a file, or a folder in tree view).
  const [diffTarget, setDiffTarget] = useState<string | null>(null)
  // Resolved once per render: `t` itself is a fresh function each time and would
  // invalidate the tree memo on every render.
  const diffHint = t('coding.diffDoubleClickHint')
  const discardLabel = t('coding.vcsDiscardChanges')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Detect every VCS in the working directory; default to the first by priority.
  const detectVcs = useCallback(async () => {
    if (!workingDir) return
    try {
      const list = (await window.api.vcs.detectAll(workingDir)) as VcsType[]
      const safe = Array.isArray(list) ? list : []
      setAvailable(workingDir, safe)
      // Keep the user's prior pick when it is still detected; otherwise fall
      // back to the highest-priority detected VCS.
      const prev = useVcsSelectionStore.getState().selection[workingDir]
      if (!prev || !safe.includes(prev)) {
        setSelection(workingDir, safe[0] || null)
      }
    } catch {
      setAvailable(workingDir, [])
      setSelection(workingDir, null)
    }
  }, [workingDir, setAvailable, setSelection])

  const fetchFiles = useCallback(async () => {
    if (!workingDir) return
    setLoading(true)
    try {
      const result = await window.api.vcs.changedFiles(workingDir, selectedVcs || undefined)
      setVcsType((result?.type as VcsType) || selectedVcs || 'none')
      setFiles(result?.files || [])
    } catch {
      setVcsType(selectedVcs || 'none')
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [workingDir, selectedVcs])

  useEffect(() => {
    if (visible && workingDir) void detectVcs()
  }, [visible, workingDir, detectVcs])

  useEffect(() => {
    if (visible && workingDir) {
      fetchFiles()
      timerRef.current = setInterval(fetchFiles, 30_000)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [visible, workingDir, fetchFiles])

  // The sidebar detects each workspace's VCS in the background, so the store
  // usually knows the type before the panel is ever opened — adopt it right away
  // instead of showing 'none' until the first fetchFiles resolves.
  useEffect(() => {
    if (selectedVcs) setVcsType(selectedVcs)
  }, [selectedVcs])

  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, viewMode)
  }, [viewMode])

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) {
      message.warning(tRef.current('coding.vcsCommitMsgRequired'))
      return
    }
    setActionLoading('commit')
    try {
      const result = await window.api.vcs.commit(workingDir, commitMsg.trim(), selectedVcs || undefined)
      if (result.success) {
        message.success(
          tRef.current(
            vcsType === 'svn' ? 'coding.vcsSvnCommitSuccess'
              : vcsType === 'perforce' ? 'coding.vcsP4SubmitSuccess'
              : 'coding.vcsCommitSuccess'
          )
        )
        setCommitMsg('')
        fetchFiles()
      } else {
        message.error(result.error || tRef.current('coding.vcsCommitFailed'))
      }
    } catch {
      message.error(tRef.current('coding.vcsCommitFailed'))
    } finally {
      setActionLoading(null)
    }
  }, [workingDir, commitMsg, message, fetchFiles, vcsType, selectedVcs])

  const handlePush = useCallback(async () => {
    setActionLoading('push')
    try {
      const result = await window.api.vcs.push(workingDir, selectedVcs || undefined)
      if (result.success) message.success(tRef.current('coding.vcsPushSuccess'))
      else message.error(result.error || tRef.current('coding.vcsPushFailed'))
    } catch {
      message.error(tRef.current('coding.vcsPushFailed'))
    } finally {
      setActionLoading(null)
    }
  }, [workingDir, message, selectedVcs])

  const handlePull = useCallback(async () => {
    setActionLoading('pull')
    try {
      const result = await window.api.vcs.pull(workingDir, selectedVcs || undefined)
      if (result.success) {
        message.success(
          tRef.current(
            vcsType === 'svn' ? 'coding.vcsUpdateSuccess'
              : vcsType === 'perforce' ? 'coding.vcsSyncSuccess'
              : 'coding.vcsPullSuccess'
          )
        )
        fetchFiles()
      } else {
        message.error(result.error || tRef.current(pullFailedKey(vcsType)))
      }
    } catch {
      message.error(tRef.current(pullFailedKey(vcsType)))
    } finally {
      setActionLoading(null)
    }
  }, [workingDir, message, fetchFiles, vcsType, selectedVcs])

  const handleDiscardFile = useCallback(async (file: ChangedFile) => {
    setActionLoading(`discard-${file.path}`)
    try {
      const result = await window.api.vcs.discardFile(
        workingDir,
        file.path,
        file.status === '??',
        selectedVcs || undefined
      )
      if (result.success) fetchFiles()
      else message.error(result.error || tRef.current('coding.vcsDiscardFailed'))
    } catch {
      message.error(tRef.current('coding.vcsDiscardFailed'))
    } finally {
      setActionLoading(null)
    }
  }, [workingDir, message, fetchFiles, selectedVcs])

  // Build the folder tree for tree view.
  const treeData = useMemo<FileTreeNode[]>(() => {
    if (files.length === 0) return []
    const root: DirAgg = { type: 'dir', name: '', children: new Map() }
    for (const f of files) insertPath(root, f)

    const toNodes = (dir: DirAgg, prefix: string): FileTreeNode[] => {
      const entries = [...dir.children.entries()].sort(([aName, aNode], [bName, bNode]) => {
        const aDir = aNode.type === 'dir'
        const bDir = bNode.type === 'dir'
        if (aDir !== bDir) return aDir ? -1 : 1
        return aName.localeCompare(bName)
      })
      return entries.map(([name, node]) => {
        const key = prefix ? `${prefix}/${name}` : name
        if (node.type === 'file') {
          const file = node.file
          return {
            key,
            isLeaf: true,
            title: (
              <Dropdown
                menu={{ items: [{ key: 'discard', label: discardLabel, danger: true, onClick: () => handleDiscardFile(file) }] }}
                trigger={['contextMenu']}
              >
                <span
                  title={diffHint}
                  onDoubleClick={() => setDiffTarget(file.path)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: token.colorText }}
                >
                  <span style={{ display: 'inline-block', width: 14, textAlign: 'center', fontWeight: 600, fontSize: 11, color: statusColor(file.status, token) }}>
                    {file.status}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                  </span>
                  {(file.additions > 0 || file.deletions > 0) && (
                    <span style={{ fontSize: 10, fontFamily: MONO_FONT_STACK }}>
                      {file.additions > 0 && <span style={{ color: token.colorSuccess }}>+{file.additions}</span>}
                      {file.additions > 0 && file.deletions > 0 && ' '}
                      {file.deletions > 0 && <span style={{ color: token.colorError }}>-{file.deletions}</span>}
                    </span>
                  )}
                </span>
              </Dropdown>
            )
          }
        }
        return {
          key,
          title: (
            <span
              title={diffHint}
              onDoubleClick={() => setDiffTarget(key)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: token.colorTextSecondary }}
            >
              <FolderOutlined style={{ fontSize: 12, color: token.colorTextTertiary }} />
              <span>{name}</span>
              <span style={{ color: token.colorTextQuaternary, fontSize: 11 }}>({countFiles(node)})</span>
            </span>
          ),
          children: toNodes(node, key)
        }
      })
    }
    return toNodes(root, '')
  }, [files, token, handleDiscardFile, diffHint, discardLabel])

  if (!visible) return null

  const capsuleOptions = availableVcs
    .filter((v) => v !== 'none')
    .map((v) => ({
      value: v,
      label: (
        <Tooltip title={VCS_LABELS[v]}>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14 }}>
            {hasEnvToolIcon(v) ? <EnvToolIcon toolId={v} size={13} /> : VCS_LABELS[v]}
          </span>
        </Tooltip>
      )
    }))
  const pullTitle = t(vcsType === 'svn' ? 'coding.vcsUpdate' : vcsType === 'perforce' ? 'coding.vcsSync' : 'coding.vcsPull')

  return (
    <div
      style={{
        width: 280,
        height: '100%',
        borderLeft: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0
      }}
    >
      {/* Header: title + count badge, multi-VCS capsule, flat/tree toggle, refresh — one compact row */}
      <div
        style={{
          height: 38,
          boxSizing: 'border-box',
          padding: '0 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0
        }}
      >
        <Badge count={files.length} size="small" showZero={false} offset={[3, -2]}>
          <span style={{ fontWeight: 600, fontSize: 13, color: token.colorText }}>{t('coding.vcsChanges')}</span>
        </Badge>
        <span style={{ flex: 1 }} />
        {availableVcs.length > 1 && (
          <Segmented
            size="small"
            value={(selectedVcs || undefined) as string}
            options={capsuleOptions}
            onChange={(v) => setSelection(workingDir, v as VcsType)}
          />
        )}
        <Segmented
          size="small"
          value={viewMode}
          onChange={(v) => setViewMode(v as ViewMode)}
          options={[
            { label: <UnorderedListOutlined />, value: 'flat' },
            { label: <ApartmentOutlined />, value: 'tree' }
          ]}
        />
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined spin={loading} />}
          onClick={() => {
            void detectVcs()
            fetchFiles()
          }}
          style={{ flexShrink: 0 }}
        />
      </div>

      {/* Commit area */}
      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${token.colorBorderSecondary}`, flexShrink: 0 }}>
        <Input.TextArea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          placeholder={t('coding.vcsCommitPlaceholder')}
          autoSize={{ minRows: 2, maxRows: 4 }}
          style={{ fontSize: 12, marginBottom: 6 }}
          onPressEnter={(e) => {
            if (e.metaKey || e.ctrlKey) {
              e.preventDefault()
              handleCommit()
            }
          }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            size="small"
            type="primary"
            icon={<SyncOutlined />}
            loading={actionLoading === 'commit'}
            onClick={handleCommit}
            disabled={vcsType === 'none' || !commitMsg.trim() || files.length === 0}
            style={{ flex: 1, fontSize: 12 }}
          >
            {t('coding.vcsCommit')}
          </Button>
          {vcsType === 'git' && (
            <Button
              size="small"
              icon={<CloudUploadOutlined />}
              loading={actionLoading === 'push'}
              onClick={handlePush}
              title={t('coding.vcsPush')}
            />
          )}
          <Button
            size="small"
            icon={<CloudDownloadOutlined />}
            loading={actionLoading === 'pull'}
            onClick={handlePull}
            disabled={vcsType === 'none'}
            title={pullTitle}
          />
        </div>
      </div>

      {/* File list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {files.length === 0 && !loading && (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: token.colorTextQuaternary, fontSize: 12 }}>
            {vcsType === 'none' ? t('coding.vcsNoRepo') : t('coding.diffNoChanges')}
          </div>
        )}
        {viewMode === 'flat'
          ? files.map((file) => (
              <Dropdown
                key={file.path}
                menu={{
                  items: [
                    {
                      key: 'discard',
                      label: discardLabel,
                      danger: true,
                      onClick: () => handleDiscardFile(file)
                    }
                  ]
                }}
                trigger={['contextMenu']}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '3px 10px',
                    gap: 6,
                    fontSize: 12,
                    color: token.colorText,
                    cursor: 'default',
                    background: 'transparent'
                  }}
                  title={diffHint}
                  onDoubleClick={() => setDiffTarget(file.path)}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLElement).style.background = token.colorFillSecondary)
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLElement).style.background = 'transparent')
                  }
                >
                  {/* Status badge */}
                  <span
                    style={{
                      display: 'inline-block',
                      width: 16,
                      textAlign: 'center',
                      fontWeight: 600,
                      fontSize: 11,
                      color: statusColor(file.status, token),
                      flexShrink: 0
                    }}
                  >
                    {file.status}
                  </span>
                  {/* File name */}
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                    title={file.path}
                  >
                    {file.path.split('/').pop()}
                  </span>
                  {/* Additions / deletions */}
                  {(file.additions > 0 || file.deletions > 0) && (
                    <span style={{ flexShrink: 0, fontSize: 10, fontFamily: MONO_FONT_STACK }}>
                      {file.additions > 0 && (
                        <span style={{ color: token.colorSuccess }}>+{file.additions}</span>
                      )}
                      {file.additions > 0 && file.deletions > 0 && ' '}
                      {file.deletions > 0 && (
                        <span style={{ color: token.colorError }}>-{file.deletions}</span>
                      )}
                    </span>
                  )}
                </div>
              </Dropdown>
            ))
          : files.length > 0 && (
              <>
                <style>{`
                  .vcs-changes-tree .ant-tree-treenode { padding: 0; align-items: center; }
                  .vcs-changes-tree .ant-tree-node-content-wrapper { min-height: 20px; line-height: 20px; padding: 0 2px; }
                  .vcs-changes-tree .ant-tree-switcher { width: 16px; line-height: 20px; }
                  .vcs-changes-tree .ant-tree-indent-unit { width: 10px; }
                `}</style>
                <Tree
                  className="vcs-changes-tree"
                  treeData={treeData}
                  defaultExpandAll
                  blockNode
                  showLine={false}
                />
              </>
            )}
      </div>

      <DiffViewerModal
        open={diffTarget !== null}
        workingDir={workingDir}
        target={diffTarget}
        vcsType={selectedVcs || (vcsType === 'none' ? null : vcsType)}
        onClose={() => setDiffTarget(null)}
      />
    </div>
  )
}

export default VcsChangesPanel
