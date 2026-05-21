/**
 * Liquid Torrent — TorrentEngine Proxy (libtorrent sidecar)
 * Communicates with Python libtorrent sidecar via stdin/stdout JSON-RPC.
 * All CPU-heavy work runs in the Python process — main thread stays responsive.
 */
import { app } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as readline from 'readline'

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
  activeDownloads?: number
  activeSeeds?: number
  activeLimit?: number
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
  private worker: ChildProcess | null = null
  private rl: readline.Interface | null = null
  private _ready = false
  private dataPath: string
  private settingsPath: string
  private settings: EngineSettings
  private pendingRequests = new Map<string, PendingRequest>()
  private msgId = 0

  constructor() {
    // Always use %APPDATA%/liquid-torrent for stable data persistence
    // Portable NSIS extracts to random temp dirs — can't reliably write next to exe
    this.dataPath = path.join(app.getPath('appData'), 'liquid-torrent')
    fs.mkdirSync(this.dataPath, { recursive: true })
    this.settingsPath = path.join(this.dataPath, 'settings.json')
    this.settings = this.loadSettings()
  }

  /** Start the Python libtorrent sidecar process */
  async init(): Promise<void> {
    const sidecarPath = this.findSidecar()
    console.log(`[TorrentEngine] Starting sidecar: ${sidecarPath}`)

    if (sidecarPath.endsWith('.exe')) {
      // Production: bundled PyInstaller executable
      this.worker = spawn(sidecarPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    } else {
      // Dev: find real Python (not WindowsApps store shim)
      const pythonPath = this.findPython()
      console.log(`[TorrentEngine] Using Python: ${pythonPath}`)
      this.worker = spawn(pythonPath, [sidecarPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    }

    // Parse JSON responses line-by-line from stdout
    this.rl = readline.createInterface({ input: this.worker.stdout! })
    this.rl.on('line', (line: string) => {
      try {
        const data = JSON.parse(line)
        if (data.event) {
          this.handleSidecarEvent(data.event, data.data)
          return
        }
        const pending = this.pendingRequests.get(data.id)
        if (pending) {
          this.pendingRequests.delete(data.id)
          if (data.error) {
            pending.reject(new Error(data.error))
          } else {
            pending.resolve(data.result)
          }
        }
      } catch {
        // Not JSON — ignore
      }
    })

    // Log stderr (Python's print to stderr)
    if (this.worker.stderr) {
      const stderrRl = readline.createInterface({ input: this.worker.stderr })
      stderrRl.on('line', (line: string) => {
        console.log(`[Sidecar] ${line}`)
      })
    }

    this.worker.on('exit', (code: number | null) => {
      console.error(`[TorrentEngine] Sidecar exited with code ${code}`)
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error('Sidecar process exited'))
        this.pendingRequests.delete(id)
      }
    })

    // Initialize libtorrent inside the sidecar
    await this.send('init', { dataPath: this.dataPath })
    this._ready = true
    console.log('[TorrentEngine] libtorrent sidecar initialized!')
  }

  private handleSidecarEvent(event: string, data: any): void {
    if (event === 'torrent_finished') {
      if (this.settings.showNotifications) {
        import('electron').then(({ Notification }) => {
          const notif = new Notification({
            title: 'Скачивание завершено! 🎉',
            body: `Торрент "${data.name}" успешно скачан.`,
            icon: path.join(__dirname, '../../resources/icon.png')
          })
          notif.show()
        }).catch(console.error)
      }
    }
  }

  /** Find the sidecar executable or script */
  private findSidecar(): string {
    // 1. Check for bundled PyInstaller exe next to the app
    const exeDir = path.dirname(process.execPath)
    const candidates = [
      path.join(exeDir, 'resources', 'torrent_sidecar.exe'),
      path.join(exeDir, 'resources', 'torrent-engine.exe'),
      path.join(exeDir, 'torrent_sidecar.exe'),
      // 2. Dev mode: scripts folder
      path.join(__dirname, '..', '..', 'scripts', 'torrent_sidecar.py'),
      path.join(__dirname, '..', 'scripts', 'torrent_sidecar.py'),
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) return c
    }
    // Fallback: assume it's in scripts/
    return path.join(process.cwd(), 'scripts', 'torrent_sidecar.py')
  }

  /** Find real Python installation (skip WindowsApps store shim) */
  private findPython(): string {
    const home = os.homedir()
    // Check common Python installations where libtorrent is installed
    const candidates = [
      path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
      path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
      path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python310', 'python.exe'),
      path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'python.exe'),
      'C:\\Python311\\python.exe',
      'C:\\Python312\\python.exe',
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) return c
    }
    // Fallback to PATH
    return 'python'
  }

  /** Send a message to the sidecar and wait for response */
  private send(action: string, args?: any, timeoutMs?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = `msg_${++this.msgId}_${Date.now()}`
      this.pendingRequests.set(id, { resolve, reject })

      const msg = JSON.stringify({ id, action, args }) + '\n'
      this.worker!.stdin!.write(msg)

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
    this.pendingRequests.set(id, {
      resolve: () => this.pendingRequests.delete(id),
      reject: () => this.pendingRequests.delete(id)
    })
    const msg = JSON.stringify({ id, action, args }) + '\n'
    this.worker!.stdin!.write(msg)
    setTimeout(() => this.pendingRequests.delete(id), 10000)
  }

  // ─── Settings (loaded in main for UI, synced to sidecar) ─────

  private loadSettings(): EngineSettings {
    const DEFAULT_SETTINGS: EngineSettings = {
      downloadDir: path.join(os.homedir(), 'Downloads'),
      maxDownloadSpeed: -1,
      maxUploadSpeed: -1,
      maxConnections: 200, port: 6881,
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
    const result = await this.send('updateSettings', { settings: newSettings })
    return result
  }

  // ─── Torrent Operations (delegated to sidecar) ──────────────

  async loadSavedTorrents(): Promise<void> {
    await this.send('loadSaved', undefined, 600000)
  }

  async addTorrentFile(filePath: string, savePath?: string, start = true, filePriorities?: number[]): Promise<TorrentInfo> {
    return this.send('addTorrentFile', { filePath, savePath, start, filePriorities }, 300000)
  }

  async parseTorrentFile(filePath: string): Promise<any> {
    const raw = await this.send('parseTorrentFile', { filePath }, 60000)
    if (!raw || !raw.files) return raw
    return {
      name: raw.name,
      infoHash: raw.infoHash,
      size: raw.size,
      files: raw.files.map((f: any) => {
        const p = f.p || ''
        const lastSlash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
        return {
          index: f.i,
          path: p,
          name: lastSlash !== -1 ? p.substring(lastSlash + 1) : p,
          size: f.s,
          progress: 0,
          priority: 4
        }
      })
    }
  }

  prioritizeFiles(infoHash: string, priorities: number[]): void {
    this.sendNoWait('prioritizeFiles', { infoHash, priorities })
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

  // ─── Info Queries (delegated to sidecar) ────────────────────

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

  // ─── Persistence ───────────────────────────────────────────

  saveTorrentsState(): void {
    this.sendNoWait('save')
  }

  // ─── Shutdown ──────────────────────────────────────────────

  async shutdown(): Promise<void> {
    try {
      // Send shutdown command — sidecar saves resume data + torrents.json
      await this.send('shutdown', undefined, 10000)
    } catch {
      // Sidecar may have already exited or timed out
    }
    // Wait for the process to exit gracefully
    await new Promise<void>((resolve) => {
      if (!this.worker || this.worker.exitCode !== null) {
        resolve()
        return
      }
      const timeout = setTimeout(() => {
        try { this.worker?.kill('SIGKILL') } catch {}
        resolve()
      }, 3000)
      this.worker.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
    try {
      this.rl?.close()
    } catch {}
  }
}
