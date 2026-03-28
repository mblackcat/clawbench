import React from 'react'
import { theme } from 'antd'
import ChatInput from './ChatInput'
import appIcon from '../../../../../resources/icon.svg'
import './welcome-chat.css'

const WelcomeChatView: React.FC = () => {
  const { token } = theme.useToken()

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '0 16px',
        paddingBottom: '18%'
      }}
    >
      <div
        className="welcome-chat-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 36
        }}
      >
        <img
          src={appIcon}
          alt="ClawBench"
          className="welcome-chat-icon"
          style={{ width: 64, height: 64 }}
        />
        <span
          style={{
            fontSize: 18,
            fontWeight: 500,
            color: token.colorTextSecondary
          }}
        >
          好好学习，天天向上
        </span>
      </div>
      <div className="welcome-chat-input" style={{ width: 600, maxWidth: '90%' }}>
        <ChatInput />
      </div>
    </div>
  )
}

export default WelcomeChatView
