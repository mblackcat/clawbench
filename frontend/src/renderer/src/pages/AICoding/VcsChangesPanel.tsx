import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Button, Input, theme, App, Dropdown, Badge, Segmented, Tree, Tooltip } from 'antd'
import {
  SyncOutlined,
  CloudUploadOutlined,
  CloudDownloadOutlined,
  ReloadOutlined,
  UnorderedListOutlined,
  ApartmentOutlined,
  FolderOutlined,
  HistoryOutlined,
  CaretDownOutlined,
  CaretRightOutlined
} from '@ant-design/icons'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import { MONO_FONT_STACK } from '../../utils/mono-font'
import type { VcsCommit, VcsCommitFile, VcsType } from '../../types/ipc'
import { useVcsSelectionStore } from '../../stores/useVcsSelectionStore'
import { EnvToolIcon, hasEnvToolIcon } from '../../components/ToolIcons'
import DiffViewerModal from './DiffViewerModal'
import VcsHistorySection from './VcsHistorySection'
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
const SECTIONS_STORAGE_KEY = 'cb-workbench-vcs-sections'
/** Commit messages the user submitted from this panel, newest first (all workspaces). */
const MSG_HISTORY_STORAGE_KEY = 'cb-workbench-commit-msg-history'
const MSG_HISTORY_MAX = 50
/** Entries offered by the history picker (local messages + loaded commits). */
const MSG_PICKER_MAX = 30

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full / unavailable — history is a convenience */
  }
}

