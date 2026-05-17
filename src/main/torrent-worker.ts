/**
 * Liquid Torrent — WebTorrent Worker (runs in utilityProcess)
 * All heavy WebTorrent operations run here, completely off the main thread.
 * Communication with main process via parentPort.postMessage/on('message')
 */
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// ─── Types ────────────────────────────────────────────────────

interface TorrentInfo {
  id: string; name: string; state: string; paused: boolean
  progress: number; downloadSpeed: number; uploadSpeed: number
  size: number; totalDownload: number; totalUpload: number
  numPeers: number; numSeeds: number; eta: number; savePath: string
  files?: { index: number; path: string; name: string; size: number; progress: number }[]
  trackers?: string[]; magnetURI: string; infoHash: string
  ratio: number; creationDate: string | null; comment: string | null
}

interface EngineSettings {
  downloadDir: string; maxDownloadSpeed: number; maxUploadSpeed: number
  maxConnections: number; port: number; autoStopSeeding?: boolean
  minimizeToTray?: boolean; startMinimized?: boolean
  showNotifications?: boolean; autoStart?: boolean
}

interface WorkerMessage {
  id: string           // unique request id for response matching
  action: string       // method name
  args?: any           // method arguments
}

interface WorkerResponse {
  id: string           // matches request id
  result?: any         // return value
  error?: string       // error message if failed
}

// ─── Constants ────────────────────────────────────────────────

const PUBLIC_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.demonii.com:1337/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.moeking.me:6969/announce'
]

// DHT bootstrap nodes — critical for fast peer discovery (per bittorrent-dht docs)
const DHT_BOOTSTRAP = [
  'router.bittorrent.com:6881',
  'router.utorrent.com:6881',
  'dht.transmissionbt.com:6881'
]

const DEFAULT_SETTINGS: EngineSettings = {
  downloadDir: path.join(os.homedir(), 'Downloads'),
  maxDownloadSpeed: -1,
  maxUploadSpeed: 5 * 1024 * 1024,  // 5 MB/s default — prevents upload from choking download
  maxConnections: 100,
  port: 0,  // 0 = random port (49152+) — avoids ISP throttling of port 6881
  autoStopSeeding: false,
  minimizeToTray: true, startMinimized: false,
  showNotifications: true, autoStart: false
}

// ─── Worker State ─────────────────────────────────────────────

let client: any = null
let settings: EngineSettings = { ...DEFAULT_SETTINGS }
let dataPath = ''
let settingsPath = ''
let torrentsPath = ''
const pausedSet = new Set<string>()
const completedSet = new Set<string>()
const staticCache = new Map<string, { files: TorrentInfo['files']; trackers: string[] }>()
let _saveTimer: ReturnType<typeof setTimeout> | null = null
const _savedTorrentFiles = new Set<string>()

// ─── Helpers ──────────────────────────────────────────────────

function loadSettings(): EngineSettings {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      return { ...DEFAULT_SETTINGS, ...data }
    }
  } catch {}
  return { ...DEFAULT_SETTINGS }
}

function saveSettings(): void {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
  } catch (e) {
    console.error('[Worker] Failed to save settings:', e)
  }
}

function scheduleSave(): void {
  if (_saveTimer) clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => {
    _saveTimer = null
    saveTorrentsStateAsync()
  }, 2000)
}

function saveTorrentsStateSync(): void {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null }
  try {
    const torrentFilesDir = path.join(dataPath, 'torrent-files')
    if (!fs.existsSync(torrentFilesDir)) fs.mkdirSync(torrentFilesDir, { recursive: true })
    const data = client.torrents.map((t: any) => {
      let hasTorrentFile = _savedTorrentFiles.has(t.infoHash)
      if (!hasTorrentFile) {
        try {
          const torrentBuf = t.torrentFile
          if (torrentBuf && torrentBuf.length > 0) {
            fs.writeFileSync(path.join(torrentFilesDir, `${t.infoHash}.torrent`), torrentBuf)
            _savedTorrentFiles.add(t.infoHash)
            hasTorrentFile = true
          }
        } catch {}
      }
      return {
        magnetURI: t.magnetURI, infoHash: t.infoHash,
        savePath: (t as any).path || settings.downloadDir,
        paused: pausedSet.has(t.infoHash), hasTorrentFile,
        progress: Math.round(t.progress * 100)  // Save progress for skipVerify decision
      }
    })
    fs.writeFileSync(torrentsPath, JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.error('[Worker] Save error:', e)
  }
}

