import React, { useMemo } from 'react'
import { Collapse, Typography, Tag, Empty, Badge, theme } from 'antd'
import {
  ExclamationCircleOutlined,
  WarningOutlined,
  CheckCircleOutlined
} from '@ant-design/icons'
import { useCopiperStore } from '../../stores/useCopiperStore'
import type { ValidationIssue } from '../../types/copiper'

const { Text } = Typography

interface ValidationPanelProps {
  onIssueClick?: (tableName: string, rowIndex: number, columnName?: string) => void
}

const ValidationPanel: React.FC<ValidationPanelProps> = ({ onIssueClick }) => {
  const { token } = theme.useToken()
  const validationIssues = useCopiperStore((s) => s.validationIssues)

  const errorCount = useMemo(
    () => validationIssues.filter((i) => i.level === 'error').length,
    [validationIssues]
  )

  const warningCount = useMemo(
    () => validationIssues.filter((i) => i.level === 'warning').length,
    [validationIssues]
  )

  const groupedIssues = useMemo(() => {
    const groups: Record<string, ValidationIssue[]> = {}
    for (const issue of validationIssues) {
      if (!groups[issue.tableName]) groups[issue.tableName] = []
      groups[issue.tableName].push(issue)
    }
    return groups
  }, [validationIssues])

  if (validationIssues.length === 0) {
    return (
      <div
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: token.colorBgContainer,
          borderRadius: 6,
          border: `1px solid ${token.colorBorderSecondary}`
        }}
      >
        <CheckCircleOutlined style={{ color: token.colorSuccess }} />
        <Text type="secondary">No validation issues</Text>
      </div>
    )
  }

  const summaryText = [
    errorCount > 0 ? `${errorCount} error${errorCount > 1 ? 's' : ''}` : '',
    warningCount > 0 ? `${warningCount} warning${warningCount > 1 ? 's' : ''}` : ''
  ]
    .filter(Boolean)
    .join(', ')

  const collapseItems = Object.entries(groupedIssues).map(([tableName, issues]) => {
    const tableErrors = issues.filter((i) => i.level === 'error').length
    const tableWarnings = issues.filter((i) => i.level === 'warning').length

    return {
      key: tableName,
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text strong>{tableName}</Text>
          {tableErrors > 0 && <Badge count={tableErrors} color={token.colorError} size="small" />}
          {tableWarnings > 0 && <Badge count={tableWarnings} color={token.colorWarning} size="small" />}
        </span>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {issues.map((issue, idx) => (
            <div
              key={idx}
              onClick={() => onIssueClick?.(issue.tableName, issue.rowIndex, issue.columnName)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '4px 8px',
                borderRadius: 4,
                cursor: onIssueClick ? 'pointer' : 'default',
                transition: 'background 0.15s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = token.colorBgTextHover
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              {issue.level === 'error' ? (
                <ExclamationCircleOutlined style={{ color: token.colorError, marginTop: 2 }} />
              ) : (
                <WarningOutlined style={{ color: token.colorWarning, marginTop: 2 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {issue.rowIndex >= 0 && (
                    <Tag style={{ margin: 0, fontSize: 11 }}>Row {issue.rowIndex + 1}</Tag>
                  )}
                  {issue.columnName && (
                    <Tag style={{ margin: 0, fontSize: 11 }}>{issue.columnName}</Tag>
                  )}
                </div>
                <Text style={{ fontSize: 12 }}>{issue.message}</Text>
              </div>
            </div>
          ))}
        </div>
      )
    }
  })

  return (
    <div>
      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>{summaryText}</Text>
      </div>
      <Collapse
        size="small"
        items={collapseItems}
        defaultActiveKey={Object.keys(groupedIssues)}
      />
    </div>
  )
}

export default ValidationPanel
