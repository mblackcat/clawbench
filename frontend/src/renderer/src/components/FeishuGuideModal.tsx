import React, { useState } from 'react'
import { Modal, Typography, Tabs, App, theme } from 'antd'
import { CopyOutlined, CheckOutlined } from '@ant-design/icons'
import { useT } from '../i18n'

const { Title, Paragraph, Text, Link } = Typography

interface FeishuGuideModalProps {
  open: boolean
  onCancel: () => void
}

// ── Copyable code block ──

const CopyableCode: React.FC<{
  children: string
  inline?: boolean
  token: Record<string, any>
}> = ({ children, inline, token }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div style={{ position: 'relative', display: inline ? 'inline-block' : 'block', marginTop: inline ? 4 : 0 }}>
      <pre style={{
        backgroundColor: token.colorFillTertiary,
        padding: inline ? '8px 36px 8px 12px' : '12px 36px 12px 12px',
        borderRadius: token.borderRadiusSM,
        overflowX: 'auto',
        fontSize: '12px',
        color: token.colorText,
        border: `1px solid ${token.colorBorderSecondary}`,
        margin: 0
      }}>
        {children}
      </pre>
      <span
        onClick={handleCopy}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          cursor: 'pointer',
          color: copied ? token.colorSuccess : token.colorTextQuaternary,
          fontSize: 14,
          lineHeight: 1,
          transition: 'color 0.2s'
        }}
        title="Copy"
      >
        {copied ? <CheckOutlined /> : <CopyOutlined />}
      </span>
    </div>
  )
}

// ── No-approval scopes (免审批) ──
// Merged: IM bot scopes + feishu-cli no-approval scopes
const NO_APPROVAL_CONFIG = `{
  "scopes": {
    "tenant": [
      "board:whiteboard:node:create",
      "board:whiteboard:node:read",
      "board:whiteboard:node:update",
      "calendar:calendar.free_busy:read",
      "cardkit:card:read",
      "cardkit:card:write",
      "docs:document.comment:read",
      "docs:document.comment:write_only",
      "docs:permission.member:create",
      "docx:document.block:convert",
      "docx:document:create",
      "docx:document:readonly",
      "docx:document:write_only",
      "drive:drive.metadata:readonly",
      "drive:drive.search:readonly",
      "drive:drive:version:readonly",
      "im:app_feed_card:write",
      "im:chat.access_event.bot_p2p_chat:read",
      "im:chat.announcement:read",
      "im:chat.announcement:write_only",
      "im:chat.chat_pins:read",
      "im:chat.chat_pins:write_only",
      "im:chat.collab_plugins:read",
      "im:chat.collab_plugins:write_only",
      "im:chat.managers:write_only",
      "im:chat.members:bot_access",
      "im:chat.members:read",
      "im:chat.members:write_only",
      "im:chat.menu_tree:read",
      "im:chat.menu_tree:write_only",
      "im:chat.moderation:read",
      "im:chat.tabs:read",
      "im:chat.tabs:write_only",
      "im:chat.top_notice:write_only",
      "im:chat.widgets:read",
      "im:chat.widgets:write_only",
      "im:chat:create",
      "im:chat:delete",
      "im:chat:moderation:write_only",
      "im:chat:operate_as_owner",
      "im:chat:read",
      "im:chat:update",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.p2p_msg:readonly",
      "im:message.pins:read",
      "im:message.pins:write_only",
      "im:message.reactions:read",
      "im:message.reactions:write_only",
      "im:message:readonly",
      "im:message:recall",
      "im:message:send_as_bot",
      "im:message:send_multi_depts",
      "im:message:send_multi_users",
      "im:message:send_sys_msg",
      "im:message:update",
      "im:resource",
      "sheets:spreadsheet.meta:read",
      "sheets:spreadsheet.meta:write_only",
      "sheets:spreadsheet:create",
      "sheets:spreadsheet:read",
      "sheets:spreadsheet:write_only",
      "task:tasklist:read",
      "wiki:wiki:readonly"
    ],
    "user": [
      "cardkit:card:read",
      "cardkit:card:write",
      "im:message.pins:read",
      "im:message.pins:write_only",
      "im:message.reactions:read",
      "im:message.reactions:write_only",
      "im:message:readonly",
      "im:message:recall",
      "im:message:update"
    ]
  }
}`

