/**
 * Liquid Torrent — WebTorrent Engine
 * Port of torrent_engine.py from PySide6 version to TypeScript/WebTorrent
 * Uses dynamic import() because webtorrent is ESM-only
 */
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
  files: { index: number; path: string; name: string; size: number; progress: number }[]
  trackers: string[]
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
  maxDownloadSpeed: number  // bytes/s, -1 = unlimited
  maxUploadSpeed: number    // bytes/s, -1 = unlimited
  maxConnections: number
  port: number
  autoStopSeeding?: boolean
  minimizeToTray?: boolean
  startMinimized?: boolean
  showNotifications?: boolean
  autoStart?: boolean
}

// Public trackers that WebTorrent supports (WebSocket + UDP/HTTP via webtorrent)
const PUBLIC_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.files.fm:7073/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://open.stealth.si:80/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'http://tracker.opentrackr.org:1337/announce'
]

const DEFAULT_SETTINGS: EngineSettings = {
  downloadDir: path.join(os.homedir(), 'Downloads'),
  maxDownloadSpeed: -1,
  maxUploadSpeed: -1,
  maxConnections: 200,
  port: 6881,
  autoStopSeeding: false,
  minimizeToTray: true,
  startMinimized: false,
  showNotifications: true,
  autoStart: false
}

export class TorrentEngine {
  private client: any = null
  private settings: EngineSettings
  private dataPath: string
  private settingsPath: string
  private torrentsPath: string
  private pausedSet: Set<string> = new Set()
  private completedSet: Set<string> = new Set()  // tracks auto-stop handled
  private _ready = false
  // Cache for static torrent metadata (files, trackers) — rebuilt only once per torrent
  private staticCache: Map<string, { files: TorrentInfo['files']; trackers: string[] }> = new Map()

  constructor() {
    // Portable: store data next to exe if portable, else in appData
    this.dataPath = path.join(app.getPath('userData'), 'liquid-torrent-data')
    fs.mkdirSync(this.dataPath, { recursive: true })

    this.settingsPath = path.join(this.dataPath, 'settings.json')
    this.torrentsPath = path.join(this.dataPath, 'torrents.json')

    this.settings = this.loadSettings()
  }

  /** Must be called before any torrent operations */
  async init(): Promise<void> {
    const WebTorrent = (await import('webtorrent')).default
    this.client = new WebTorrent({
      maxConns: this.settings.maxConnections,
      downloadLimit: this.settings.maxDownloadSpeed > 0 ? this.settings.maxDownloadSpeed : -1,
      uploadLimit: this.settings.maxUploadSpeed > 0 ? this.settings.maxUploadSpeed : -1
    })
    this.client.on('error', (err: Error) => {
      console.error('[TorrentEngine] Client error:', err.message)
    })
    this._ready = true
    console.log('[TorrentEngine] Initialized')
  }

  // ─── Settings ───────────────────────────────────────────────

