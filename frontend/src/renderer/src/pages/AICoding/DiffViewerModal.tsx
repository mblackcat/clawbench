import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Segmented, Button, Spin, Tooltip, theme } from 'antd'
import { CloseOutlined, DownOutlined, FileOutlined, UpOutlined } from '@ant-design/icons'
import { MONO_FONT_STACK } from '../../utils/mono-font'
import { useT } from '../../i18n'
import type { VcsType } from '../../types/ipc'
import {
  parseUnifiedDiff,
  buildCollapsibleSegments,
  buildSideBySideRows,
  sumDiffStat,
  type DiffFile,
  type DiffLine,
  type DiffUnviewableReason
} from '../../utils/unified-diff'

export type DiffViewMode = 'split' | 'inline'

interface DiffViewerModalProps {
  open: boolean
  workingDir: string
  /** Workspace-relative path of the double-clicked entry (file or directory). */
  target: string | null
  vcsType?: VcsType | null
  onClose: () => void
}

const VIEW_STORAGE_KEY = 'cb-workbench-diff-view'

/** Lines rendered per file before the rest is elided — keeps a huge file from
 *  freezing the renderer without pulling in a virtualization dependency. Only
 *  lines that are actually visible count against it; folded runs cost one bar. */
const MAX_RENDERED_LINES = 2000

/** Ceiling on the lines one folded run reveals when expanded. */
const MAX_EXPANDED_LINES = 2000

/** Diff colors derived from antd tokens so light/dark (and custom) themes follow along. */
function diffPalette(token: ReturnType<typeof theme.useToken>['token']) {
  return {
    border: token.colorBorderSecondary,
    headerBg: token.colorFillQuaternary,
    hunkBg: token.colorFillQuaternary,
    hunkText: token.colorTextSecondary,
    gutterText: token.colorTextQuaternary,
    addBg: token.colorSuccessBg,
    addGutterBg: token.colorSuccessBgHover,
    delBg: token.colorErrorBg,
    delGutterBg: token.colorErrorBgHover,
    emptyBg: token.colorFillQuaternary,
    markerAdd: token.colorSuccess,
    markerDel: token.colorError
  }
}

// Two inline icons for the view-mode capsule — a split pane and stacked rows.
const SplitViewIcon: React.FC = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
    <rect x="1.5" y="2.5" width="5.5" height="11" rx="1" stroke="currentColor" strokeWidth="1.2" />
    <rect x="9" y="2.5" width="5.5" height="11" rx="1" stroke="currentColor" strokeWidth="1.2" />
  </svg>
)

const InlineViewIcon: React.FC = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1" stroke="currentColor" strokeWidth="1.2" />
    <path d="M1.5 6.2h13M1.5 9.8h13" stroke="currentColor" strokeWidth="1.2" />
  </svg>
)

const UNVIEWABLE_KEYS: Record<DiffUnviewableReason, string> = {
  binary: 'coding.diffNotViewableBinary',
  'too-large': 'coding.diffNotViewableTooLarge',
  'property-only': 'coding.diffNotViewableProperty',
  'no-text-changes': 'coding.diffNotViewableNoText'
}

