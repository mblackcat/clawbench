import { ipcMain } from 'electron'
import { setTrayAttentionState } from '../services/tray-attention.service'

export function registerAttentionIpc(): void {
  ipcMain.handle(
    'attention:set-tray-state',
    (_event, state: { flash: boolean; hasDot: boolean }) => {
      setTrayAttentionState({
        flash: !!state?.flash,
        hasDot: !!state?.hasDot
      })
    }
  )
}
