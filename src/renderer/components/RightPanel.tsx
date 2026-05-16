import React, { useRef, useEffect, useMemo, useState } from 'react'
import { useTorrentStore, getSelectedTorrent, RightPanelTab } from '../store/useTorrentStore'
import { ChevronRight, ChevronDown, Folder, FileText } from 'lucide-react'

// ─── Helpers ──────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0 || !isFinite(bytes)) return '0 Б'
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return (bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i]
}

function formatSpeed(bps: number): string {
  if (!bps || bps <= 0 || !isFinite(bps)) return '0 Б/с'
  const units = ['Б/с', 'КБ/с', 'МБ/с', 'ГБ/с']
  const i = Math.min(Math.floor(Math.log(bps) / Math.log(1024)), units.length - 1)
  return (bps / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i]
}

// ─── File Tree ───────────────────────────────────────────────

interface FileNode {
  name: string
  size: number
  progress: number
  children?: Record<string, FileNode>
  isDir: boolean
}

function buildFileTree(files: { path: string; name: string; size: number; progress: number }[]): FileNode {
  const root: FileNode = { name: '', size: 0, isDir: true, children: {}, progress: 0 }

  for (const f of files) {
    const filePath = (f.path || f.name).replace(/\\/g, '/') 
    const parts = filePath.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!node.children) node.children = {}
      if (i === parts.length - 1) {
        // leaf file
        node.children[part] = { name: part, size: f.size, progress: f.progress, isDir: false }
      } else {
        if (!node.children[part]) {
          node.children[part] = { name: part, size: 0, isDir: true, children: {}, progress: 0 }
        }
        node = node.children[part]
      }
    }
  }

  // Compute folder sizes
  function computeSize(n: FileNode): number {
    if (!n.isDir || !n.children) return n.size
    let total = 0
    for (const c of Object.values(n.children)) total += computeSize(c)
    n.size = total
    return total
  }
  computeSize(root)

  return root
}

function FileTreeNode({ node, depth = 0 }: { node: FileNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 1)

  if (node.isDir && node.children) {
    const entries = Object.values(node.children).sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return (
      <div>
        {node.name && (
          <div
            className="file-tree-row"
            style={{ paddingLeft: depth * 12 }}
            onClick={() => setOpen(!open)}
          >
            <span className="file-tree-arrow">
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
            <Folder size={13} style={{ color: '#ffab40', flexShrink: 0 }} />
            <span className="file-tree-name">{node.name}</span>
            <span className="file-tree-size">{formatSize(node.size)}</span>
          </div>
        )}
        {(open || !node.name) && entries.map((child, i) => (
          <FileTreeNode key={child.name + i} node={child} depth={node.name ? depth + 1 : 0} />
        ))}
      </div>
    )
  }

  return (
    <div className="file-tree-row" style={{ paddingLeft: depth * 12 }}>
      <span className="file-tree-arrow" style={{ visibility: 'hidden' }}>
        <ChevronRight size={12} />
      </span>
      <FileText size={13} style={{ color: '#6b7280', flexShrink: 0 }} />
      <span className="file-tree-name">{node.name}</span>
      <span className="file-tree-size">{formatSize(node.size)}</span>
    </div>
  )
}

// ─── Circular Progress — Modern Thin Ring ────────────────────

