import { create } from 'zustand'

export interface AppNotification {
  id: string
  type: string
  title: string
  body: string
  timestamp: number
  read: boolean
}

interface NotificationState {
  notifications: AppNotification[]
  unreadCount: number
  init: () => () => void
  dismiss: (id: string) => void
  dismissAll: () => void
}

const MAX_NOTIFICATIONS = 50

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,

  init: () => {
    const cleanup = window.api.notification.onPush(
      (data: { id: string; type: string; title: string; body: string; timestamp: number }) => {
        set((state) => {
          const newNotification: AppNotification = { ...data, read: false }
          const updated = [newNotification, ...state.notifications].slice(0, MAX_NOTIFICATIONS)
          return {
            notifications: updated,
            unreadCount: updated.filter((n) => !n.read).length
          }
        })
      }
    )
    return cleanup
  },

  dismiss: (id: string) => {
    set((state) => {
      const updated = state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      )
      return {
        notifications: updated,
        unreadCount: updated.filter((n) => !n.read).length
      }
    })
  },

  dismissAll: () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0
    }))
  }
}))
