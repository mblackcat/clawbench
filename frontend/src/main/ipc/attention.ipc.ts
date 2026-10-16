import { ipcMain } from 'electron'
import { setTrayAttentionState, type TrayAttentionPayload } from '../services/tray-attention.service'

export function registerAttentionIpc(): void {
  ipcMain.handle('attention:set-tray-state', (_event, payload: TrayAttentionPayload) => {
    setTrayAttentionState({
      flash: !!payload?.flash,
      hasDot: !!payload?.hasDot,
      items: Array.isArray(payload?.items) ? payload.items : [],
      balloon:
        payload?.balloon && typeof payload.balloon.title === 'string'
          ? { title: payload.balloon.title, content: String(payload.balloon.content ?? '') }
          : undefined
    })
  })
}
