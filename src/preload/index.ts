/**
 * Liquid Torrent — Preload Script
 * Context bridge for safe IPC communication
 */
import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // Torrent operations
  addTorrentFile: (filePath: string, savePath?: string, start?: boolean, filePriorities?: number[]) =>
    ipcRenderer.invoke('torrent:addFile', filePath, savePath, start, filePriorities),
  parseTorrentFile: (filePath: string) =>
    ipcRenderer.invoke('torrent:parseFile', filePath),
  prioritizeFiles: (infoHash: string, priorities: number[]) =>
    ipcRenderer.invoke('torrent:prioritizeFiles', infoHash, priorities),
  addMagnet: (magnetURI: string, savePath?: string) =>
    ipcRenderer.invoke('torrent:addMagnet', magnetURI, savePath),
  removeTorrent: (infoHash: string, deleteFiles: boolean) =>
    ipcRenderer.invoke('torrent:remove', infoHash, deleteFiles),
  pauseTorrent: (infoHash: string) =>
    ipcRenderer.invoke('torrent:pause', infoHash),
  resumeTorrent: (infoHash: string) =>
    ipcRenderer.invoke('torrent:resume', infoHash),
  pauseAll: () => ipcRenderer.invoke('torrent:pauseAll'),
  resumeAll: () => ipcRenderer.invoke('torrent:resumeAll'),
  throttleTorrent: (infoHash: string, downLimit: number, upLimit: number) =>
    ipcRenderer.invoke('torrent:throttle', infoHash, downLimit, upLimit),
  getAllTorrents: () => ipcRenderer.invoke('torrent:getAll'),
  getAllTorrentsLight: () => ipcRenderer.invoke('torrent:getAllLight'),
  getFullTorrentInfo: (infoHash: string) => ipcRenderer.invoke('torrent:getFullInfo', infoHash),
  getSessionStats: () => ipcRenderer.invoke('torrent:getStats'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('settings:save', settings),

  // Dialogs
  openTorrentDialog: () => ipcRenderer.invoke('dialog:openTorrent'),
  chooseDirDialog: () => ipcRenderer.invoke('dialog:chooseDir'),

  // Shell
  openPath: (dirPath: string) => ipcRenderer.invoke('shell:openPath', dirPath),
  openExternal: (url: string) => ipcRenderer.send('open:external', url),

  // System
  getFreeSpace: (dirPath?: string) => ipcRenderer.invoke('system:freeSpace', dirPath)
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
