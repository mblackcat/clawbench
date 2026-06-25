import { ipcMain } from 'electron'
import { fetchFavicon } from '../services/link.service'
import * as logger from '../utils/logger'

export function registerLinkIpc(): void {
  ipcMain.handle('link:fetch-favicon', async (_event, url: string) => {
    try {
      return await fetchFavicon(url)
    } catch (error) {
      logger.error('link:fetch-favicon error:', error)
      return null
    }
  })
}
