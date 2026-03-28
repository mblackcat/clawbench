import React, { useState } from 'react'
import { Dropdown, Modal, Input, App, theme, Tag } from 'antd'
import {
  MoreOutlined,
  StarOutlined,
  StarFilled,
  EditOutlined,
  ExportOutlined,
  DeleteOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useChatStore } from '../../stores/useChatStore'
import type { Conversation } from '../../types/chat'
import { ProviderIcon, guessProviderFromModelId } from '../../components/ProviderIcons'
import { useT } from '../../i18n'

interface ChatSidebarItemProps {
  conversation: Conversation
  isActive: boolean
  isLocal?: boolean
  onClick: () => void
}

const ChatSidebarItem: React.FC<ChatSidebarItemProps> = ({ conversation, isActive, isLocal, onClick }) => {
  const t = useT()
  const { message, modal } = App.useApp()
  const { token } = theme.useToken()
  const { renameConversation, toggleFavorite, deleteConversation, exportConversation } = useChatStore()
  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [hovering, setHovering] = useState(false)

  const handleRename = async () => {
    if (newTitle.trim()) {
      await renameConversation(conversation.conversationId, newTitle.trim())
      message.success(t('chat.renameSuccess'))
    }
    setRenameModalOpen(false)
  }

  const menuItems: MenuProps['items'] = [
    {
      key: 'favorite',
      icon: conversation.favorited ? <StarFilled style={{ color: token.colorWarning }} /> : <StarOutlined />,
      label: conversation.favorited ? t('chat.unfavorite') : t('chat.favorite'),
      onClick: (e) => { e.domEvent.stopPropagation(); toggleFavorite(conversation.conversationId) },
    },
    {
      key: 'rename',
      icon: <EditOutlined />,
      label: t('chat.rename'),
      onClick: (e) => { e.domEvent.stopPropagation(); setNewTitle(conversation.title); setRenameModalOpen(true) },
    },
    {
      key: 'export',
      icon: <ExportOutlined />,
      label: t('chat.export'),
      children: [
        { key: 'export-md', label: 'Markdown', onClick: (e) => { e.domEvent.stopPropagation(); exportConversation(conversation.conversationId, 'markdown') } },
        { key: 'export-json', label: 'JSON', onClick: (e) => { e.domEvent.stopPropagation(); exportConversation(conversation.conversationId, 'json') } },
      ],
    },
    { type: 'divider' },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: t('chat.delete'),
      danger: true,
      onClick: (e) => {
        e.domEvent.stopPropagation()
        modal.confirm({
          title: t('chat.confirmDelete'),
          content: t('chat.deleteConfirmContent'),
          okText: t('chat.delete'),
          okType: 'danger',
          cancelText: t('common.cancel'),
          onOk: () => deleteConversation(conversation.conversationId),
        })
      },
    },
  ]

  return (
    <>
      <div
        onClick={onClick}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        style={{
          padding: '8px 12px',
          cursor: 'pointer',
          borderRadius: 6,
          background: isActive ? token.colorPrimaryBg : hovering ? token.colorFillTertiary : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          transition: 'background 0.2s',
          marginBottom: 2,
        }}
      >
        <div style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 13,
          color: isActive ? token.colorPrimary : token.colorText,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}>
          {conversation.favorited && <StarFilled style={{ color: token.colorWarning, fontSize: 11, flexShrink: 0 }} />}
          {isLocal && <Tag style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0, flexShrink: 0 }}>{t('chat.local')}</Tag>}
          <ProviderIcon provider={guessProviderFromModelId(conversation.modelId || '')} size={13} style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {conversation.title}
          </span>
        </div>
        {(hovering || isActive) && (
          <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
            <MoreOutlined
              onClick={e => e.stopPropagation()}
              style={{ fontSize: 14, padding: '2px 4px', color: token.colorTextSecondary }}
            />
          </Dropdown>
        )}
      </div>
      <Modal
        title={t('chat.renameDialog')}
        open={renameModalOpen}
        onOk={handleRename}
        onCancel={() => setRenameModalOpen(false)}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
      >
        <Input
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onPressEnter={handleRename}
          placeholder={t('chat.renamePlaceholder')}
          autoFocus
        />
      </Modal>
    </>
  )
}

export default ChatSidebarItem
