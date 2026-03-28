import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Button, Typography, theme, Tooltip } from 'antd'
import { PlusOutlined, MenuFoldOutlined, MenuUnfoldOutlined, ScheduleOutlined } from '@ant-design/icons'
import ChatSidebarItem from './ChatSidebarItem'
import { useChatStore } from '../../stores/useChatStore'
import { useAuthStore } from '../../stores/useAuthStore'
import { useScheduledTaskStore } from '../../stores/useScheduledTaskStore'
import { useT } from '../../i18n'

const { Text } = Typography

const ChatSidebar: React.FC = () => {
  const t = useT()
  const { token } = theme.useToken()
  const [collapsed, setCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const isResizing = useRef(false)
  const isLocalMode = useAuthStore((s) => s.isLocalMode)
  const {
    favConversations, favHasMore,
    conversations, hasMore,
    activeConversationId,
    fetchFavConversations, loadMoreFavConversations,
    fetchConversations, loadMoreConversations,
    createConversation, selectConversation,
  } = useChatStore()

  useEffect(() => {
    fetchFavConversations()
    fetchConversations()
  }, [fetchFavConversations, fetchConversations])

  const { mainView, setMainView } = useScheduledTaskStore()

  const handleNewChat = () => {
    setMainView('chat')
    createConversation()
  }

  const handleTaskClick = () => {
    setMainView(mainView === 'task' ? 'chat' : 'task')
  }

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isResizing.current = true
      e.preventDefault()
      const startX = e.clientX
      const startWidth = sidebarWidth
      const onMouseMove = (me: MouseEvent): void => {
        const newWidth = Math.min(480, Math.max(160, startWidth + me.clientX - startX))
        setSidebarWidth(newWidth)
      }
      const onMouseUp = (): void => {
        isResizing.current = false
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [sidebarWidth]
  )

  return (
    <div
      style={{
        width: collapsed ? 44 : sidebarWidth,
        minWidth: collapsed ? 44 : 160,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        transition: 'width 0.2s ease, min-width 0.2s ease',
        overflow: 'hidden',
        borderRight: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        position: 'relative',
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div style={{ padding: '10px 8px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {!collapsed && (
          <div style={{ flex: 1, display: 'flex', gap: 6, minWidth: 0 }}>
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={handleNewChat}
              style={{ flex: 1, minWidth: 0 }}
            >
              {t('chat.newChat')}
            </Button>
            <Button
              type={mainView === 'task' ? 'primary' : 'dashed'}
              icon={<ScheduleOutlined />}
              onClick={handleTaskClick}
              style={{ flex: 1, minWidth: 0 }}
            >
              {t('task.title')}
            </Button>
          </div>
        )}
        <Tooltip title={collapsed ? t('common.expandSidebar') : t('common.collapseSidebar')} placement="right">
          <Button
            type="text"
            size="small"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((v) => !v)}
            style={{ flexShrink: 0 }}
          />
        </Tooltip>
      </div>

      {/* Collapsed: quick buttons */}
      {collapsed && (
        <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Tooltip title={t('chat.newChat')} placement="right">
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={handleNewChat}
              style={{ width: '100%', padding: 0 }}
            />
          </Tooltip>
          <Tooltip title={t('task.title')} placement="right">
            <Button
              type={mainView === 'task' ? 'primary' : 'dashed'}
              icon={<ScheduleOutlined />}
              onClick={handleTaskClick}
              style={{ width: '100%', padding: 0 }}
            />
          </Tooltip>
        </div>
      )}

      {/* Conversation list */}
      {!collapsed && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {favConversations.length > 0 && (
            <div style={{
              background: token.colorBgLayout,
              borderRadius: token.borderRadiusSM,
              margin: '3px 4px',
              overflow: 'hidden'
            }}>
              <div style={{ padding: '2px 10px' }}>
                <Text strong style={{ fontSize: 11, color: token.colorTextTertiary }}>{t('chat.favChats')}</Text>
              </div>
              <div style={{ maxHeight: 240, overflowY: 'auto', padding: '0 4px 4px' }}>
                {favConversations.map(conv => (
                  <ChatSidebarItem
                    key={conv.conversationId}
                    conversation={conv}
                    isActive={conv.conversationId === activeConversationId}
                    isLocal={isLocalMode}
                    onClick={() => { setMainView('chat'); selectConversation(conv.conversationId) }}
                  />
                ))}
                {favHasMore && (
                  <Button type="link" size="small" block onClick={loadMoreFavConversations}>
                    {t('chat.loadMore')}
                  </Button>
                )}
              </div>
            </div>
          )}
          <div style={{
            background: token.colorBgLayout,
            borderRadius: token.borderRadiusSM,
            margin: '3px 4px',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '2px 10px' }}>
              <Text strong style={{ fontSize: 11, color: token.colorTextTertiary }}>{t('chat.history')}</Text>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 4px 4px' }}>
              {conversations.map(conv => (
                <ChatSidebarItem
                  key={conv.conversationId}
                  conversation={conv}
                  isActive={conv.conversationId === activeConversationId}
                  isLocal={isLocalMode}
                  onClick={() => { setMainView('chat'); selectConversation(conv.conversationId) }}
                />
              ))}
              {hasMore && (
                <Button type="link" size="small" block onClick={loadMoreConversations}>
                  {t('chat.loadMore')}
                </Button>
              )}
              {conversations.length === 0 && favConversations.length === 0 && (
                <div style={{ textAlign: 'center', padding: 16, color: token.colorTextDisabled, fontSize: 12 }}>
                  {t('chat.noHistory')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Resize handle */}
      {!collapsed && (
        <div
          onMouseDown={handleMouseDown}
          style={{
            width: 4,
            cursor: 'col-resize',
            background: 'transparent',
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            zIndex: 10
          }}
          onMouseEnter={(e) =>
            ((e.target as HTMLElement).style.background = token.colorPrimaryBg)
          }
          onMouseLeave={(e) => {
            if (!isResizing.current)
              (e.target as HTMLElement).style.background = 'transparent'
          }}
        />
      )}
    </div>
  )
}

export default ChatSidebar
