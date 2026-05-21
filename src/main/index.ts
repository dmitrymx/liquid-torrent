/**
 * Liquid Torrent — Main Process
 * Window management, IPC handlers, tray, file associations
 */
import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, shell } from 'electron'
import { join } from 'path'
import * as path from 'path'
import { TorrentEngine } from './torrent'
import * as fs from 'fs'
import { exec, execSync } from 'child_process'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let engine: TorrentEngine
let isQuitting = false

// Single instance lock
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

// File associations: .torrent and magnet:
const exePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
app.setAsDefaultProtocolClient('magnet', exePath)

function registerFileAssociation(): void {
  if (process.platform !== 'win32') return
  const exePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
  const exeName = path.basename(exePath)
  
  const commands = [
    `reg add "HKCU\\Software\\Classes\\.torrent" /ve /t REG_SZ /d "LiquidTorrent" /f`,
    `reg add "HKCU\\Software\\Classes\\LiquidTorrent" /ve /t REG_SZ /d "Torrent File" /f`,
    `reg add "HKCU\\Software\\Classes\\LiquidTorrent\\DefaultIcon" /ve /t REG_SZ /d "\\"${exePath}\\",0" /f`,
    `reg add "HKCU\\Software\\Classes\\LiquidTorrent\\shell\\open\\command" /ve /t REG_SZ /d "\\"${exePath}\\" \\"%1\\"" /f`,
    `reg add "HKCU\\Software\\Classes\\Applications\\${exeName}" /ve /t REG_SZ /d "Liquid Torrent" /f`,
    `reg add "HKCU\\Software\\Classes\\Applications\\${exeName}\\shell\\open\\command" /ve /t REG_SZ /d "\\"${exePath}\\" \\"%1\\"" /f`,
    `reg add "HKCU\\Software\\LiquidTorrent\\Capabilities\\FileAssociations" /v ".torrent" /t REG_SZ /d "LiquidTorrent" /f`,
    `reg add "HKCU\\Software\\RegisteredApplications" /v "Liquid Torrent" /t REG_SZ /d "Software\\LiquidTorrent\\Capabilities" /f`
  ]

  commands.forEach(cmd => {
    exec(cmd, (err) => {
      if (err) console.error('[Registry] Error running command:', cmd, err)
    })
  })
}

function getDiskSpace(dirPath: string): Promise<{ free: number; total: number }> {
  return new Promise((resolve) => {
    try {
      const resolvedPath = path.resolve(dirPath)
      const driveLetter = resolvedPath.split(':')[0]
      if (driveLetter && driveLetter.length === 1) {
        // Run PowerShell asynchronously to prevent blocking the main process
        exec(`powershell -Command "(Get-PSDrive ${driveLetter}).Free; (Get-PSDrive ${driveLetter}).Used + (Get-PSDrive ${driveLetter}).Free"`, { windowsHide: true }, (err, stdout) => {
          if (err) {
            console.error('[System] Error getting disk space:', err)
            return resolve({ free: -1, total: -1 })
          }
          const lines = stdout.trim().split(/[\r\n]+/)
          const free = parseInt(lines[0]) || -1
          const total = parseInt(lines[1]) || -1
          resolve({ free, total })
        })
      } else {
        resolve({ free: -1, total: -1 })
      }
    } catch (e) {
      console.error('[System] Error getting disk space:', e)
      resolve({ free: -1, total: -1 })
    }
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    frame: false, // Custom titlebar
    transparent: false,
    backgroundColor: '#0a0e1c',
    show: false,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Graceful show
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Dev or production
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('close', (e) => {
    // Minimize to tray instead of closing (unless quitting)
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
}

function createTray(): void {
  const iconPath = join(__dirname, '../../resources/icon.png')
  tray = new Tray(iconPath)
  tray.setToolTip('Liquid Torrent')

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Показать', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Пауза всех', click: () => engine.pauseAll() },
    { label: 'Продолжить все', click: () => engine.resumeAll() },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        app.quit()
      }
    }
  ])
  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => mainWindow?.show())
}

// ─── IPC Handlers ─────────────────────────────────────────────

