import { contextBridge } from 'electron'
import { api } from './api'

// Expose typed API to renderer process via contextBridge
contextBridge.exposeInMainWorld('api', api)
