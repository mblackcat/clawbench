import React from 'react'
import ChatMessageList from './ChatMessageList'
import ChatInput from './ChatInput'

const ChatArea: React.FC = () => {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, overflow: 'hidden' }}>
      <ChatMessageList />
      <ChatInput />
    </div>
  )
}

export default ChatArea
