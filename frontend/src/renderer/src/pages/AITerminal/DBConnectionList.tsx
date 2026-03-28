import React, { useCallback, useState } from 'react'
import { Typography, Button, Tooltip, App, Dropdown, theme } from 'antd'
import {
  PlusOutlined, DatabaseOutlined, TableOutlined,
  DeleteOutlined, EditOutlined, ApiOutlined, DisconnectOutlined,
  CodeOutlined, ReloadOutlined, RightOutlined, DownOutlined,
  LoadingOutlined, HddOutlined
} from '@ant-design/icons'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import { useT } from '../../i18n'
import type { DBConnection } from '../../types/ai-terminal'

const { Text } = Typography

const DB_TYPE_LABELS: Record<string, string> = {
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  mongodb: 'MongoDB',
  sqlite: 'SQLite'
}

const DB_TYPE_COLORS: Record<string, string> = {
  mysql: '#00758F',
  postgres: '#336791',
  mongodb: '#47A248',
  sqlite: '#003B57'
}

interface Props {
  onNew: () => void
  onEdit: (conn: DBConnection) => void
}

const DBConnectionList: React.FC<Props> = ({ onNew, onEdit }) => {
  const { token } = theme.useToken()
  const { modal, message } = App.useApp()
  const t = useT()
  const {
    dbConnections, dbConnectionStatus, dbTables, dbDatabases, dbSelectedDatabase,
    connectDB, disconnectDB, deleteDBConnection,
    openDBTable, openDBQuery, fetchDBTables, fetchDBDatabases, useDBDatabase
  } = useAITerminalStore()

  // Expanded state: connections and databases
  const [expandedConns, setExpandedConns] = useState<Set<string>>(new Set())
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set())

  const toggleExpandConn = useCallback((connId: string) => {
    setExpandedConns(prev => {
      const next = new Set(prev)
      if (next.has(connId)) {
        next.delete(connId)
      } else {
        next.add(connId)
        fetchDBDatabases(connId)
      }
      return next
    })
  }, [fetchDBDatabases])

  const toggleExpandDb = useCallback((connId: string, dbName: string) => {
    const key = `${connId}:${dbName}`
    setExpandedDbs(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
        // Switch to this database and fetch tables
        useDBDatabase(connId, dbName).catch(err => {
          message.error(t('terminal.switchDBFailed', err.message || String(err)))
        })
      }
      return next
    })
  }, [useDBDatabase, message])

  const handleConnect = useCallback(async (conn: DBConnection) => {
    const result = await connectDB(conn.id)
    if (result.success) {
      message.success(t('terminal.connected', conn.name))
      setExpandedConns(prev => new Set(prev).add(conn.id))
    } else {
      message.error(t('terminal.connectFailed', result.error || ''))
    }
  }, [connectDB, message])

  const handleDisconnect = useCallback(async (conn: DBConnection) => {
    await disconnectDB(conn.id)
    message.info(t('terminal.disconnected', conn.name))
    setExpandedConns(prev => {
      const next = new Set(prev)
      next.delete(conn.id)
      return next
    })
  }, [disconnectDB, message])

  const handleDelete = useCallback((conn: DBConnection) => {
    modal.confirm({
      title: t('terminal.deleteConn'),
      content: t('terminal.deleteConnConfirm', conn.name),
      okType: 'danger',
      onOk: () => deleteDBConnection(conn.id)
    })
  }, [modal, deleteDBConnection])

  const handleTableClick = useCallback((connId: string, tableName: string) => {
    openDBTable(connId, tableName)
  }, [openDBTable])

  const handleOpenQuery = useCallback((connId: string) => {
    openDBQuery(connId)
  }, [openDBQuery])

  // Group connections by type
  const grouped = dbConnections.reduce<Record<string, DBConnection[]>>((acc, conn) => {
    const key = conn.type
    if (!acc[key]) acc[key] = []
    acc[key].push(conn)
    return acc
  }, {})

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* DB connections card */}
      <div style={{
        background: token.colorBgLayout,
        borderRadius: token.borderRadiusSM,
        margin: '3px 4px',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Header + Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '2px 10px',
          background: token.colorFillQuaternary,
          borderRadius: `${token.borderRadiusSM}px ${token.borderRadiusSM}px 0 0`
        }}>
          <Text strong style={{ fontSize: 11, color: token.colorTextTertiary }}>{t('terminal.dbConnections')}</Text>
          <Tooltip title={t('terminal.newDBConnTooltip')}>
            <Button type="text" size="small" icon={<PlusOutlined style={{ fontSize: 11 }} />} onClick={onNew} style={{ width: 22, height: 22 }} />
          </Tooltip>
        </div>

        {/* Connection list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 4px 4px' }}>
        {dbConnections.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: token.colorTextTertiary, fontSize: 12 }}>
            {t('terminal.noDBConnections')}
          </div>
        ) : (
          Object.entries(grouped).map(([type, conns]) => (
            <div key={type} style={{ marginBottom: 8 }}>
              <Text style={{
                fontSize: 11, color: token.colorTextTertiary,
                padding: '0 10px', display: 'block', marginBottom: 2
              }}>
                {DB_TYPE_LABELS[type] || type}
              </Text>
              {conns.map(conn => {
                const status = dbConnectionStatus[conn.id] || 'disconnected'
                const isConnected = status === 'connected'
                const isTesting = status === 'testing'
                const databases = dbDatabases[conn.id] || []
                const selectedDb = dbSelectedDatabase[conn.id]
                const tables = dbTables[conn.id] || []
                const isExpanded = expandedConns.has(conn.id) && isConnected
                const isSingleDbType = conn.type === 'sqlite'

                return (
                  <div key={conn.id}>
                    {/* Connection row */}
                    <Dropdown
                      trigger={['contextMenu']}
                      menu={{
                        items: [
                          isConnected
                            ? { key: 'disconnect', label: t('terminal.disconnect'), icon: <DisconnectOutlined /> }
                            : { key: 'connect', label: t('terminal.connect'), icon: <ApiOutlined /> },
                          isConnected
                            ? { key: 'query', label: t('terminal.openQuery'), icon: <CodeOutlined /> }
                            : null,
                          isConnected
                            ? { key: 'refresh', label: t('terminal.refresh'), icon: <ReloadOutlined /> }
                            : null,
                          { key: 'edit', label: t('terminal.edit'), icon: <EditOutlined /> },
                          { key: 'delete', label: t('common.delete'), icon: <DeleteOutlined />, danger: true }
                        ].filter(Boolean) as any[],
                        onClick: ({ key }) => {
                          if (key === 'connect') handleConnect(conn)
                          else if (key === 'disconnect') handleDisconnect(conn)
                          else if (key === 'query') handleOpenQuery(conn.id)
                          else if (key === 'refresh') fetchDBDatabases(conn.id)
                          else if (key === 'edit') onEdit(conn)
                          else if (key === 'delete') handleDelete(conn)
                        }
                      }}
                    >
                      <div
                        onClick={() => {
                          if (isConnected) {
                            toggleExpandConn(conn.id)
                          } else {
                            handleConnect(conn)
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          cursor: 'pointer',
                          borderRadius: token.borderRadiusSM,
                          fontSize: 12
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = token.colorFillTertiary }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                          <span style={{ width: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {isTesting ? (
                              <LoadingOutlined style={{ fontSize: 10, color: token.colorWarning }} />
                            ) : isConnected ? (
                              isExpanded
                                ? <DownOutlined style={{ fontSize: 9, color: token.colorTextSecondary }} />
                                : <RightOutlined style={{ fontSize: 9, color: token.colorTextSecondary }} />
                            ) : null}
                          </span>
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                            background: isConnected ? token.colorSuccess
                              : isTesting ? token.colorWarning
                              : token.colorTextDisabled
                          }} />
                          <DatabaseOutlined style={{ color: DB_TYPE_COLORS[conn.type] || token.colorTextSecondary, flexShrink: 0 }} />
                          <div style={{ overflow: 'hidden' }}>
                            <Text ellipsis style={{ fontSize: 12, display: 'block' }}>{conn.name}</Text>
                            <Text ellipsis type="secondary" style={{ fontSize: 10, display: 'block' }}>
                              {conn.type === 'sqlite'
                                ? (conn.filePath || ':memory:')
                                : `${conn.host || 'localhost'}:${conn.port || ''}`
                              }
                            </Text>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                          {isConnected && (
                            <Tooltip title={t('terminal.sqlQuery')}>
                              <Button
                                type="text" size="small" icon={<CodeOutlined style={{ fontSize: 11 }} />}
                                onClick={() => handleOpenQuery(conn.id)}
                                style={{ width: 22, height: 22 }}
                              />
                            </Tooltip>
                          )}
                          <Button
                            type="text" size="small" danger icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                            onClick={() => handleDelete(conn)}
                            style={{ width: 22, height: 22 }}
                          />
                        </div>
                      </div>
                    </Dropdown>

                    {/* Level 2: Databases (or tables directly for sqlite) */}
                    {isExpanded && (
                      <div style={{ paddingLeft: 20 }}>
                        {isSingleDbType ? (
                          /* SQLite: show tables directly */
                          tables.length === 0 ? (
                            <Text type="secondary" style={{ fontSize: 11, paddingLeft: 16, display: 'block', padding: '2px 16px' }}>{t('terminal.noTables')}</Text>
                          ) : (
                            tables.map(table => (
                              <div
                                key={table}
                                onClick={() => handleTableClick(conn.id, table)}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 4,
                                  padding: '3px 8px', cursor: 'pointer',
                                  borderRadius: token.borderRadiusSM, fontSize: 11
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = token.colorFillTertiary }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
                              >
                                <TableOutlined style={{ fontSize: 10, color: token.colorTextTertiary }} />
                                <Text ellipsis style={{ fontSize: 11 }}>{table}</Text>
                              </div>
                            ))
                          )
                        ) : (
                          /* MySQL/PG/Mongo: show databases list */
                          databases.length === 0 ? (
                            <Text type="secondary" style={{ fontSize: 11, display: 'block', padding: '2px 16px' }}>{t('terminal.noDatabases')}</Text>
                          ) : (
                            databases.map(dbName => {
                              const dbKey = `${conn.id}:${dbName}`
                              const isDbExpanded = expandedDbs.has(dbKey)
                              const isSelected = selectedDb === dbName

                              return (
                                <div key={dbName}>
                                  {/* Database row */}
                                  <div
                                    onClick={() => toggleExpandDb(conn.id, dbName)}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 4,
                                      padding: '3px 8px', cursor: 'pointer',
                                      borderRadius: token.borderRadiusSM, fontSize: 11,
                                      background: isSelected ? token.colorPrimaryBg : undefined
                                    }}
                                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = token.colorFillTertiary }}
                                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = '' }}
                                  >
                                    <span style={{ width: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                      {isDbExpanded
                                        ? <DownOutlined style={{ fontSize: 8, color: token.colorTextSecondary }} />
                                        : <RightOutlined style={{ fontSize: 8, color: token.colorTextSecondary }} />
                                      }
                                    </span>
                                    <HddOutlined style={{ fontSize: 11, color: token.colorTextSecondary }} />
                                    <Text ellipsis style={{ fontSize: 11, fontWeight: isSelected ? 500 : 400 }}>{dbName}</Text>
                                  </div>

                                  {/* Level 3: Tables under selected database */}
                                  {isDbExpanded && isSelected && (
                                    <div style={{ paddingLeft: 20 }}>
                                      {tables.length === 0 ? (
                                        <Text type="secondary" style={{ fontSize: 11, display: 'block', padding: '2px 8px' }}>{t('terminal.noTables')}</Text>
                                      ) : (
                                        tables.map(table => (
                                          <div
                                            key={table}
                                            onClick={() => handleTableClick(conn.id, table)}
                                            style={{
                                              display: 'flex', alignItems: 'center', gap: 4,
                                              padding: '3px 8px', cursor: 'pointer',
                                              borderRadius: token.borderRadiusSM, fontSize: 11
                                            }}
                                            onMouseEnter={(e) => { e.currentTarget.style.background = token.colorFillTertiary }}
                                            onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
                                          >
                                            <TableOutlined style={{ fontSize: 10, color: token.colorTextTertiary }} />
                                            <Text ellipsis style={{ fontSize: 11 }}>{table}</Text>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  )}
                                </div>
                              )
                            })
                          )
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))
        )}
        </div>
      </div>
    </div>
  )
}

export default DBConnectionList