function sameMessage(a: string, b: string): boolean {
  return a.trim() === b.trim()
}

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
  const openWorkingDiff = useCallback((path: string) => {
    setDiffCommit(null)
    setDiffTarget(path)
  }, [])

  // ── Section collapse state (persisted) ──
  const [sections, setSections] = useState<{ changes: boolean; history: boolean }>(() => {
    const saved = readJson<Partial<{ changes: boolean; history: boolean }>>(SECTIONS_STORAGE_KEY, {})
    return { changes: saved.changes !== false, history: saved.history !== false }
  })
  const toggleSection = useCallback((key: 'changes' | 'history') => {
    setSections((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      writeJson(SECTIONS_STORAGE_KEY, next)
      return next
    })
  }, [])

  // ── History section wiring ──
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const refreshHistory = useCallback(() => setHistoryRefreshKey((k) => k + 1), [])
  const [historyCommits, setHistoryCommits] = useState<VcsCommit[]>([])
  const [diffCommit, setDiffCommit] = useState<{ id: string; shortId: string; file: VcsCommitFile } | null>(null)
  const openCommitFileDiff = useCallback((commit: VcsCommit, file: VcsCommitFile) => {
    setDiffCommit({ id: commit.id, shortId: commit.shortId, file })
    setDiffTarget(file.path)
  }, [])

  // ── Commit message history: ↑/↓ in the input + picker button ──
  const [localMessages, setLocalMessages] = useState<string[]>(() => {
    const saved = readJson<unknown>(MSG_HISTORY_STORAGE_KEY, [])
    return Array.isArray(saved) ? saved.filter((m): m is string => typeof m === 'string' && !!m.trim()) : []
  })
  const rememberMessage = useCallback((msg: string) => {
    setLocalMessages((prev) => {
      const next = [msg, ...prev.filter((m) => !sameMessage(m, msg))].slice(0, MSG_HISTORY_MAX)
      writeJson(MSG_HISTORY_STORAGE_KEY, next)
      return next
    })
  }, [])
  // Local submissions first (they are what the user typed), then messages from
  // the loaded history, de-duplicated.
  const messageHistory = useMemo(() => {
    const out: string[] = []
    for (const m of [...localMessages, ...historyCommits.map((c) => c.message)]) {
      if (m.trim() && !out.some((x) => sameMessage(x, m))) out.push(m.trim())
    }
    return out
  }, [localMessages, historyCommits])
  // -1 = editing the draft; n = showing messageHistory[n].
  const [historyIndex, setHistoryIndex] = useState(-1)
  const draftRef = useRef('')
  const inputRef = useRef<TextAreaRef>(null)

  const applyHistoryMessage = useCallback((msg: string, caret: 'start' | 'end') => {
    setCommitMsg(msg)
    // Move the caret after React commits the new value.
    requestAnimationFrame(() => {
      const el = inputRef.current?.resizableTextArea?.textArea
      if (!el) return
      const pos = caret === 'start' ? 0 : el.value.length
      el.setSelectionRange(pos, pos)
    })
  }, [])

  const handleMessageKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.nativeEvent.isComposing) return
      const el = e.currentTarget
      if (el.selectionStart !== el.selectionEnd) return
      const value = el.value
      // While the input still shows an untouched history entry, arrows keep
      // cycling; otherwise they only navigate from the first / last line so
      // multi-line messages stay editable with the keyboard.
      const browsing = historyIndex >= 0 && value === messageHistory[historyIndex]
      if (e.key === 'ArrowUp') {
        const onFirstLine = !value.slice(0, el.selectionStart).includes('\n')
        if (!browsing && !onFirstLine) return
        if (historyIndex >= messageHistory.length - 1) return
        e.preventDefault()
        if (historyIndex === -1) draftRef.current = value
        const next = historyIndex + 1
        setHistoryIndex(next)
        applyHistoryMessage(messageHistory[next], 'start')
      } else {
        if (historyIndex < 0) return
        const onLastLine = !value.slice(el.selectionEnd).includes('\n')
        if (!browsing && !onLastLine) return
        e.preventDefault()
        const next = historyIndex - 1
        setHistoryIndex(next)
        applyHistoryMessage(next < 0 ? draftRef.current : messageHistory[next], 'end')
      }
    },
    [historyIndex, messageHistory, applyHistoryMessage]
  )

  // A different workspace starts from a fresh draft position.
  useEffect(() => {
    setHistoryIndex(-1)
    draftRef.current = ''
  }, [workingDir])

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
        rememberMessage(commitMsg.trim())
        setCommitMsg('')
        setHistoryIndex(-1)
        draftRef.current = ''
        fetchFiles()
        refreshHistory()
      } else {
        message.error(result.error || tRef.current('coding.vcsCommitFailed'))
      }
    } catch {
      message.error(tRef.current('coding.vcsCommitFailed'))
    } finally {
      setActionLoading(null)
    }
  }, [workingDir, commitMsg, message, fetchFiles, vcsType, selectedVcs, rememberMessage, refreshHistory])

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
        refreshHistory()
      } else {
        message.error(result.error || tRef.current(pullFailedKey(vcsType)))
      }
    } catch {
      message.error(tRef.current(pullFailedKey(vcsType)))
    } finally {
      setActionLoading(null)
    }
  }, [workingDir, message, fetchFiles, vcsType, selectedVcs, refreshHistory])

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
                  onDoubleClick={() => openWorkingDiff(file.path)}
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
              onDoubleClick={() => openWorkingDiff(key)}
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
  }, [files, token, handleDiscardFile, diffHint, discardLabel, openWorkingDiff])

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
  const sectionHeaderStyle: React.CSSProperties = {
    height: 38,
    boxSizing: 'border-box',
    padding: '0 10px 0 6px',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    borderBottom: `1px solid ${token.colorBorderSecondary}`,
    flexShrink: 0,
    cursor: 'pointer',
    userSelect: 'none'
  }
  const caretStyle: React.CSSProperties = { width: 12, fontSize: 10, color: token.colorTextTertiary, flexShrink: 0 }
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
      {/* Changes header: collapse caret, title + count badge, multi-VCS capsule, flat/tree toggle, refresh */}
      <div style={sectionHeaderStyle} onClick={() => toggleSection('changes')}>
        <span style={caretStyle}>{sections.changes ? <CaretDownOutlined /> : <CaretRightOutlined />}</span>
        <Badge count={files.length} size="small" showZero={false} offset={[3, -2]}>
          <span style={{ fontWeight: 600, fontSize: 13, color: token.colorText }}>{t('coding.vcsChanges')}</span>
        </Badge>
        <span style={{ flex: 1 }} />
        <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
              refreshHistory()
            }}
            style={{ flexShrink: 0 }}
          />
        </span>
      </div>

      {sections.changes && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Commit area */}
          <div style={{ padding: '8px 10px', borderBottom: `1px solid ${token.colorBorderSecondary}`, flexShrink: 0 }}>
            <div style={{ position: 'relative', marginBottom: 6 }}>
              <Input.TextArea
                ref={inputRef}
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                placeholder={t('coding.vcsCommitMsgPlaceholder')}
                autoSize={{ minRows: 2, maxRows: 4 }}
                style={{ fontSize: 12, paddingRight: 26 }}
                onKeyDown={handleMessageKeyDown}
                onPressEnter={(e) => {
                  if (e.metaKey || e.ctrlKey) {
                    e.preventDefault()
                    handleCommit()
                  }
                }}
              />
              <Dropdown
                trigger={['click']}
                placement="bottomRight"
                disabled={messageHistory.length === 0}
                menu={{
                  style: { maxHeight: 320, overflowY: 'auto', width: 256 },
                  items: messageHistory.slice(0, MSG_PICKER_MAX).map((msg, i) => ({
                    key: String(i),
                    label: (
                      <span
                        title={msg}
                        style={{
                          display: 'block',
                          fontSize: 12,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {msg.split('\n', 1)[0]}
                      </span>
                    )
                  })),
                  onClick: ({ key }) => {
                    setHistoryIndex(-1)
                    draftRef.current = ''
                    applyHistoryMessage(messageHistory[Number(key)], 'end')
                    inputRef.current?.focus()
                  }
                }}
              >
                <Tooltip title={t('coding.vcsCommitMsgHistory')} placement="left">
                  <Button
                    type="text"
                    size="small"
                    icon={<HistoryOutlined style={{ fontSize: 12 }} />}
                    disabled={messageHistory.length === 0}
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      width: 20,
                      height: 20,
                      minWidth: 20,
                      color: token.colorTextTertiary
                    }}
                  />
                </Tooltip>
              </Dropdown>
            </div>
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
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 0' }}>
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
                      onDoubleClick={() => openWorkingDiff(file.path)}
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
        </div>
      )}

      {/* History header */}
      <div
        style={{ ...sectionHeaderStyle, borderTop: sections.changes ? `1px solid ${token.colorBorderSecondary}` : undefined }}
        onClick={() => toggleSection('history')}
      >
        <span style={caretStyle}>{sections.history ? <CaretDownOutlined /> : <CaretRightOutlined />}</span>
        <span style={{ fontWeight: 600, fontSize: 13, color: token.colorText }}>{t('coding.vcsHistory')}</span>
        <span style={{ flex: 1 }} />
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          title={t('coding.vcsHistoryRefresh')}
          onClick={(e) => {
            e.stopPropagation()
            refreshHistory()
          }}
          style={{ flexShrink: 0 }}
        />
      </div>
      {sections.history && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <VcsHistorySection
            workingDir={workingDir}
            vcsType={selectedVcs || (vcsType === 'none' ? null : vcsType)}
            refreshKey={historyRefreshKey}
            onCommitsChange={setHistoryCommits}
            onOpenFileDiff={openCommitFileDiff}
          />
        </div>
      )}

      <DiffViewerModal
        open={diffTarget !== null}
        workingDir={workingDir}
        target={diffTarget}
        vcsType={selectedVcs || (vcsType === 'none' ? null : vcsType)}
        commit={diffCommit}
        onClose={() => {
          setDiffTarget(null)
          setDiffCommit(null)
        }}
      />
    </div>
  )
}

export default VcsChangesPanel
