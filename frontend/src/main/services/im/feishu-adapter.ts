/**
 * Feishu (Lark) IM Adapter — WebSocket long connection mode.
 *
 * Uses `@larksuiteoapi/node-sdk` WSClient to receive messages without
 * requiring a public endpoint, making it ideal for desktop apps.
 *
 * Responsibilities:
 * - Connect / disconnect via WSClient
 * - Receive im.message.receive_v1 events → forward to `onMessage`
 * - Receive card.action.trigger callbacks → forward to `onCardCallback`
 * - Send / update interactive card messages via REST Client
 */

import type {
  IMAdapter,
  IMConnectionStatus,
  IMConnectionState,
  IMIncomingMessage,
  IMCardCallback,
  IMCardPayload
} from './types'
import { toFeishuCardJSON } from './feishu-cards'

// Lazy-import the SDK so the module is tree-shakeable and doesn't blow up
// when the user hasn't installed it (though we do install it as a dependency).
let Lark: typeof import('@larksuiteoapi/node-sdk') | null = null

async function getLark(): Promise<typeof import('@larksuiteoapi/node-sdk')> {
  if (!Lark) {
    Lark = await import('@larksuiteoapi/node-sdk')
  }
  return Lark
}

export class FeishuAdapter implements IMAdapter {
  readonly name = 'feishu'

  private client: any = null
  private wsClient: any = null
  private state: IMConnectionState = 'disconnected'
  private error?: string
  private connectedAt?: number

  // Event hooks — set by the bridge service
  onMessage: ((msg: IMIncomingMessage) => void) | null = null
  onCardCallback: ((cb: IMCardCallback) => void) | null = null
  onStatusChange: ((status: IMConnectionStatus) => void) | null = null

  getStatus(): IMConnectionStatus {
    return {
      state: this.state,
      error: this.error,
      connectedAt: this.connectedAt
    }
  }

  private setState(state: IMConnectionState, error?: string): void {
    this.state = state
    this.error = error
    if (state === 'connected') this.connectedAt = Date.now()
    this.onStatusChange?.(this.getStatus())
  }