const DiffViewerModal: React.FC<DiffViewerModalProps> = ({
  open,
  workingDir,
  target,
  vcsType,
  onClose
}) => {
  const { token } = theme.useToken()
  const t = useT()
  const colors = useMemo(() => diffPalette(token), [token])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diffText, setDiffText] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [viewMode, setViewMode] = useState<DiffViewMode>(
    () => (localStorage.getItem(VIEW_STORAGE_KEY) as DiffViewMode) || 'split'
  )

  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, viewMode)
  }, [viewMode])

  // `t` is a fresh function on every render, so it must not be a dependency of
  // the loader — it would rebuild `load`, refire the effect below, setState,
  // and re-render, looping forever. Each pass raced the previous one's
  // response, which is what left the body blank after a view-mode switch (any
  // re-render restarted the storm) and intermittently on reopen.
  const tRef = useRef(t)
  tRef.current = t

  // Only the newest request may write state; a superseded one is dropped.
  const requestSeq = useRef(0)

  const load = useCallback(async () => {
    if (!open || !target || !workingDir) return
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.vcs.fileDiff(workingDir, target, vcsType || undefined)
      if (seq !== requestSeq.current) return
      if (result?.error) {
        setError(result.error)
        setDiffText('')
      } else {
        setDiffText(result?.diff || '')
      }
      setTruncated(Boolean(result?.truncated))
    } catch (err) {
      if (seq !== requestSeq.current) return
      setError((err as Error).message || tRef.current('coding.diffLoadFailed'))
      setDiffText('')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [open, target, workingDir, vcsType])

  useEffect(() => {
    void load()
  }, [load])

  const files = useMemo(() => parseUnifiedDiff(diffText), [diffText])
  const stat = useMemo(() => sumDiffStat(files), [files])

  const title = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 4 }}>
      <span
        title={target || ''}
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: MONO_FONT_STACK,
          fontSize: 13,
          fontWeight: 600,
          color: token.colorText,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {target || ''}
      </span>
      <span
        style={{
          display: 'flex',
          gap: 6,
          fontSize: 12,
          fontWeight: 400,
          fontFamily: MONO_FONT_STACK,
          flexShrink: 0,
          color: token.colorTextTertiary
        }}
      >
        {files.length > 1 && <span>{t('coding.diffFileCount', files.length)}</span>}
        {stat.additions > 0 && <span style={{ color: colors.markerAdd }}>+{stat.additions}</span>}
        {stat.deletions > 0 && <span style={{ color: colors.markerDel }}>-{stat.deletions}</span>}
      </span>
      <Segmented
        size="small"
        value={viewMode}
        onChange={(v) => setViewMode(v as DiffViewMode)}
        options={[
          {
            value: 'split',
            label: (
              <Tooltip title={t('coding.diffViewSplit')}>
                <span style={{ display: 'inline-flex', alignItems: 'center', height: 18 }}>
                  <SplitViewIcon />
                </span>
              </Tooltip>
            )
          },
          {
            value: 'inline',
            label: (
              <Tooltip title={t('coding.diffViewInline')}>
                <span style={{ display: 'inline-flex', alignItems: 'center', height: 18 }}>
                  <InlineViewIcon />
                </span>
              </Tooltip>
            )
          }
        ]}
      />
      <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
    </div>
  )

  const notice = (text: string): React.ReactNode => (
    <div
      style={{
        padding: '18px 16px',
        textAlign: 'center',
        fontSize: 12,
        color: token.colorTextTertiary,
        background: colors.headerBg
      }}
    >
      {text}
    </div>
  )

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      title={title}
      width="min(1280px, 92vw)"
      styles={{ body: { padding: 0, height: '70vh', overflow: 'auto', background: token.colorBgContainer } }}
      destroyOnHidden
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spin />
        </div>
      ) : error ? (
        notice(`${t('coding.diffLoadFailed')}: ${error}`)
      ) : files.length === 0 ? (
        notice(t('coding.diffNoChanges'))
      ) : (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {truncated && notice(t('coding.diffTruncated'))}
          {files.map((file) => (
            <FileDiffBlock
              key={`${file.path}-${file.oldPath || ''}`}
              file={file}
              viewMode={viewMode}
              colors={colors}
              showHeader={files.length > 1 || file.path !== target}
              t={t}
            />
          ))}
        </div>
      )}
    </Modal>
  )
}

type Colors = ReturnType<typeof diffPalette>

interface FileDiffBlockProps {
  file: DiffFile
  viewMode: DiffViewMode
  colors: Colors
  showHeader: boolean
  t: (key: string, ...args: (string | number)[]) => string
}

/** One rendered block of a file: a hunk header, a run of lines, or a fold bar. */
type DiffNode =
  | { kind: 'hunk'; key: string; header: string }
  | { kind: 'lines'; key: string; lines: DiffLine[] }
  | { kind: 'fold'; key: string; lines: DiffLine[] }