function setupIPC(): void {
  // Window controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.hide())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

  // Torrent operations — all wrapped in try/catch
  ipcMain.handle('torrent:addFile', async (_e, filePath: string, savePath?: string, start?: boolean, filePriorities?: number[]) => {
    try { return await engine.addTorrentFile(filePath, savePath, start, filePriorities) }
    catch (err: any) { console.error('[IPC] addFile:', err); return null }
  })

  ipcMain.handle('torrent:parseFile', async (_e, filePath: string) => {
    try { return await engine.parseTorrentFile(filePath) }
    catch (err: any) { console.error('[IPC] parseFile:', err); return null }
  })

  ipcMain.handle('torrent:prioritizeFiles', (_e, infoHash: string, priorities: number[]) => {
    try { engine.prioritizeFiles(infoHash, priorities) }
    catch (err: any) { console.error('[IPC] prioritizeFiles:', err) }
  })

  ipcMain.handle('torrent:addMagnet', async (_e, magnetURI: string, savePath?: string) => {
    try { return await engine.addMagnet(magnetURI, savePath) }
    catch (err: any) { console.error('[IPC] addMagnet:', err); return null }
  })

  ipcMain.handle('torrent:remove', (_e, infoHash: string, deleteFiles: boolean) => {
    try { engine.removeTorrent(infoHash, deleteFiles) } catch (e) { console.error('[IPC] remove:', e) }
  })

  ipcMain.handle('torrent:pause', (_e, infoHash: string) => {
    try { engine.pauseTorrent(infoHash) } catch (e) { console.error('[IPC] pause:', e) }
  })

  ipcMain.handle('torrent:resume', (_e, infoHash: string) => {
    try { engine.resumeTorrent(infoHash) } catch (e) { console.error('[IPC] resume:', e) }
  })

  ipcMain.handle('torrent:pauseAll', () => { try { engine.pauseAll() } catch {} })
  ipcMain.handle('torrent:resumeAll', () => { try { engine.resumeAll() } catch {} })

  ipcMain.handle('torrent:throttle', (_e, infoHash: string, downLimit: number, upLimit: number) => {
    try { engine.throttleTorrent(infoHash, downLimit, upLimit) } catch (e) { console.error('[IPC] throttle:', e) }
  })

  ipcMain.handle('torrent:getAll', async () => {
    try { return await engine.getAllTorrents() } catch { return [] }
  })

  ipcMain.handle('torrent:getAllLight', async () => {
    try { return await engine.getAllTorrentsLight() } catch { return [] }
  })

  ipcMain.handle('torrent:getFullInfo', async (_e, infoHash: string) => {
    try { return await engine.getFullTorrentInfo(infoHash) } catch { return null }
  })

  ipcMain.handle('torrent:getStats', async () => {
    try { return await engine.getSessionStats() }
    catch { return { downloadRate: 0, uploadRate: 0, numPeers: 0, numTorrents: 0 } }
  })

  // Settings
  ipcMain.handle('settings:get', () => {
    try { return engine.getSettings() } catch { return {} }
  })
  ipcMain.handle('settings:save', async (_e, settings: any) => {
    try { await engine.updateSettings(settings) } catch {}
  })

  // Dialog: open .torrent file
  ipcMain.handle('dialog:openTorrent', async () => {
    try {
      if (!mainWindow) return []
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Открыть торрент-файл',
        filters: [
          { name: 'Торрент-файлы', extensions: ['torrent'] },
          { name: 'Все файлы', extensions: ['*'] }
        ],
        properties: ['openFile', 'multiSelections']
      })
      return result.filePaths
    } catch { return [] }
  })

  // Dialog: choose save directory
  ipcMain.handle('dialog:chooseDir', async () => {
    try {
      if (!mainWindow) return null
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Выберите папку для загрузки',
        properties: ['openDirectory', 'createDirectory']
      })
      return result.filePaths[0] || null
    } catch { return null }
  })

  // Open folder in explorer (highlight item)
  ipcMain.handle('shell:openPath', async (_e, itemPath: string) => {
    try {
      const fs = await import('fs')
      const stat = fs.statSync(itemPath)
      if (stat.isDirectory()) {
        shell.openPath(itemPath)
      } else {
        shell.showItemInFolder(itemPath)
      }
    } catch {
      // Fallback: try parent dir
      try {
        const path = await import('path')
        shell.openPath(path.dirname(itemPath))
      } catch {}
    }
  })

  // External link
  ipcMain.on('open:external', (_e, url: string) => {
    try { shell.openExternal(url) } catch {}
  })

  // Disk free space
  ipcMain.handle('system:freeSpace', async (_e, dirPath: string) => {
    return getDiskSpace(dirPath || engine.getSettings().downloadDir)
  })
}

// ─── App lifecycle ────────────────────────────────────────────

app.on('second-instance', (_e, argv) => {
  // Handle .torrent file opened from explorer
  mainWindow?.show()
  const torrentFile = argv.find(a => a.endsWith('.torrent'))
  if (torrentFile) {
    engine.addTorrentFile(torrentFile).catch(console.error)
  }
  const magnet = argv.find(a => a.startsWith('magnet:'))
  if (magnet) {
    engine.addMagnet(magnet).catch(console.error)
  }
})

app.on('open-file', (_e, filePath) => {
  if (filePath.endsWith('.torrent')) {
    engine.addTorrentFile(filePath).catch(console.error)
  }
})

app.whenReady().then(async () => {
  registerFileAssociation()
  engine = new TorrentEngine()
  await engine.init()  // async: starts Python libtorrent sidecar
  setupIPC()
  createWindow()
  createTray()

  // Load saved torrents
  await engine.loadSavedTorrents()

  // Handle .torrent files passed via command line on first launch
  const args = process.argv.slice(1)
  for (const arg of args) {
    if (arg.endsWith('.torrent') && fs.existsSync(arg)) {
      engine.addTorrentFile(arg).catch(console.error)
    } else if (arg.startsWith('magnet:')) {
      engine.addMagnet(arg).catch(console.error)
    }
  }
})


app.on('before-quit', async (e) => {
  if (!isQuitting) {
    e.preventDefault()
    isQuitting = true
    console.log('[Main] Shutting down engine...')
    try {
      await engine.shutdown()
      console.log('[Main] Engine shut down cleanly')
    } catch (err) {
      console.error('[Main] Engine shutdown error:', err)
    }
    app.quit()
  }
})

app.on('window-all-closed', () => {
  // Keep running in tray
})