  private loadSettings(): EngineSettings {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf-8')
        return { ...DEFAULT_SETTINGS, ...JSON.parse(data) }
      }
    } catch (e) {
      console.error('[TorrentEngine] Failed to load settings:', e)
    }
    return { ...DEFAULT_SETTINGS }
  }

  saveSettings(partial: Partial<EngineSettings>): void {
    this.settings = { ...this.settings, ...partial }
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8')
      // Apply runtime limits
      if (this.client) {
        this.client.throttleDownload(this.settings.maxDownloadSpeed > 0 ? this.settings.maxDownloadSpeed : -1)
        this.client.throttleUpload(this.settings.maxUploadSpeed > 0 ? this.settings.maxUploadSpeed : -1)
      }
    } catch (e) {
      console.error('[TorrentEngine] Failed to save settings:', e)
    }
  }

  getSettings(): EngineSettings {
    return { ...this.settings }
  }

  // ─── Torrent persistence ─────────────────────────────────────

  saveTorrentsState(): void {
    try {
      const torrentFilesDir = path.join(this.dataPath, 'torrent-files')
      if (!fs.existsSync(torrentFilesDir)) fs.mkdirSync(torrentFilesDir, { recursive: true })

      const data = this.client.torrents.map(t => {
        // Save .torrent file for proper resume with verification
        let torrentFilePath: string | null = null
        try {
          const torrentBuf = t.torrentFile
          if (torrentBuf && torrentBuf.length > 0) {
            torrentFilePath = path.join(torrentFilesDir, `${t.infoHash}.torrent`)
            fs.writeFileSync(torrentFilePath, torrentBuf)
          }
        } catch {}

        return {
          magnetURI: t.magnetURI,
          infoHash: t.infoHash,
          savePath: (t as any).path || this.settings.downloadDir,
          paused: this.pausedSet.has(t.infoHash),
          hasTorrentFile: !!torrentFilePath
        }
      })
      fs.writeFileSync(this.torrentsPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (e) {
      console.error('[TorrentEngine] Failed to save torrents:', e)
    }
  }

  async loadSavedTorrents(): Promise<void> {
    try {
      if (!fs.existsSync(this.torrentsPath)) return
      const torrentFilesDir = path.join(this.dataPath, 'torrent-files')
      const data = JSON.parse(fs.readFileSync(this.torrentsPath, 'utf-8')) as Array<{
        magnetURI: string
        infoHash?: string
        savePath: string
        paused: boolean
        hasTorrentFile?: boolean
      }>

      // Parallel restoration — all torrents load simultaneously
      const promises = data.map(async (entry) => {
        try {
          const torrentFile = entry.infoHash
            ? path.join(torrentFilesDir, `${entry.infoHash}.torrent`)
            : null

          if (torrentFile && fs.existsSync(torrentFile)) {
            console.log(`[TorrentEngine] Restoring from .torrent: ${entry.infoHash}`)
            await this.addTorrentFile(torrentFile, entry.savePath, !entry.paused)
          } else {
            console.log(`[TorrentEngine] Restoring from magnet: ${entry.infoHash || 'unknown'}`)
            await this.addMagnet(entry.magnetURI, entry.savePath, !entry.paused)
          }

          if (entry.paused && entry.infoHash) {
            this.pausedSet.add(entry.infoHash)
          }
        } catch (e) {
          console.error('[TorrentEngine] Failed to restore torrent:', e)
        }
      })

      await Promise.allSettled(promises)
      console.log(`[TorrentEngine] Restored ${data.length} torrents (parallel)`)
    } catch (e) {
      console.error('[TorrentEngine] Failed to load saved torrents:', e)
    }
  }

  // ─── Add / Remove ───────────────────────────────────────────

  addTorrentFile(filePath: string, savePath?: string, start = true): Promise<TorrentInfo> {
    return new Promise((resolve, reject) => {
      const dest = savePath || this.settings.downloadDir
      fs.mkdirSync(dest, { recursive: true })

      let buffer: Buffer
      try {
        buffer = fs.readFileSync(filePath)
      } catch (e) {
        return reject(new Error(`Файл не найден: ${filePath}`))
      }

      // Check if already exists
      const existing = this.client.torrents.find(t => {
        try {
          return t.infoHash && buffer.toString('hex').includes(t.infoHash)
        } catch { return false }
      })
      if (existing) {
        return resolve(this.getTorrentInfo(existing))
      }

      this.client.add(buffer, { path: dest, announce: PUBLIC_TRACKERS }, (torrent) => {
        console.log(`[TorrentEngine] Torrent ready: ${torrent.name} | ${torrent.files?.length || 0} files`)
        this.setupAutoStop(torrent)
        if (!start) {
          torrent.pause()
          this.pausedSet.add(torrent.infoHash)
        }
        this.saveTorrentsState()
        resolve(this.getTorrentInfo(torrent))
      })
    })
  }

  addMagnet(magnetURI: string, savePath?: string, start = true): Promise<TorrentInfo> {
    return new Promise((resolve, reject) => {
      if (!magnetURI.startsWith('magnet:')) {
        return reject(new Error('Неверная магнет-ссылка'))
      }

      const dest = savePath || this.settings.downloadDir
      fs.mkdirSync(dest, { recursive: true })

      // Check if already added
      const existing = this.client.torrents.find(t => magnetURI.includes(t.infoHash))
      if (existing) {
        return resolve(this.getTorrentInfo(existing))
      }

      this.client.add(magnetURI, { path: dest, announce: PUBLIC_TRACKERS }, (torrent) => {
        console.log(`[TorrentEngine] Magnet ready: ${torrent.name}`)
        this.setupAutoStop(torrent)
        if (!start) {
          torrent.pause()
          this.pausedSet.add(torrent.infoHash)
        }
        this.saveTorrentsState()
        resolve(this.getTorrentInfo(torrent))
      })
    })
  }

  /** Auto-stop seeding 10 seconds after download completes (if enabled in settings) */
  private setupAutoStop(torrent: any): void {
    torrent.on('done', () => {
      console.log(`[TorrentEngine] Download complete: ${torrent.name}`)
      if (this.settings.autoStopSeeding && !this.completedSet.has(torrent.infoHash)) {
        this.completedSet.add(torrent.infoHash)
        console.log(`[TorrentEngine] Auto-stop in 10s: ${torrent.name}`)
        setTimeout(() => {
          try {
            if (!this.pausedSet.has(torrent.infoHash)) {
              torrent.pause()
              this.pausedSet.add(torrent.infoHash)
              this.saveTorrentsState()
              console.log(`[TorrentEngine] Auto-stopped: ${torrent.name}`)
            }
          } catch {}
        }, 10000)
      }
    })
  }

  removeTorrent(infoHash: string, deleteFiles = false): void {
    const torrent = this.client.torrents.find(t => t.infoHash === infoHash)
    if (!torrent) return

    this.client.remove(infoHash, { destroyStore: deleteFiles }, (err) => {
      if (err) console.error('[TorrentEngine] Remove error:', err)
    })
    this.pausedSet.delete(infoHash)
    this.staticCache.delete(infoHash)  // Clear cached file/tracker data
    this.saveTorrentsState()
  }

  // ─── Pause / Resume ─────────────────────────────────────────

  pauseTorrent(infoHash: string): void {
    const torrent = this.client.torrents.find(t => t.infoHash === infoHash)
    if (torrent) {
      torrent.pause()
      // Deselect all files to truly stop downloading
      try { torrent.files?.forEach(f => f.deselect()) } catch {}
      // Destroy all peer connections
      try {
        if (torrent.wires) {
          torrent.wires.forEach(w => { try { w.destroy() } catch {} })
        }
      } catch {}
      this.pausedSet.add(infoHash)
      this.saveTorrentsState()
      console.log(`[TorrentEngine] Paused: ${torrent.name}`)
    }
  }

  resumeTorrent(infoHash: string): void {
    const torrent = this.client.torrents.find(t => t.infoHash === infoHash)
    if (torrent) {
      // Re-select all files
      try { torrent.files?.forEach(f => f.select()) } catch {}
      torrent.resume()
      this.pausedSet.delete(infoHash)
      this.saveTorrentsState()
      console.log(`[TorrentEngine] Resumed: ${torrent.name}`)
    }
  }

  pauseAll(): void {
    this.client.torrents.forEach(t => {
      t.pause()
      try { t.files?.forEach(f => f.deselect()) } catch {}
      try {
        if (t.wires) t.wires.forEach(w => { try { w.destroy() } catch {} })
      } catch {}
      this.pausedSet.add(t.infoHash)
    })
    this.saveTorrentsState()
    console.log(`[TorrentEngine] Paused all (${this.client.torrents.length} torrents)`)
  }

  resumeAll(): void {
    this.client.torrents.forEach(t => {
      try { t.files?.forEach(f => f.select()) } catch {}
      t.resume()
      this.pausedSet.delete(t.infoHash)
    })
    this.saveTorrentsState()
    console.log(`[TorrentEngine] Resumed all`)
  }

  // ─── Per-torrent throttle ──────────────────────────────────

  throttleTorrent(infoHash: string, downLimit: number, upLimit: number): void {
    const torrent = this.client.torrents.find(t => t.infoHash === infoHash)
    if (!torrent) return

    // WebTorrent supports throttleGroups per torrent via _peers throttle
    // downLimit/upLimit in bytes/s, 0 = unlimited
    try {
      if (typeof (torrent as any).throttleDownload === 'function') {
        (torrent as any).throttleDownload(downLimit > 0 ? downLimit : -1)
      }
      if (typeof (torrent as any).throttleUpload === 'function') {
        (torrent as any).throttleUpload(upLimit > 0 ? upLimit : -1)
      }
    } catch {}

    console.log(`[TorrentEngine] Throttle ${torrent.name}: down=${downLimit}, up=${upLimit}`)
  }

  // ─── Info ───────────────────────────────────────────────────

  /** Build and cache static file/tracker info (only once per torrent) */
  private getCachedStatic(torrent: any): { files: TorrentInfo['files']; trackers: string[] } {
    const hash = torrent.infoHash
    if (this.staticCache.has(hash)) return this.staticCache.get(hash)!

    // Only cache once metadata is available
    if (torrent.files?.length > 0) {
      const cached = {
        files: torrent.files.map((f: any, i: number) => ({
          index: i,
          path: f.path,
          name: f.name,
          size: f.length,
          progress: 0  // static snapshot, updated in getFullTorrentInfo
        })),
        trackers: torrent.announce ? [...torrent.announce] : []
      }
      this.staticCache.set(hash, cached)
      return cached
    }

    return { files: [], trackers: torrent.announce ? [...torrent.announce] : [] }
  }

  /** Core torrent state (without heavy file arrays) */
  private getTorrentBase(torrent: any): Omit<TorrentInfo, 'files' | 'trackers'> {
    const isPaused = this.pausedSet.has(torrent.infoHash)
    const progress = Math.round(torrent.progress * 100)

    let state = 'Загрузка'
    if (isPaused) {
      state = 'Приостановлено'
    } else if (progress >= 100) {
      state = torrent.uploadSpeed > 0 ? 'Раздача' : 'Завершено'
    } else if (!torrent.name || torrent.name === torrent.infoHash) {
      state = 'Загрузка метаданных'
    }

    let eta = 0
    if (torrent.downloadSpeed > 0 && torrent.length > 0) {
      const remaining = torrent.length - torrent.downloaded
      eta = remaining / torrent.downloadSpeed
    }

    return {
      id: torrent.infoHash,
      name: torrent.name || 'Загрузка метаданных...',
      state,
      paused: isPaused,
      progress,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      size: torrent.length || 0,
      totalDownload: torrent.downloaded,
      totalUpload: torrent.uploaded,
      numPeers: torrent.numPeers,
      numSeeds: (torrent as any)._peersLength || 0,
      eta,
      savePath: path.join((torrent as any).path || this.settings.downloadDir, torrent.name || ''),
      magnetURI: torrent.magnetURI || '',
      infoHash: torrent.infoHash,
      ratio: torrent.downloaded > 0 ? torrent.uploaded / torrent.downloaded : 0,
      creationDate: (torrent as any).created ? new Date((torrent as any).created).toISOString() : null,
      comment: (torrent as any).comment || null
    }
  }

  /** Full info with files/trackers (for compatibility & initial add) */
  getTorrentInfo(torrent: any): TorrentInfo {
    const base = this.getTorrentBase(torrent)
    const cached = this.getCachedStatic(torrent)
    return { ...base, files: cached.files, trackers: cached.trackers }
  }

  /** Light version — no files/trackers, for fast polling every 1.5-2s */
  getAllTorrentsLight(): Omit<TorrentInfo, 'files' | 'trackers'>[] {
    return this.client.torrents.map((t: any) => this.getTorrentBase(t))
  }

  /** Full info for one torrent — files with live progress, trackers */
  getFullTorrentInfo(infoHash: string): TorrentInfo | null {
    const torrent = this.client.torrents.find((t: any) => t.infoHash === infoHash)
    if (!torrent) return null

    const base = this.getTorrentBase(torrent)
    // Live file progress (computed on-demand, not every tick)
    const files = torrent.files?.map((f: any, i: number) => ({
      index: i,
      path: f.path,
      name: f.name,
      size: f.length,
      progress: Math.round((f as any).progress * 100) || 0
    })) || []
    const trackers = torrent.announce ? [...torrent.announce] : []
    return { ...base, files, trackers }
  }

  getAllTorrents(): TorrentInfo[] {
    return this.client.torrents.map((t: any) => this.getTorrentInfo(t))
  }

  getSessionStats(): SessionStats {
    return {
      downloadRate: this.client.downloadSpeed,
      uploadRate: this.client.uploadSpeed,
      numPeers: this.client.torrents.reduce((acc: number, t: any) => acc + t.numPeers, 0),
      numTorrents: this.client.torrents.length
    }
  }

  // ─── Shutdown ───────────────────────────────────────────────

  async shutdown(): Promise<void> {
    this.saveTorrentsState()
    return new Promise((resolve) => {
      this.client.destroy((err) => {
        if (err) console.error('[TorrentEngine] Shutdown error:', err)
        resolve()
      })
    })
  }
}