const FileDiffBlock: React.FC<FileDiffBlockProps> = ({ file, viewMode, colors, showHeader, t }) => {
  const { token } = theme.useToken()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const isSplit = viewMode === 'split'

  const toggleFold = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }, [])

  // Fold long unchanged runs, then budget the lines that remain visible. The
  // segmentation runs on raw diff lines so it is identical in both view modes —
  // expanded folds survive a split ⇄ inline switch.
  const { nodes, elided } = useMemo(() => {
    const out: DiffNode[] = []
    let left = MAX_RENDERED_LINES
    let dropped = 0
    // A whole-file diff arrives as a single hunk covering the file; its
    // `@@ -1,300 +1,305 @@` header carries nothing the fold bars don't.
    const showHunkHeaders = file.hunks.length > 1
    file.hunks.forEach((hunk, hunkIndex) => {
      if (showHunkHeaders) out.push({ kind: 'hunk', key: `h${hunkIndex}`, header: hunk.header })
      const segments = buildCollapsibleSegments(hunk.lines, (line) => line.type === 'context')
      segments.forEach((segment, segIndex) => {
        const key = `s${hunkIndex}-${segIndex}`
        if (segment.collapsed) {
          out.push({ kind: 'fold', key, lines: segment.items })
          return
        }
        const lines = segment.items.slice(0, Math.max(left, 0))
        dropped += segment.items.length - lines.length
        left -= lines.length
        if (lines.length > 0) out.push({ kind: 'lines', key, lines })
      })
    })
    return { nodes: out, elided: dropped }
  }, [file.hunks])

  const bar = (
    key: string,
    content: React.ReactNode,
    extra?: React.CSSProperties,
    onClick?: () => void
  ): React.ReactNode => (
    <div
      key={key}
      onClick={onClick}
      style={{
        gridColumn: isSplit ? '1 / -1' : undefined,
        padding: '2px 10px',
        background: colors.hunkBg,
        color: colors.hunkText,
        whiteSpace: 'pre-wrap',
        cursor: onClick ? 'pointer' : undefined,
        userSelect: onClick ? 'none' : undefined,
        ...extra
      }}
    >
      {content}
    </div>
  )

  const renderLines = (key: string, lines: DiffLine[]): React.ReactNode[] =>
    isSplit
      ? buildSideBySideRows(lines).map((row, i) => (
          <React.Fragment key={`${key}-${i}`}>
            <SplitCell line={row.left} side="left" colors={colors} textColor={token.colorText} />
            <span style={{ background: colors.border }} />
            <SplitCell line={row.right} side="right" colors={colors} textColor={token.colorText} />
          </React.Fragment>
        ))
      : lines.map((line, i) => (
          <InlineRow key={`${key}-${i}`} line={line} colors={colors} textColor={token.colorText} />
        ))

  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 6, overflow: 'hidden' }}>
      {showHeader && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            background: colors.headerBg,
            borderBottom: `1px solid ${colors.border}`,
            fontFamily: MONO_FONT_STACK,
            fontSize: 12,
            color: token.colorText
          }}
        >
          <FileOutlined style={{ color: token.colorTextTertiary }} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {file.oldPath && file.status === 'renamed' ? `${file.oldPath} → ${file.path}` : file.path}
          </span>
          {file.additions > 0 && <span style={{ color: colors.markerAdd }}>+{file.additions}</span>}
          {file.deletions > 0 && <span style={{ color: colors.markerDel }}>-{file.deletions}</span>}
        </div>
      )}
      {file.unviewable ? (
        <div
          style={{
            padding: '18px 12px',
            textAlign: 'center',
            fontSize: 12,
            color: token.colorTextTertiary
          }}
        >
          {t(UNVIEWABLE_KEYS[file.unviewable])}
        </div>
      ) : (
        <div
          style={{
            // Both modes share one grid/flex column layout: in split view the
            // 1px divider is its own grid track, so it stays dead-centre no
            // matter how long the code on either side is.
            display: isSplit ? 'grid' : 'flex',
            gridTemplateColumns: isSplit ? 'minmax(0, 1fr) 1px minmax(0, 1fr)' : undefined,
            flexDirection: isSplit ? undefined : 'column',
            fontFamily: MONO_FONT_STACK,
            fontSize: 12,
            lineHeight: '20px'
          }}
        >
          {nodes.map((node) => {
            if (node.kind === 'hunk') return bar(node.key, node.header)
            if (node.kind === 'lines') return renderLines(node.key, node.lines)
            const isOpen = expanded.has(node.key)
            const shown = isOpen ? node.lines.slice(0, MAX_EXPANDED_LINES) : []
            return [
              bar(
                node.key,
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                  {isOpen ? <UpOutlined style={{ fontSize: 10 }} /> : <DownOutlined style={{ fontSize: 10 }} />}
                  {isOpen ? t('coding.diffCollapseLines') : t('coding.diffExpandLines', node.lines.length)}
                </span>,
                { textAlign: 'center' },
                () => toggleFold(node.key)
              ),
              ...renderLines(node.key, shown),
              shown.length < node.lines.length && isOpen
                ? bar(`${node.key}-cap`, t('coding.diffLinesElided', node.lines.length - shown.length), {
                    textAlign: 'center'
                  })
                : null
            ]
          })}
          {elided > 0 &&
            bar('elided', t('coding.diffLinesElided', elided), { padding: '8px 10px', textAlign: 'center' })}
        </div>
      )}
    </div>
  )
}

