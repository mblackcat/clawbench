import React, { useEffect, useRef, useState } from 'react'
import { Input, Button, Tooltip, theme, type InputRef } from 'antd'
import { UpOutlined, DownOutlined, CloseOutlined } from '@ant-design/icons'
import { useT } from '../i18n'

interface TerminalSearchBarProps {
  /** Match index / total, published by the xterm search addon. */
  results: { resultIndex: number; resultCount: number }
  onFindNext: (query: string) => void
  onFindPrevious: (query: string) => void
  onClose: () => void
}

/**
 * Floating find bar for xterm surfaces, styled after the VS Code terminal one.
 * Sits above the terminal via absolute positioning so it never participates in
 * the grid measurement that FitAddon does.
 */
const TerminalSearchBar: React.FC<TerminalSearchBarProps> = ({
  results, onFindNext, onFindPrevious, onClose
}) => {
  const t = useT()
  const { token } = theme.useToken()
  const [query, setQuery] = useState('')
  const inputRef = useRef<InputRef>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Incremental search as the user types.
  useEffect(() => {
    onFindNext(query)
    // onFindNext is stable (useCallback in useXterm)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const label = results.resultCount === 0
    ? (query ? t('terminal.searchNoResults') : '')
    : `${results.resultIndex + 1}/${results.resultCount}`

  return (
    <div
      style={{
        position: 'absolute',
        top: 6,
        right: 14,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 6px',
        borderRadius: token.borderRadius,
        background: token.colorBgElevated,
        border: `1px solid ${token.colorBorder}`,
        boxShadow: token.boxShadowSecondary
      }}
      // Keep clicks inside the bar from reaching the terminal's focus handling.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Input
        ref={inputRef}
        size="small"
        value={query}
        placeholder={t('terminal.search')}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) onFindPrevious(query)
            else onFindNext(query)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
        style={{ width: 180 }}
      />
      <span style={{ fontSize: 11, color: token.colorTextSecondary, minWidth: 42, textAlign: 'center' }}>
        {label}
      </span>
      <Tooltip title={t('terminal.searchPrevious')}>
        <Button size="small" type="text" icon={<UpOutlined />} onClick={() => onFindPrevious(query)} />
      </Tooltip>
      <Tooltip title={t('terminal.searchNext')}>
        <Button size="small" type="text" icon={<DownOutlined />} onClick={() => onFindNext(query)} />
      </Tooltip>
      <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClose} />
    </div>
  )
}

export default TerminalSearchBar
