/**
 * Liquid Torrent — TorrentEngine Proxy
 * Thin proxy that communicates with the WebTorrent worker via utilityProcess.
 * All CPU-heavy work runs in the worker process — main thread stays responsive.
 */
import { utilityProcess } from 'electron'
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

export interface TorrentInfo {
  id: string
  name: string
  state: string
  paused: boolean
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  size: number
  totalDownload: number
  totalUpload: number
  numPeers: number
  numSeeds: number
  eta: number
  savePath: string
  files?: { index: number; path: string; name: string; size: number; progress: number }[]
  trackers?: string[]
  magnetURI: string
  infoHash: string
  ratio: number
  creationDate: string | null
  comment: string | null
}

export interface SessionStats {
  downloadRate: number
  uploadRate: number
  numPeers: number
  numTorrents: number
}

export interface EngineSettings {
  downloadDir: string
  maxDownloadSpeed: number
  maxUploadSpeed: number
  maxConnections: number
  port: number
  autoStopSeeding?: boolean
  minimizeToTray?: boolean
  startMinimized?: boolean
  showNotifications?: boolean
  autoStart?: boolean
}

interface PendingRequest {
  resolve: (value: any) => void
  reject: (error: Error) => void
}

export class TorrentEngine {
  private worker: any = null
  private _ready = false
  private dataPath: string
  private settingsPath: string
  private settings: EngineSettings
  private pendingRequests = new Map<string, PendingRequest>()
  private msgId = 0

  constructor() {
    const portableDir = path.join(path.dirname(process.execPath), 'LiquidTorrentData')
    const isPortable = !process.execPath.includes('node_modules')
    this.dataPath = isPortable && fs.existsSync(path.dirname(portableDir))
      ? portableDir
      : path.join(app.getPath('appData'), 'liquid-torrent')
    fs.mkdirSync(this.dataPath, { recursive: true })
    this.settingsPath = path.join(this.dataPath, 'settings.json')
    this.settings = this.loadSettings()
  }

  /** Start the worker process and initialize WebTorrent inside it */
  async init(): Promise<void> {
    // Fork the worker from the built output
    const workerPath = path.join(__dirname, 'torrent-worker.js')
    this.worker = utilityProcess.fork(workerPath, [], {
      serviceName: 'LiquidTorrent-Engine'
    })

    // Listen for responses
    this.worker.on('message', (data: { id: string; result?: any; error?: string }) => {
      const pending = this.pendingRequests.get(data.id)
      if (pending) {
        this.pendingRequests.delete(data.id)
        if (data.error) {
          pending.reject(new Error(data.error))
        } else {
          pending.resolve(data.result)
        }
      }
    })

    this.worker.on('exit', (code: number) => {
      console.error(`[TorrentEngine] Worker exited with code ${code}`)
      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error('Worker process exited'))
        this.pendingRequests.delete(id)
      }
    })

    // Initialize WebTorrent inside the worker
    await this.send('init', { dataPath: this.dataPath })
    this._ready = true
    console.log('[TorrentEngine] Worker initialized (off main thread!)')
  }

  /** Send a message to the worker and wait for response */
  private send(action: string, args?: any, timeoutMs?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = `msg_${++this.msgId}_${Date.now()}`
      this.pendingRequests.set(id, { resolve, reject })
      this.worker.postMessage({ id, action, args })

      // Operation-specific timeouts:
      // loadSaved/addTorrentFile may verify 155GB+ → needs minutes
      const timeout = timeoutMs ?? 30000
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`Timeout: ${action}`))
        }
      }, timeout)
    })
  }

  /** Send a message without waiting for response (fire-and-forget) */
  private sendNoWait(action: string, args?: any): void {
    const id = `msg_${++this.msgId}_${Date.now()}`
    // Still set up a pending handler to avoid memory leaks on error
    this.pendingRequests.set(id, {
      resolve: () => this.pendingRequests.delete(id),
      reject: () => this.pendingRequests.delete(id)
    })
    this.worker.postMessage({ id, action, args })
    // Auto-cleanup after 10s
    setTimeout(() => this.pendingRequests.delete(id), 10000)
  }

  // ─── Settings (loaded in main for UI, synced to worker) ─────

  private loadSettings(): EngineSettings {
    const DEFAULT_SETTINGS: EngineSettings = {
      downloadDir: path.join(os.homedir(), 'Downloads'),
      maxDownloadSpeed: -1,
      maxUploadSpeed: 5 * 1024 * 1024,  // 5 MB/s default — prevents upload from saturating upstream
      maxConnections: 100, port: 0,  // 0 = random port, avoids ISP throttle
      autoStopSeeding: false, minimizeToTray: true,
      startMinimized: false, showNotifications: true, autoStart: false
    }
    try {
      if (fs.existsSync(this.settingsPath)) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8')) }
      }
    } catch {}
    return { ...DEFAULT_SETTINGS }
  }

  getSettings(): EngineSettings {
    return { ...this.settings }
  }

  async updateSettings(newSettings: Partial<EngineSettings>): Promise<EngineSettings> {
    this.settings = { ...this.settings, ...newSettings }
    // Sync to worker
    const result = await this.send('updateSettings', { settings: newSettings })
    return result
  }

  // ─── Torrent Operations (delegated to worker) ──────────────

  async loadSavedTorrents(): Promise<void> {
    // 155GB+ torrent verification can take 5+ minutes
    await this.send('loadSaved', undefined, 600000)
  }

  async addTorrentFile(filePath: string, savePath?: string, start = true): Promise<TorrentInfo> {
    return this.send('addTorrentFile', { filePath, savePath, start }, 300000)
  }

  async addMagnet(magnetURI: string, savePath?: string, start = true): Promise<TorrentInfo> {
    return this.send('addMagnet', { magnetURI, savePath, start }, 300000)
  }

  removeTorrent(infoHash: string, deleteFiles = false): void {
    this.sendNoWait('remove', { infoHash, deleteFiles })
  }

  pauseTorrent(infoHash: string): void {
    this.sendNoWait('pause', { infoHash })
  }

  resumeTorrent(infoHash: string): void {
    this.sendNoWait('resume', { infoHash })
  }

  pauseAll(): void {
    this.sendNoWait('pauseAll')
  }

  resumeAll(): void {
    this.sendNoWait('resumeAll')
  }

  throttleTorrent(infoHash: string, downLimit: number, upLimit: number): void {
    this.sendNoWait('throttle', { infoHash, downLimit, upLimit })
  }

  // ─── Info Queries (delegated to worker) ────────────────────

  async getAllTorrentsLight(): Promise<Omit<TorrentInfo, 'files' | 'trackers'>[]> {
    return this.send('getAllLight')
  }

  async getFullTorrentInfo(infoHash: string): Promise<TorrentInfo | null> {
    return this.send('getFullInfo', { infoHash })
  }

  async getAllTorrents(): Promise<TorrentInfo[]> {
    return this.send('getAllTorrents')
  }

  async getSessionStats(): Promise<SessionStats> {
    return this.send('getSessionStats')
  }

  // ─── Persistence (for backward compat) ─────────────────────

  saveTorrentsState(): void {
    // Sync save — used only at shutdown
    // Worker does its own debounced saves during operation
    this.sendNoWait('shutdown')
  }

  // ─── Shutdown ──────────────────────────────────────────────

  async shutdown(): Promise<void> {
    try {
      await this.send('shutdown')
    } catch {
      // Worker may have already exited
    }
    try {
      this.worker?.kill()
    } catch {}
  }
}