async function saveTorrentsStateAsync(): Promise<void> {
  try {
    const torrentFilesDir = path.join(dataPath, 'torrent-files')
    await fs.promises.mkdir(torrentFilesDir, { recursive: true })
    const data = client.torrents.map((t: any) => {
      let hasTorrentFile = _savedTorrentFiles.has(t.infoHash)
      if (!hasTorrentFile) {
        try {
          const torrentBuf = t.torrentFile
          if (torrentBuf && torrentBuf.length > 0) {
            fs.promises.writeFile(path.join(torrentFilesDir, `${t.infoHash}.torrent`), torrentBuf)
              .then(() => _savedTorrentFiles.add(t.infoHash)).catch(() => {})
            hasTorrentFile = true
          }
        } catch {}
      }
      return {
        magnetURI: t.magnetURI, infoHash: t.infoHash,
        savePath: (t as any).path || settings.downloadDir,
        paused: pausedSet.has(t.infoHash), hasTorrentFile,
        progress: Math.round(t.progress * 100)
      }
    })
    await fs.promises.writeFile(torrentsPath, JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.error('[Worker] Async save error:', e)
  }
}

function setupTorrentEvents(torrent: any): void {
  // Peer connection logging (per WebTorrent debugging guide)
  torrent.on('wire', (_wire: any, addr: string) => {
    console.log(`[Worker] Peer connected: ${addr} | total: ${torrent.numPeers} | dl: ${(torrent.downloadSpeed / 1024 / 1024).toFixed(1)} MB/s`)
  })
  torrent.on('error', (err: Error) => {
    console.error(`[Worker] Torrent error [${torrent.name}]:`, err.message)
  })
  torrent.on('warning', (err: Error) => {
    console.warn(`[Worker] Warning [${torrent.name}]:`, err.message)
  })

  // Auto-stop seeding
  torrent.on('done', () => {
    console.log(`[Worker] Download complete: ${torrent.name}`)
    completedSet.add(torrent.infoHash)
    if (settings.autoStopSeeding) {
      setTimeout(() => {
        try {
          if (!pausedSet.has(torrent.infoHash)) {
            torrent.pause()
            pausedSet.add(torrent.infoHash)
            scheduleSave()
            console.log(`[Worker] Auto-stopped seeding: ${torrent.name}`)
          }
        } catch {}
      }, 10000)
    }
  })
}

// ─── Torrent Info Builders ────────────────────────────────────

function getTorrentBase(torrent: any): Omit<TorrentInfo, 'files' | 'trackers'> {
  const isPaused = pausedSet.has(torrent.infoHash)
  const progress = Math.round(torrent.progress * 100)
  let state = 'Загрузка'
  if (isPaused) state = 'Приостановлено'
  else if (progress >= 100) state = torrent.uploadSpeed > 0 ? 'Раздача' : 'Завершено'
  else if (!torrent.name || torrent.name === torrent.infoHash) state = 'Загрузка метаданных'

  let eta = 0
  if (torrent.downloadSpeed > 0 && torrent.length > 0) {
    eta = (torrent.length - torrent.downloaded) / torrent.downloadSpeed
  }

  return {
    id: torrent.infoHash,
    name: torrent.name || 'Загрузка метаданных...',
    state, paused: isPaused, progress,
    downloadSpeed: torrent.downloadSpeed, uploadSpeed: torrent.uploadSpeed,
    size: torrent.length || 0,
    totalDownload: torrent.downloaded, totalUpload: torrent.uploaded,
    numPeers: torrent.numPeers, numSeeds: (torrent as any)._peersLength || 0,
    eta, savePath: path.join((torrent as any).path || settings.downloadDir, torrent.name || ''),
    magnetURI: torrent.magnetURI || '', infoHash: torrent.infoHash,
    ratio: torrent.downloaded > 0 ? torrent.uploaded / torrent.downloaded : 0,
    creationDate: (torrent as any).created ? new Date((torrent as any).created).toISOString() : null,
    comment: (torrent as any).comment || null
  }
}

function getCachedStatic(torrent: any) {
  const hash = torrent.infoHash
  // Only use cache for completed torrents (file progress doesn't change after done)
  if (torrent.progress >= 1 && staticCache.has(hash)) return staticCache.get(hash)!
  if (torrent.files?.length > 0) {
    const data = {
      files: torrent.files.map((f: any, i: number) => ({
        index: i, path: f.path, name: f.name, size: f.length, progress: 0
      })),
      trackers: torrent.announce ? [...torrent.announce] : []
    }
    if (torrent.progress >= 1) staticCache.set(hash, data)
    return data
  }
  return { files: [], trackers: torrent.announce ? [...torrent.announce] : [] }
}

function getTorrentInfo(torrent: any): TorrentInfo {
  const base = getTorrentBase(torrent)
  const cached = getCachedStatic(torrent)
  return { ...base, files: cached.files, trackers: cached.trackers }
}

// ─── Actions ──────────────────────────────────────────────────

async function handleInit(args: { dataPath: string }): Promise<void> {
  dataPath = args.dataPath
  settingsPath = path.join(dataPath, 'settings.json')
  torrentsPath = path.join(dataPath, 'torrents.json')
  settings = loadSettings()

  const WebTorrent = (await import('webtorrent')).default

  // Random port if not set — ISPs throttle default 6881
  const torrentPort = settings.port > 0 ? settings.port : (49152 + Math.floor(Math.random() * 16383))

  client = new WebTorrent({
    maxConns: settings.maxConnections,
    // Per docs: -1 = unlimited, positive = bytes/sec
    downloadLimit: settings.maxDownloadSpeed > 0 ? settings.maxDownloadSpeed : -1,
    uploadLimit: settings.maxUploadSpeed > 0 ? settings.maxUploadSpeed : -1,
    // Per docs: all peer discovery methods for maximum peer count
    dht: { bootstrap: DHT_BOOTSTRAP },
    tracker: true,
    lsd: true,       // BEP14 Local Service Discovery
    utPex: true,     // BEP11 Peer Exchange — peers share peer lists
    webSeeds: true,  // BEP19 Web Seeds — HTTP mirrors for faster download
    utp: true,       // BEP29 µTP — UDP transport, can bypass some ISP throttling
    natUpnp: true,   // NAT-UPnP — auto port mapping for incoming connections
    natPmp: true,    // NAT-PMP — same for Apple routers
  })
  client.on('error', (err: Error) => console.error('[Worker] Client error:', err.message))

  console.log(`[Worker] WebTorrent initialized | port=${torrentPort} | maxConns=${settings.maxConnections} | upLimit=${settings.maxUploadSpeed > 0 ? (settings.maxUploadSpeed/1024/1024).toFixed(1)+'MB/s' : 'unlimited'}`)
}

async function handleLoadSaved(): Promise<void> {
  if (!fs.existsSync(torrentsPath)) return
  const torrentFilesDir = path.join(dataPath, 'torrent-files')
  const data = JSON.parse(fs.readFileSync(torrentsPath, 'utf-8')) as any[]

  const promises = data.map(async (entry) => {
    try {
      const torrentFile = entry.infoHash
        ? path.join(torrentFilesDir, `${entry.infoHash}.torrent`)
        : null

      // skipVerify ONLY for completed (100%) torrents!
      // For incomplete torrents, verification builds correct bitfield
      // so peers know which pieces we need
      const isCompleted = entry.progress >= 100

      if (torrentFile && fs.existsSync(torrentFile)) {
        await handleAddTorrentFile({ filePath: torrentFile, savePath: entry.savePath, start: !entry.paused, skipVerify: isCompleted })
      } else {
        await handleAddMagnet({ magnetURI: entry.magnetURI, savePath: entry.savePath, start: !entry.paused, skipVerify: isCompleted })
      }

      if (entry.paused && entry.infoHash) pausedSet.add(entry.infoHash)
    } catch (e) {
      console.error('[Worker] Failed to restore:', e)
    }
  })

  await Promise.allSettled(promises)
  console.log(`[Worker] Restored ${data.length} torrents`)
}

function handleAddTorrentFile(args: { filePath: string; savePath?: string; start?: boolean; skipVerify?: boolean }): Promise<TorrentInfo> {
  return new Promise((resolve, reject) => {
    const dest = args.savePath || settings.downloadDir
    fs.mkdirSync(dest, { recursive: true })

    let buffer: Buffer
    try { buffer = fs.readFileSync(args.filePath) }
    catch { return reject(new Error(`Файл не найден: ${args.filePath}`)) }

    if (!args.skipVerify) {
      const existing = client.torrents.find((t: any) => {
        try {
          if (!t.infoHash) return false
          return buffer.includes(Buffer.from(t.infoHash, 'hex'))
        } catch { return false }
      })
      if (existing) return resolve(getTorrentInfo(existing))
    }

    const opts: any = {
      path: dest,
      announce: PUBLIC_TRACKERS,
      strategy: 'rarest',           // Per docs: rarest-first = max download speed
      noPeersIntervalTime: 10,      // Check for peers every 10s instead of 30s
      alwaysChokeSeeders: true,     // Don't waste upload on other seeders
    }
    if (args.skipVerify) opts.skipVerify = true
    if (args.start === false) opts.paused = true

    client.add(buffer, opts, (torrent: any) => {
      console.log(`[Worker] Torrent ready: ${torrent.name} | ${torrent.files?.length || 0} files | peers: ${torrent.numPeers}`)
      setupTorrentEvents(torrent)
      if (args.start === false) pausedSet.add(torrent.infoHash)
      scheduleSave()
      resolve(getTorrentInfo(torrent))
    })
  })
}

function handleAddMagnet(args: { magnetURI: string; savePath?: string; start?: boolean; skipVerify?: boolean }): Promise<TorrentInfo> {
  return new Promise((resolve, reject) => {
    if (!args.magnetURI.startsWith('magnet:')) return reject(new Error('Неверная магнет-ссылка'))
    const dest = args.savePath || settings.downloadDir
    fs.mkdirSync(dest, { recursive: true })

    if (!args.skipVerify) {
      const existing = client.torrents.find((t: any) => args.magnetURI.includes(t.infoHash))
      if (existing) return resolve(getTorrentInfo(existing))
    }

    const opts: any = {
      path: dest,
      announce: PUBLIC_TRACKERS,
      strategy: 'rarest',           // Per docs: rarest-first = max download speed
      noPeersIntervalTime: 10,      // Check for peers every 10s instead of 30s
      alwaysChokeSeeders: true,     // Don't waste upload on other seeders
    }
    if (args.skipVerify) opts.skipVerify = true
    if (args.start === false) opts.paused = true

    client.add(args.magnetURI, opts, (torrent: any) => {
      console.log(`[Worker] Magnet ready: ${torrent.name} | peers: ${torrent.numPeers}`)
      setupTorrentEvents(torrent)
      if (args.start === false) pausedSet.add(torrent.infoHash)
      scheduleSave()
      resolve(getTorrentInfo(torrent))
    })
  })
}

function handleRemove(args: { infoHash: string; deleteFiles?: boolean }): void {
  const torrent = client.torrents.find((t: any) => t.infoHash === args.infoHash)
  if (!torrent) return
  client.remove(args.infoHash, { destroyStore: args.deleteFiles || false }, (err: any) => {
    if (err) console.error('[Worker] Remove error:', err)
  })
  pausedSet.delete(args.infoHash)
  staticCache.delete(args.infoHash)
  _savedTorrentFiles.delete(args.infoHash)
  scheduleSave()
}

function handlePause(args: { infoHash: string }): void {
  const torrent = client.torrents.find((t: any) => t.infoHash === args.infoHash)
  if (!torrent) return
  // Per WebTorrent docs: torrent.pause() handles connections correctly
  // DO NOT destroy wires or deselect files — breaks resume!
  torrent.pause()
  pausedSet.add(args.infoHash)
  scheduleSave()
  console.log(`[Worker] Paused: ${torrent.name}`)
}

function handleResume(args: { infoHash: string }): void {
  const torrent = client.torrents.find((t: any) => t.infoHash === args.infoHash)
  if (!torrent) return
  // Per WebTorrent docs: torrent.resume() re-establishes connections
  torrent.resume()
  pausedSet.delete(args.infoHash)
  scheduleSave()
  console.log(`[Worker] Resumed: ${torrent.name} | peers: ${torrent.numPeers}`)
}

function handlePauseAll(): void {
  client.torrents.forEach((t: any) => {
    t.pause()
    pausedSet.add(t.infoHash)
  })
  scheduleSave()
  console.log(`[Worker] Paused all ${client.torrents.length} torrents`)
}

function handleResumeAll(): void {
  client.torrents.forEach((t: any) => {
    t.resume()
    pausedSet.delete(t.infoHash)
  })
  scheduleSave()
  console.log(`[Worker] Resumed all ${client.torrents.length} torrents`)
}

function handleThrottle(args: { infoHash: string; downLimit: number; upLimit: number }): void {
  const torrent = client.torrents.find((t: any) => t.infoHash === args.infoHash)
  if (!torrent) return
  try {
    if (typeof torrent.throttleDownload === 'function') torrent.throttleDownload(args.downLimit > 0 ? args.downLimit : -1)
    if (typeof torrent.throttleUpload === 'function') torrent.throttleUpload(args.upLimit > 0 ? args.upLimit : -1)
  } catch {}
}

function handleGetAllLight() {
  return client.torrents.map((t: any) => getTorrentBase(t))
}

function handleGetFullInfo(args: { infoHash: string }): TorrentInfo | null {
  const torrent = client.torrents.find((t: any) => t.infoHash === args.infoHash)
  if (!torrent) return null
  const base = getTorrentBase(torrent)
  const files = torrent.files?.map((f: any, i: number) => ({
    index: i, path: f.path, name: f.name, size: f.length,
    progress: Math.round((f as any).progress * 100) || 0
  })) || []
  const trackers = torrent.announce ? [...torrent.announce] : []
  return { ...base, files, trackers }
}

function handleGetAllTorrents(): TorrentInfo[] {
  return client.torrents.map((t: any) => getTorrentInfo(t))
}

function handleGetSessionStats() {
  return {
    downloadRate: client.downloadSpeed, uploadRate: client.uploadSpeed,
    numPeers: client.torrents.reduce((a: number, t: any) => a + t.numPeers, 0),
    numTorrents: client.torrents.length
  }
}

function handleGetSettings(): EngineSettings { return { ...settings } }

function handleUpdateSettings(args: { settings: Partial<EngineSettings> }): EngineSettings {
  settings = { ...settings, ...args.settings }
  saveSettings()
  // Apply runtime changes
  if (client) {
    if (settings.maxDownloadSpeed > 0) client.throttleDownload(settings.maxDownloadSpeed)
    else client.throttleDownload(-1)
    if (settings.maxUploadSpeed > 0) client.throttleUpload(settings.maxUploadSpeed)
    else client.throttleUpload(-1)
  }
  return { ...settings }
}

async function handleShutdown(): Promise<void> {
  saveTorrentsStateSync()
  return new Promise<void>((resolve) => {
    client.destroy((err: any) => {
      if (err) console.error('[Worker] Shutdown error:', err)
      resolve()
    })
  })
}

// ─── Message Router ───────────────────────────────────────────

const actionMap: Record<string, (args?: any) => any> = {
  init: handleInit,
  loadSaved: handleLoadSaved,
  addTorrentFile: handleAddTorrentFile,
  addMagnet: handleAddMagnet,
  remove: handleRemove,
  pause: handlePause,
  resume: handleResume,
  pauseAll: handlePauseAll,
  resumeAll: handleResumeAll,
  throttle: handleThrottle,
  getAllLight: handleGetAllLight,
  getFullInfo: handleGetFullInfo,
  getAllTorrents: handleGetAllTorrents,
  getSessionStats: handleGetSessionStats,
  getSettings: handleGetSettings,
  updateSettings: handleUpdateSettings,
  shutdown: handleShutdown
}

process.parentPort!.on('message', async ({ data }: { data: WorkerMessage }) => {
  const { id, action, args } = data
  const handler = actionMap[action]
  if (!handler) {
    process.parentPort!.postMessage({ id, error: `Unknown action: ${action}` } as WorkerResponse)
    return
  }

  try {
    const result = await handler(args)
    process.parentPort!.postMessage({ id, result } as WorkerResponse)
  } catch (e: any) {
    console.error(`[Worker] Error in ${action}:`, e)
    process.parentPort!.postMessage({ id, error: e.message || String(e) } as WorkerResponse)
  }
})

console.log('[Worker] Torrent worker process started')