  async connect(config: Record<string, string>): Promise<void> {
    const { appId, appSecret } = config
    if (!appId || !appSecret) {
      this.setState('error', '缺少 App ID 或 App Secret')
      throw new Error('Missing appId or appSecret')
    }

    // Disconnect any existing connection first
    if (this.wsClient) {
      await this.disconnect()
    }

    this.setState('connecting')

    try {
      const lark = await getLark()

      // REST client for sending messages
      this.client = new lark.Client({ appId, appSecret })

      // Event dispatcher for incoming messages
      const eventDispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data: any) => {
          try {
            console.log('[FeishuAdapter] Received message event:', JSON.stringify(data))
            // The data structure can be different depending on SDK version or event type.
            // Sometimes it's nested under 'event', sometimes flattened.
            const msg = data?.message || data?.event?.message
            const sender = data?.sender || data?.event?.sender
            if (!msg) {
              console.log('[FeishuAdapter] No message object found in event data')
              return
            }

            // Handle text and post (rich text) messages
            const msgType = msg.message_type
            if (msgType !== 'text' && msgType !== 'post') {
              console.log('[FeishuAdapter] Ignoring message type:', msgType)
              return
            }

            let text = ''
            try {
              const contentObj = JSON.parse(msg.content || '{}')
              
              if (msgType === 'text') {
                text = contentObj.text || ''
              } else if (msgType === 'post') {
                // Extract text from post content, ignoring mentions/images
                const postContent = contentObj.content || []
                for (const row of postContent) {
                  for (const elem of row) {
                    if (elem.tag === 'text') {
                      text += elem.text
                    }
                  }
                  text += ' '
                }
              }
            } catch (err) {
              console.error('[FeishuAdapter] Error parsing message content:', err)
              text = msg.content || ''
            }

            console.log('[FeishuAdapter] Parsed text:', text)

            if (!text.trim()) return

            this.onMessage?.({
              messageId: msg.message_id,
              chatId: msg.chat_id,
              text: text.trim(),
              senderId: sender?.sender_id?.open_id || '',
              senderName: sender?.sender_id?.user_id || ''
            })
          } catch (err) {
            console.error('[FeishuAdapter] Error handling incoming message:', err)
          }
        },
        'card.action.trigger': async (data: any) => {
          let isFormSubmit = false
          try {
            console.log('[FeishuAdapter] Received card callback:', JSON.stringify(data))
            // EventDispatcher passes the event body flat (no .event wrapper),
            // but guard against both structures just in case.
            const event = data?.event || data
            const action = event?.action
            const value = action?.value || {}
            const operator = event?.operator
            const context = event?.context || {}

            console.log('[FeishuAdapter] Card action parsed:', JSON.stringify({ tag: action?.tag, value, form_value: action?.form_value }))

            // When form_action_type=submit, Feishu does NOT pass the button's custom value field.
            // Instead, session ID is encoded in the button name as "send_button_<sessionId>".
            isFormSubmit = !!(action?.form_value && action?.name?.startsWith('send_button_'))
            const sessionIdFromName = isFormSubmit
              ? (action.name as string).replace('send_button_', '')
              : ''

            this.onCardCallback?.({
              actionTag: isFormSubmit ? 'form_input' : (value.action || action?.tag || ''),
              actionValue: isFormSubmit ? sessionIdFromName : (value.value || ''),
              userId: operator?.open_id || '',
              chatId: context?.open_chat_id || '',
              messageId: context?.open_message_id || '',
              formValue: action?.form_value || undefined
            })
          } catch (err) {
            console.error('[FeishuAdapter] Error handling card callback:', err)
          }
          // For schema 2.0 form submissions, return a toast to acknowledge;
          // returning {} for submit actions causes error code 200530.
          // For regular button clicks (pause, exit, etc.), return {} to avoid
          // showing a misleading "已发送" toast.
          if (isFormSubmit) {
            return {
              toast: {
                type: 'success',
                content: '已发送',
                i18n: { zh_cn: '已发送', en_us: 'Sent' }
              }
            }
          }
          return {}
        }
      })

      // WSClient for long-lived connection
      this.wsClient = new lark.WSClient({
        appId,
        appSecret,
        loggerLevel: lark.LoggerLevel.warn
      })

      await this.wsClient.start({
        eventDispatcher
      })
      this.setState('connected')
    } catch (err: any) {
      const errMsg = err?.message || String(err)
      this.setState('error', errMsg)
      throw err
    }
  }

  async disconnect(): Promise<void> {
    try {
      // The SDK WSClient doesn't expose a clean stop() in all versions,
      // but we nullify references so GC can clean up.
      if (this.wsClient) {
        // Some SDK versions have .close() or .stop()
        if (typeof this.wsClient.close === 'function') {
          await this.wsClient.close()
        } else if (typeof this.wsClient.stop === 'function') {
          await this.wsClient.stop()
        }
      }
    } catch (err) {
      console.error('[FeishuAdapter] Error during disconnect:', err)
    } finally {
      this.wsClient = null
      this.client = null
      this.setState('disconnected')
    }
  }

  async sendCard(chatId: string, card: IMCardPayload): Promise<string> {
    if (!this.client) throw new Error('Feishu client not connected')

    try {
      const resp = await this.client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          content: toFeishuCardJSON(card),
          msg_type: 'interactive'
        }
      })

      if (resp.code !== 0) {
        console.error('[FeishuAdapter] sendCard failed:', resp.code, resp.msg)
        throw new Error(`Feishu API error: ${resp.code} ${resp.msg}`)
      }

      const messageId = resp?.data?.message_id
      if (!messageId) {
        throw new Error('Failed to get message_id from Feishu response')
      }
      return messageId
    } catch (err) {
      console.error('[FeishuAdapter] sendCard exception:', err)
      throw err
    }
  }

  async updateCard(_chatId: string, messageId: string, card: IMCardPayload): Promise<void> {
    if (!this.client) throw new Error('Feishu client not connected')

    try {
      const resp = await this.client.im.v1.message.patch({
        path: { message_id: messageId },
        data: {
          content: toFeishuCardJSON(card)
        }
      })

      if (resp.code !== 0) {
        console.error('[FeishuAdapter] updateCard failed:', resp.code, resp.msg)
        throw new Error(`Feishu API error: ${resp.code} ${resp.msg}`)
      }
    } catch (err) {
      console.error('[FeishuAdapter] updateCard exception:', err)
      throw err
    }
  }

  async sendText(chatId: string, text: string): Promise<string> {
    if (!this.client) throw new Error('Feishu client not connected')

    try {
      const resp = await this.client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          content: JSON.stringify({ text }),
          msg_type: 'text'
        }
      })

      if (resp.code !== 0) {
        console.error('[FeishuAdapter] sendText failed:', resp.code, resp.msg)
        throw new Error(`Feishu API error: ${resp.code} ${resp.msg}`)
      }

      return resp?.data?.message_id || ''
    } catch (err) {
      console.error('[FeishuAdapter] sendText exception:', err)
      throw err
    }
  }

  async addReaction(messageId: string, emojiType: string): Promise<void> {
    if (!this.client) return

    try {
      await this.client.im.v1.messageReaction.create({
        path: { message_id: messageId },
        data: {
          reaction_type: { emoji_type: emojiType }
        }
      })
    } catch (err) {
      // Non-critical — silently log and continue
      console.error('[FeishuAdapter] addReaction failed:', err)
    }
  }
}