function CircularProgress({ progress }: { progress: number }) {
  const size = 120
  const stroke = 6
  const glowStroke = 18
  const pad = 30 // generous padding so glow never clips
  const cx = size / 2
  const cy = size / 2
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (progress / 100) * circ

  return (
    <div className="circular-progress">
      <svg
        width={size + pad * 2}
        height={size + pad * 2}
        viewBox={`${-pad} ${-pad} ${size + pad * 2} ${size + pad * 2}`}
        style={{ overflow: 'visible' }}
      >
        <defs>
          {/* Multi-stop gradient: violet → blue → cyan → green */}
          <linearGradient id="cpGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="30%" stopColor="#3b82f6" />
            <stop offset="65%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
          {/* Glow filter */}
          <filter id="cpGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Soft outer glow only */}
          <filter id="cpSoftGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" />
          </filter>
        </defs>

        {/* Background track — subtle */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={stroke + 2}
        />

        {/* Always-pulsing outer glow ring */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none" stroke="url(#cpGrad)"
          strokeWidth={glowStroke} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cy})`}
          filter="url(#cpSoftGlow)"
          className="cp-pulse-always"
        />

        {/* Main progress arc */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none" stroke="url(#cpGrad)"
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(.4,0,.2,1)' }}
          filter="url(#cpGlow)"
        />

        {/* Percentage text */}
        <text x={cx} y={cy - 3}
          textAnchor="middle" dominantBaseline="middle"
          fill="#e5e7eb" fontSize="20" fontWeight="700" fontFamily="Inter, sans-serif"
        >{progress}%</text>
        <text x={cx} y={cy + 14}
          textAnchor="middle" dominantBaseline="middle"
          fill="#6b7280" fontSize="9" fontFamily="Inter, sans-serif"
          letterSpacing="0.5"
        >{progress >= 100 ? 'ЗАВЕРШЕНО' : 'СКАЧАНО'}</text>
      </svg>
    </div>
  )
}

// ─── Speed Graph (Canvas) + Legend ───────────────────────────

function SpeedGraph({ data }: { data: { down: number; up: number }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    const w = rect.width, h = rect.height
    ctx.clearRect(0, 0, w, h)

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'
    ctx.lineWidth = 1
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    if (data.length < 2) return
    const maxVal = Math.max(...data.map(d => Math.max(d.down, d.up)), 1024)

    const drawCurve = (values: number[], color: string, fill: string) => {
      const pts = values.map((v, i) => ({
        x: (i / (values.length - 1)) * w,
        y: (1 - v / maxVal) * (h - 4) + 2
      }))
      // Fill
      ctx.beginPath()
      ctx.moveTo(pts[0].x, h)
      ctx.lineTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) {
        const cx = (pts[i - 1].x + pts[i].x) / 2
        ctx.bezierCurveTo(cx, pts[i - 1].y, cx, pts[i].y, pts[i].x, pts[i].y)
      }
      ctx.lineTo(pts[pts.length - 1].x, h)
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
      // Line
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) {
        const cx = (pts[i - 1].x + pts[i].x) / 2
        ctx.bezierCurveTo(cx, pts[i - 1].y, cx, pts[i].y, pts[i].x, pts[i].y)
      }
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.stroke()
    }

    drawCurve(data.map(d => d.down), '#00bbff', 'rgba(0,187,255,0.15)')
    drawCurve(data.map(d => d.up), '#00ff88', 'rgba(0,255,136,0.08)')
  }, [data])

  const lastDown = data.length > 0 ? data[data.length - 1].down : 0
  const lastUp = data.length > 0 ? data[data.length - 1].up : 0

  return (
    <div className="speed-graph-wrap">
      <canvas ref={canvasRef} style={{ width: '100%', height: 90, display: 'block', borderRadius: 8 }} />
      <div className="speed-graph-legend">
        <span className="speed-legend-item">
          <span className="speed-legend-dot" style={{ background: '#00bbff' }} />
          Загрузка ↓ {formatSpeed(lastDown)}
        </span>
        <span className="speed-legend-item">
          <span className="speed-legend-dot" style={{ background: '#00ff88' }} />
          Отдача ↑ {formatSpeed(lastUp)}
        </span>
      </div>
    </div>
  )
}

// ─── Right Panel ─────────────────────────────────────────────

const tabs: { id: RightPanelTab; label: string }[] = [
  { id: 'status', label: 'Статус' },
  { id: 'files', label: 'Файлы' },
  { id: 'peers', label: 'Пиры' },
  { id: 'trackers', label: 'Трекеры' },
]

export function RightPanel() {
  const rightTab = useTorrentStore(s => s.rightTab)
  const setRightTab = useTorrentStore(s => s.setRightTab)
  const speedHistory = useTorrentStore(s => s.speedHistory)
  const torrents = useTorrentStore(s => s.torrents)
  const selectedId = useTorrentStore(s => s.selectedId)

  const torrent = useMemo(
    () => getSelectedTorrent(torrents, selectedId),
    [torrents, selectedId]
  )
  const progress = torrent?.progress ?? 0

  // Lazy-load full torrent info (files + trackers) only when needed
  const [fullInfo, setFullInfo] = useState<any>(null)
  const [fullInfoHash, setFullInfoHash] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedId) { setFullInfo(null); setFullInfoHash(null); return }
    // Only fetch when viewing files or trackers tab, or when selected torrent changes
    if (rightTab !== 'files' && rightTab !== 'trackers' && fullInfoHash === selectedId) return

    let cancelled = false
    const fetchFull = async () => {
      try {
        const info = await window.electronAPI.getFullTorrentInfo(selectedId)
        if (!cancelled && info) {
          setFullInfo(info)
          setFullInfoHash(selectedId)
        }
      } catch {}
    }
    fetchFull()

    // Refresh every 5s while viewing files tab (for progress updates)
    let interval: ReturnType<typeof setInterval> | null = null
    if (rightTab === 'files') {
      interval = setInterval(fetchFull, 5000)
    }

    return () => { cancelled = true; if (interval) clearInterval(interval) }
  }, [selectedId, rightTab])

  const fileTree = useMemo(() => {
    if (!fullInfo?.files?.length) return null
    return buildFileTree(fullInfo.files)
  }, [fullInfo?.files])

  return (
    <div className="right-panel">
      <div className="right-panel-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`right-panel-tab ${rightTab === tab.id ? 'active' : ''}`}
            onClick={() => setRightTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="right-panel-content">
        {rightTab === 'status' && (
          <>
            <CircularProgress progress={progress} />

            {/* Neon stat cards */}
            <div className="neon-stats">
              <div className="neon-stat-card">
                <div className="neon-stat-icon" style={{ color: '#00bbff' }}>↓</div>
                <div className="neon-stat-info">
                  <div className="neon-stat-value" style={{ color: '#00bbff' }}>
                    {torrent ? formatSpeed(torrent.downloadSpeed) : '—'}
                  </div>
                  <div className="neon-stat-label">Загрузка</div>
                </div>
              </div>
              <div className="neon-stat-card">
                <div className="neon-stat-icon" style={{ color: '#00ff88' }}>↑</div>
                <div className="neon-stat-info">
                  <div className="neon-stat-value" style={{ color: '#00ff88' }}>
                    {torrent ? formatSpeed(torrent.uploadSpeed) : '—'}
                  </div>
                  <div className="neon-stat-label">Отдача</div>
                </div>
              </div>
            </div>

            <div className="neon-stats">
              <div className="neon-stat-card mini">
                <div className="neon-stat-label">Размер</div>
                <div className="neon-stat-value sm">{torrent ? formatSize(torrent.size) : '—'}</div>
              </div>
              <div className="neon-stat-card mini">
                <div className="neon-stat-label">Пиры</div>
                <div className="neon-stat-value sm">{torrent?.numPeers ?? 0}</div>
              </div>
              <div className="neon-stat-card mini">
                <div className="neon-stat-label">Сиды</div>
                <div className="neon-stat-value sm">{torrent?.numSeeds ?? 0}</div>
              </div>
            </div>

            <div>
              <div className="right-panel-section-title">График скорости</div>
              <SpeedGraph data={speedHistory} />
            </div>
          </>
        )}

        {rightTab === 'files' && (
          <div>
            <div className="right-panel-section-title">
              Файлы {fullInfo?.files?.length ? `(${fullInfo.files.length})` : ''}
            </div>
            {fileTree ? (
              <div className="file-tree">
                <FileTreeNode node={fileTree} />
              </div>
            ) : (
              <div style={{ fontSize: 11, color: '#6b7280', padding: '8px 0' }}>
                {torrent ? 'Загрузка метаданных...' : 'Выберите торрент'}
              </div>
            )}
          </div>
        )}

        {rightTab === 'peers' && (
          <div>
            <div className="right-panel-section-title">Пиры</div>
            <div className="detail-row">
              <span className="detail-label">Подключено</span>
              <span className="detail-value">{torrent?.numPeers ?? 0}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Сиды</span>
              <span className="detail-value">{torrent?.numSeeds ?? 0}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Ratio</span>
              <span className="detail-value">{torrent?.ratio?.toFixed(2) ?? '0.00'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Загружено</span>
              <span className="detail-value">{torrent ? formatSize(torrent.totalDownload) : '—'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Отдано</span>
              <span className="detail-value">{torrent ? formatSize(torrent.totalUpload) : '—'}</span>
            </div>
          </div>
        )}

        {rightTab === 'trackers' && (
          <div>
            <div className="right-panel-section-title">
              Трекеры {fullInfo?.trackers?.length ? `(${fullInfo.trackers.length})` : ''}
            </div>
            {fullInfo?.trackers?.length ? fullInfo.trackers.map((url: string, i: number) => (
              <div key={i} className="tracker-row">
                <span className="tracker-dot" /> {url}
              </div>
            )) : (
              <div style={{ fontSize: 11, color: '#6b7280', padding: '8px 0' }}>
                {torrent ? 'DHT / PEX' : 'Выберите торрент'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