const GUTTER_WIDTH = 46

function rowBackground(type: DiffLine['type'], colors: Colors): string | undefined {
  if (type === 'add') return colors.addBg
  if (type === 'del') return colors.delBg
  return undefined
}

function gutterBackground(type: DiffLine['type'], colors: Colors): string | undefined {
  if (type === 'add') return colors.addGutterBg
  if (type === 'del') return colors.delGutterBg
  return undefined
}

const gutterStyle = (colors: Colors, type?: DiffLine['type']): React.CSSProperties => ({
  width: GUTTER_WIDTH,
  flexShrink: 0,
  textAlign: 'right',
  padding: '0 8px',
  color: colors.gutterText,
  background: type ? gutterBackground(type, colors) : undefined,
  userSelect: 'none'
})

// Long lines soft-wrap (GitHub's behaviour) instead of forcing a horizontal
// scroller: with wrapping, both halves of a split row keep the same height and
// the column widths never depend on the content.
const codeStyle: React.CSSProperties = {
  flex: 1,
  padding: '0 8px 0 4px',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  minWidth: 0
}

const InlineRow: React.FC<{ line: DiffLine; colors: Colors; textColor: string }> = ({
  line,
  colors,
  textColor
}) => (
  <div style={{ display: 'flex', background: rowBackground(line.type, colors), color: textColor }}>
    <span style={gutterStyle(colors, line.type)}>{line.oldNumber ?? ''}</span>
    <span style={gutterStyle(colors, line.type)}>{line.newNumber ?? ''}</span>
    <span
      style={{
        width: 16,
        flexShrink: 0,
        textAlign: 'center',
        userSelect: 'none',
        color: line.type === 'add' ? colors.markerAdd : line.type === 'del' ? colors.markerDel : colors.gutterText
      }}
    >
      {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ''}
    </span>
    <span style={codeStyle}>{line.content || ' '}</span>
  </div>
)

/** One half of a split row — a direct grid child, so its width is the track's. */
const SplitCell: React.FC<{
  line?: DiffLine
  side: 'left' | 'right'
  colors: Colors
  textColor: string
}> = ({ line, side, colors, textColor }) => {
  const number = line ? (side === 'left' ? line.oldNumber : line.newNumber) : undefined
  return (
    <div
      style={{
        display: 'flex',
        minWidth: 0,
        color: textColor,
        background: line ? rowBackground(line.type, colors) : colors.emptyBg
      }}
    >
      <span style={gutterStyle(colors, line?.type)}>{number ?? ''}</span>
      <span style={codeStyle}>{line ? line.content || ' ' : ' '}</span>
    </div>
  )
}

export default DiffViewerModal