// ── Full scopes including approval-required (需审批) ──
const FULL_CONFIG = `{
  "scopes": {
    "tenant": [
      "board:whiteboard:node:create",
      "board:whiteboard:node:delete",
      "board:whiteboard:node:read",
      "board:whiteboard:node:update",
      "calendar:calendar.acl:create",
      "calendar:calendar.acl:delete",
      "calendar:calendar.acl:read",
      "calendar:calendar.event:create",
      "calendar:calendar.event:delete",
      "calendar:calendar.event:read",
      "calendar:calendar.event:reply",
      "calendar:calendar.event:update",
      "calendar:calendar.free_busy:read",
      "calendar:calendar:create",
      "calendar:calendar:delete",
      "calendar:calendar:read",
      "calendar:calendar:subscribe",
      "calendar:calendar:update",
      "cardkit:card:read",
      "cardkit:card:write",
      "contact:contact.base:readonly",
      "contact:user.base:readonly",
      "docs:document.comment:create",
      "docs:document.comment:read",
      "docs:document.comment:update",
      "docs:document.comment:write_only",
      "docs:permission.member:create",
      "docx:document.block:convert",
      "docx:document:create",
      "docx:document:readonly",
      "docx:document:write_only",
      "drive:drive.metadata:readonly",
      "drive:drive.search:readonly",
      "drive:drive:version",
      "drive:drive:version:readonly",
      "im:app_feed_card:write",
      "im:chat.access_event.bot_p2p_chat:read",
      "im:chat.announcement:read",
      "im:chat.announcement:write_only",
      "im:chat.chat_pins:read",
      "im:chat.chat_pins:write_only",
      "im:chat.collab_plugins:read",
      "im:chat.collab_plugins:write_only",
      "im:chat.managers:write_only",
      "im:chat.members:bot_access",
      "im:chat.members:read",
      "im:chat.members:write_only",
      "im:chat.menu_tree:read",
      "im:chat.menu_tree:write_only",
      "im:chat.moderation:read",
      "im:chat.tabs:read",
      "im:chat.tabs:write_only",
      "im:chat.top_notice:write_only",
      "im:chat.widgets:read",
      "im:chat.widgets:write_only",
      "im:chat:create",
      "im:chat:delete",
      "im:chat:moderation:write_only",
      "im:chat:operate_as_owner",
      "im:chat:read",
      "im:chat:update",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.p2p_msg:readonly",
      "im:message.pins:read",
      "im:message.pins:write_only",
      "im:message.reactions:read",
      "im:message.reactions:write_only",
      "im:message:readonly",
      "im:message:recall",
      "im:message:send_as_bot",
      "im:message:send_multi_depts",
      "im:message:send_multi_users",
      "im:message:send_sys_msg",
      "im:message:update",
      "im:resource",
      "sheets:spreadsheet.meta:read",
      "sheets:spreadsheet.meta:write_only",
      "sheets:spreadsheet:create",
      "sheets:spreadsheet:read",
      "sheets:spreadsheet:write_only",
      "subscriptions:image",
      "task:task:read",
      "task:task:write",
      "task:tasklist:read",
      "task:tasklist:write",
      "wiki:member:create",
      "wiki:member:retrieve",
      "wiki:member:update",
      "wiki:wiki:readonly"
    ],
    "user": [
      "cardkit:card:read",
      "cardkit:card:write",
      "im:message.pins:read",
      "im:message.pins:write_only",
      "im:message.reactions:read",
      "im:message.reactions:write_only",
      "im:message:readonly",
      "im:message:recall",
      "im:message:update"
    ]
  }
}`

const FeishuGuideModal: React.FC<FeishuGuideModalProps> = ({ open, onCancel }) => {
  const { token } = theme.useToken()
  const t = useT()
  const [scopeTab, setScopeTab] = useState<string>('no-approval')

  return (
    <Modal
      title={t('feishuGuide.title')}
      open={open}
      onCancel={onCancel}
      footer={null}
      width={800}
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
    >
      <Typography>
        <Title level={5}>{t('feishuGuide.step1')}</Title>
        <Paragraph>
          {t('feishuGuide.step1Desc').split('{0}')[0]}
          <Link href="https://open.larkoffice.com/" target="_blank">https://open.larkoffice.com/</Link>
          {t('feishuGuide.step1Desc').split('{0}')[1]}
        </Paragraph>

        <Title level={5}>{t('feishuGuide.step2')}</Title>
        <Paragraph>
          {t('feishuGuide.step2Desc')}
        </Paragraph>
        <Tabs
          activeKey={scopeTab}
          onChange={setScopeTab}
          size="small"
          items={[
            {
              key: 'no-approval',
              label: t('feishuGuide.scopeTabNoApproval'),
              children: (
                <div>
                  <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                    {t('feishuGuide.scopeNoApprovalDesc')}
                  </Paragraph>
                  <CopyableCode token={token}>{NO_APPROVAL_CONFIG}</CopyableCode>
                </div>
              )
            },
            {
              key: 'full',
              label: t('feishuGuide.scopeTabFull'),
              children: (
                <div>
                  <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                    {t('feishuGuide.scopeFullDesc')}
                  </Paragraph>
                  <CopyableCode token={token}>{FULL_CONFIG}</CopyableCode>
                </div>
              )
            }
          ]}
        />

        <Title level={5}>{t('feishuGuide.step3')}</Title>
        <Paragraph>
          {t('feishuGuide.step3Desc')}
        </Paragraph>

        <Title level={5}>{t('feishuGuide.step4')}</Title>
        <Paragraph>
          <ul>
            <li>
              <Text strong>{t('feishuGuide.step4Event')}</Text>
            </li>
            <li>
              <Text strong>{t('feishuGuide.step4Callback')}</Text>
            </li>
          </ul>
        </Paragraph>

        <Title level={5}>{t('feishuGuide.step5')}</Title>
        <Paragraph>
          {t('feishuGuide.step5Desc')}
        </Paragraph>

        <Title level={5} style={{ color: token.colorTextSecondary }}>
          {t('feishuGuide.step6')}
        </Title>
        <Paragraph type="secondary">
          {t('feishuGuide.step6Desc')}
        </Paragraph>
        <Paragraph>
          {t('feishuGuide.step6RedirectLabel')}
        </Paragraph>
        <CopyableCode inline token={token}>http://127.0.0.1:9768/callback</CopyableCode>
        <Paragraph style={{ marginTop: 12 }}>
          {t('feishuGuide.step6LoginLabel')}
        </Paragraph>
        <CopyableCode inline token={token}>feishu-cli auth login</CopyableCode>
        <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
          {t('feishuGuide.step6Tip')}
        </Paragraph>
      </Typography>
    </Modal>
  )
}

export default FeishuGuideModal
