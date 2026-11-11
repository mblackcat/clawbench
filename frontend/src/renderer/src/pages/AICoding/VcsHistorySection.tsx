import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Spin, theme } from 'antd'
import { LoadingOutlined } from '@ant-design/icons'
import { ChevronDown, ChevronRight } from 'lucide'
import { AntdMorphIcon } from '../../components/common/AntdMorphIcon'
import { MONO_FONT_STACK } from '../../utils/mono-font'
import type { VcsCommit, VcsCommitFile, VcsType } from '../../types/ipc'
import { useT } from '../../i18n'

const PAGE_SIZE = 30
/** Distance from the bottom (px) at which the next page starts loading. */
const LOAD_MORE_THRESHOLD = 60

type ThemeToken = ReturnType<typeof theme.useToken>['token']

/** Status letter colors, derived from theme tokens so dark mode follows. */
function historyStatusColor(status: string, token: ThemeToken): string {
  switch (status) {
    case 'M':
    case 'T': return token.colorWarning
    case 'A': return token.colorSuccess
    case 'D': return token.colorError
    case 'R':
    case 'C': return token.colorPrimary
    default: return token.colorTextSecondary
  }
}

interface CommitFilesState {
  loading: boolean
  files: VcsCommitFile[]
  error?: string
}

interface VcsHistorySectionProps {
  workingDir: string
  vcsType: VcsType | null
  /** Bump to reload from the first page (after commit / pull / manual refresh). */
  refreshKey: number
  /** Loaded commits, newest first — feeds the commit-message history picker. */
  onCommitsChange?: (commits: VcsCommit[]) => void
  /** Double-click on a commit's file: open it in the diff viewer. */
  onOpenFileDiff: (commit: VcsCommit, file: VcsCommitFile) => void
}

function splitPath(path: string): { name: string; dir: string } {
  const idx = path.lastIndexOf('/')
  return idx < 0 ? { name: path, dir: '' } : { name: path.slice(idx + 1), dir: path.slice(0, idx) }
}

function firstLine(message: string): string {
  return message.split('\n', 1)[0]
}

