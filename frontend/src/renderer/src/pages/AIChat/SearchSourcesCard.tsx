import React from 'react'
import { theme } from 'antd'
import { LinkOutlined } from '@ant-design/icons'
import type { SearchSource } from '../../types/chat'
import { useT } from '../../i18n'

interface SearchSourcesCardProps {
  sources: SearchSource[]
}

const SearchSourcesCard: React.FC<SearchSourcesCardProps> = ({ sources }) => {
  const { token } = theme.useToken()
  const t = useT()

  if (sources.length === 0) return null

  const getDomain = (url: string): string => {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return url
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: token.colorTextSecondary, marginBottom: 6 }}>
        {t('chat.searchSources')}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {sources.map((source, idx) => (
          <a
            key={idx}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.snippet || source.url}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 6,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgElevated,
              textDecoration: 'none',
              maxWidth: 240,
              cursor: 'pointer',
              transition: 'border-color 0.2s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = token.colorPrimary
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = token.colorBorderSecondary
            }}
          >
            <LinkOutlined style={{ fontSize: 11, color: token.colorPrimary, flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{
                fontSize: 12,
                color: token.colorText,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                lineHeight: '16px',
              }}>
                {source.title || getDomain(source.url)}
              </div>
              <div style={{
                fontSize: 10,
                color: token.colorTextTertiary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                lineHeight: '14px',
              }}>
                {getDomain(source.url)}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

export default SearchSourcesCard