const VcsHistorySection: React.FC<VcsHistorySectionProps> = ({
  workingDir,
  vcsType,
  refreshKey,
  onCommitsChange,
  onOpenFileDiff
}) => {
  const { token } = theme.useToken()
  const t = useT()

  const [commits, setCommits] = useState<VcsCommit[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filesById, setFilesById] = useState<Record<string, CommitFilesState>>({})
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  // Only the newest page request may write state — a switch of workspace / VCS
  // or a refresh supersedes anything still in flight.
  const requestSeq = useRef(0)
  const loadingRef = useRef(false)
  const onCommitsChangeRef = useRef(onCommitsChange)
  onCommitsChangeRef.current = onCommitsChange
  const tRef = useRef(t)
  tRef.current = t

  const loadPage = useCallback(
    async (cursor: string | null, reset: boolean) => {
      if (!workingDir || !vcsType || vcsType === 'none') return
      const seq = reset ? ++requestSeq.current : requestSeq.current
      loadingRef.current = true
      setLoading(true)
      if (reset) setError(null)
      try {
        const result = await window.api.vcs.log(workingDir, vcsType, cursor || undefined, PAGE_SIZE)
        if (seq !== requestSeq.current) return
        if (result?.error && (reset || !result.commits?.length)) setError(result.error)
        const page = result?.commits || []
        setCommits((prev) => {
          if (reset) return page
          // Guard against an overlapping page (new commits shifting git's skip).
          const seen = new Set(prev.map((c) => c.id))
          return [...prev, ...page.filter((c) => !seen.has(c.id))]
        })
        setNextCursor(result?.nextCursor ?? null)
      } catch (err) {
        if (seq !== requestSeq.current) return
        setError((err as Error).message || tRef.current('coding.vcsHistoryLoadFailed'))
        if (reset) {
          setCommits([])
          setNextCursor(null)
        }
      } finally {
        if (seq === requestSeq.current) {
          loadingRef.current = false
          setLoading(false)
        }
      }
    },
    [workingDir, vcsType]
  )

  useEffect(() => {
    setCommits([])
    setNextCursor(null)
    setExpandedId(null)
    setFilesById({})
    setSelectedFile(null)
    if (!workingDir || !vcsType || vcsType === 'none') {
      // Invalidate any in-flight page from the previous workspace / VCS.
      requestSeq.current++
      loadingRef.current = false
      setLoading(false)
      setError(null)
      return
    }
    void loadPage(null, true)
  }, [workingDir, vcsType, refreshKey, loadPage])

  useEffect(() => {
    onCommitsChangeRef.current?.(commits)
  }, [commits])

  const loadMore = useCallback(() => {
    if (loadingRef.current || !nextCursor) return
    void loadPage(nextCursor, false)
  }, [loadPage, nextCursor])

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - LOAD_MORE_THRESHOLD) loadMore()
    },
    [loadMore]
  )

  const toggleCommit = useCallback(
    async (commit: VcsCommit) => {
      if (expandedId === commit.id) {
        setExpandedId(null)
        return
      }
      setExpandedId(commit.id)
      const cached = filesById[commit.id]
      if (cached && !cached.error) return
      const seq = requestSeq.current
      setFilesById((prev) => ({ ...prev, [commit.id]: { loading: true, files: [] } }))
      try {
        const result = await window.api.vcs.commitFiles(workingDir, commit.id, vcsType || undefined)
        if (seq !== requestSeq.current) return
        setFilesById((prev) => ({
          ...prev,
          [commit.id]: { loading: false, files: result?.files || [], error: result?.error }
        }))
      } catch (err) {
        if (seq !== requestSeq.current) return
        setFilesById((prev) => ({
          ...prev,
          [commit.id]: { loading: false, files: [], error: (err as Error).message }
        }))
      }
    },
    [expandedId, filesById, workingDir, vcsType]
  )

  const formatTime = (ms: number): string => {
    if (!ms) return ''
    const minutes = Math.floor((Date.now() - ms) / 60_000)
    if (minutes < 1) return t('workbench.justNow')
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d`
    const d = new Date(ms)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const hover = {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      if (!e.currentTarget.dataset.selected) e.currentTarget.style.background = token.colorFillSecondary
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      if (!e.currentTarget.dataset.selected) e.currentTarget.style.background = 'transparent'
    }
  }

  const renderFiles = (commit: VcsCommit): React.ReactNode => {
    const state = filesById[commit.id]
    if (!state || state.loading) {
      return (
        <div style={{ padding: '6px 0 6px 28px' }}>
          <Spin size="small" indicator={<LoadingOutlined spin />} />
        </div>
      )
    }
    if (state.error) {
      return (
        <div style={{ padding: '4px 10px 6px 28px', fontSize: 11, color: token.colorError, wordBreak: 'break-all' }}>
          {state.error}
        </div>
      )
    }
    if (state.files.length === 0) {
      return (
        <div style={{ padding: '4px 10px 6px 28px', fontSize: 11, color: token.colorTextQuaternary }}>
          {t('coding.vcsHistoryNoFiles')}
        </div>
      )
    }
    return state.files.map((file) => {
      const { name, dir } = splitPath(file.path)
      const key = `${commit.id}\n${file.ref}`
      const selected = selectedFile === key
      const tip = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path
      return (
        <div
          key={key}
          data-selected={selected ? '1' : undefined}
          title={`${tip}\n${t('coding.diffDoubleClickHint')}`}
          onClick={() => setSelectedFile(key)}
          onDoubleClick={() => onOpenFileDiff(commit, file)}
          {...hover}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 10px 2px 28px',
            fontSize: 12,
            cursor: 'default',
            background: selected ? token.colorFillSecondary : 'transparent'
          }}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: token.colorText
            }}
          >
            <span style={{ textDecoration: file.status === 'D' ? 'line-through' : undefined }}>{name}</span>
            {dir && (
              <span style={{ marginLeft: 6, fontSize: 11, color: token.colorTextTertiary }}>
                {dir}
              </span>
            )}
          </span>
          <span
            style={{
              flexShrink: 0,
              width: 14,
              textAlign: 'center',
              fontWeight: 600,
              fontSize: 11,
              color: historyStatusColor(file.status, token)
            }}
          >
            {file.status}
          </span>
        </div>
      )
    })
  }

  if (!vcsType || vcsType === 'none') {
    return (
      <div style={{ padding: '24px 12px', textAlign: 'center', color: token.colorTextQuaternary, fontSize: 12 }}>
        {t('coding.vcsHistoryNoRepo')}
      </div>
    )
  }

  return (
    <div onScroll={handleScroll} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 0' }}>
      {error && commits.length === 0 && (
        <div style={{ padding: '16px 12px', textAlign: 'center', fontSize: 12, color: token.colorError, wordBreak: 'break-all' }}>
          {t('coding.vcsHistoryLoadFailed')}: {error}
        </div>
      )}
      {!error && !loading && commits.length === 0 && (
        <div style={{ padding: '24px 12px', textAlign: 'center', color: token.colorTextQuaternary, fontSize: 12 }}>
          {t('coding.vcsHistoryEmpty')}
        </div>
      )}
      {commits.map((commit) => {
        const open = expandedId === commit.id
        return (
          <div key={commit.id}>
            <div
              onClick={() => void toggleCommit(commit)}
              {...hover}
              title={`${commit.shortId} · ${commit.author}\n${new Date(commit.date).toLocaleString()}\n\n${commit.message}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 10px 3px 8px',
                fontSize: 12,
                cursor: 'pointer',
                background: 'transparent'
              }}
            >
              <span style={{ flexShrink: 0, width: 14, color: token.colorTextTertiary, fontSize: 10 }}>
                <AntdMorphIcon icon={open ? ChevronDown : ChevronRight} size={11} spring="snappy" />
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: commit.message ? token.colorText : token.colorTextQuaternary
                }}
              >
                {firstLine(commit.message) || t('coding.vcsHistoryNoMessage')}
              </span>
              <span
                style={{
                  flexShrink: 0,
                  maxWidth: 72,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 11,
                  color: token.colorTextTertiary
                }}
              >
                {commit.author}
              </span>
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 10,
                  fontFamily: MONO_FONT_STACK,
                  color: token.colorTextQuaternary
                }}
              >
                {formatTime(commit.date)}
              </span>
            </div>
            {open && renderFiles(commit)}
          </div>
        )
      })}
      {commits.length > 0 && (loading || nextCursor) && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
          {loading ? (
            <Spin size="small" indicator={<LoadingOutlined spin />} />
          ) : (
            <Button type="link" size="small" onClick={loadMore} style={{ fontSize: 12 }}>
              {t('coding.vcsHistoryLoadMore')}
            </Button>
          )}
        </div>
      )}
      {commits.length === 0 && loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
          <Spin size="small" />
        </div>
      )}
    </div>
  )
}

export default VcsHistorySection
