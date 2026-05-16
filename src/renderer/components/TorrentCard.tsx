import React, { useState, useRef, useEffect } from 'react'
import { TorrentInfo, useTorrentStore } from '../store/useTorrentStore'
import { Pause, Trash2, FolderOpen, Play, Square, Gauge } from 'lucide-react'

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0 || !isFinite(bytes)) return '0 Б'
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return (bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i]
}

function formatSpeed(bps: number): string {
  if (!bps || bps <= 0 || !isFinite(bps)) return '—'
  const units = ['Б/с', 'КБ/с', 'МБ/с', 'ГБ/с']
  const i = Math.min(Math.floor(Math.log(bps) / Math.log(1024)), units.length - 1)
  return (bps / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i]
}

function formatETA(seconds: number): string {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '∞'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}ч ${m}м`
  if (m > 0) return `${m}м ${s}с`
  return `${s}с`
}

function getStatusLabel(t: TorrentInfo): string {
  if (t.paused) return 'ПАУЗА'
  if (t.progress >= 100) return 'РАЗДАЧА'
  return `${t.progress}%`
}

function getStatusClass(t: TorrentInfo): string {
  if (t.paused) return 'paused'
  if (t.progress >= 100) return 'seeding'
  return 'downloading'
}

// ─── Context Menu ────────────────────────────────────────────

interface ContextMenuProps {
  x: number
  y: number
  torrent: TorrentInfo
  onClose: () => void
}

function ContextMenu({ x, y, torrent, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const [pos, setPos] = useState({ x, y })
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const nx = Math.min(x, window.innerWidth - rect.width - 8)
    const ny = Math.min(y, window.innerHeight - rect.height - 8)
    setPos({ x: Math.max(4, nx), y: Math.max(4, ny) })
  }, [x, y])

  const action = async (fn: () => Promise<void> | void) => {
    onClose()
    try { await fn() } catch {}
  }

  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [dlLimit, setDlLimit] = useState('')
  const [ulLimit, setUlLimit] = useState('')

  const applyLimit = () => {
    const dl = parseInt(dlLimit) || 0
    const ul = parseInt(ulLimit) || 0
    try {
      window.electronAPI.throttleTorrent(torrent.infoHash, dl * 1024, ul * 1024)
    } catch {}
    onClose()
  }

  return (
    <div ref={menuRef} className="context-menu" style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 200 }}>
      {torrent.paused ? (
        <button className="context-menu-item" onClick={() => action(() => window.electronAPI.resumeTorrent(torrent.infoHash))}>
          <Play size={13} /> Продолжить
        </button>
      ) : (
        <button className="context-menu-item" onClick={() => action(() => window.electronAPI.pauseTorrent(torrent.infoHash))}>
          <Pause size={13} /> Пауза
        </button>
      )}
      {!torrent.paused && torrent.progress >= 100 && (
        <button className="context-menu-item" onClick={() => action(() => window.electronAPI.pauseTorrent(torrent.infoHash))}>
          <Square size={13} /> Остановить раздачу
        </button>
      )}
      <div className="context-menu-sep" />
      <button className="context-menu-item" onClick={() => action(() => window.electronAPI.openPath(torrent.savePath))}>
        <FolderOpen size={13} /> Открыть расположение
      </button>
      <div className="context-menu-sep" />
      <button className="context-menu-item" onClick={() => setShowSpeedMenu(!showSpeedMenu)}>
        <Gauge size={13} /> Ограничение скорости {showSpeedMenu ? '▾' : '▸'}
      </button>
      {showSpeedMenu && (
        <div className="ctx-speed-panel" onClick={e => e.stopPropagation()}>
          <div className="ctx-speed-row">
            <label>↓ КБ/с</label>
            <input
              type="number" min="0" placeholder="0 = ∞"
              value={dlLimit} onChange={e => setDlLimit(e.target.value)}
              className="ctx-speed-input"
            />
          </div>
          <div className="ctx-speed-row">
            <label>↑ КБ/с</label>
            <input
              type="number" min="0" placeholder="0 = ∞"
              value={ulLimit} onChange={e => setUlLimit(e.target.value)}
              className="ctx-speed-input"
            />
          </div>
          <div className="ctx-speed-btns">
            <button className="ctx-speed-apply" onClick={applyLimit}>Применить</button>
            <button className="ctx-speed-reset" onClick={() => { setDlLimit(''); setUlLimit(''); applyLimit() }}>
              Сбросить
            </button>
          </div>
        </div>
      )}
      <div className="context-menu-sep" />
      <button className="context-menu-item" onClick={() => action(() => window.electronAPI.removeTorrent(torrent.infoHash, false))}>
        <Trash2 size={13} /> Удалить из списка
      </button>
      <button className="context-menu-item danger" onClick={() => action(() => window.electronAPI.removeTorrent(torrent.infoHash, true))}>
        <Trash2 size={13} /> Удалить с файлами
      </button>
    </div>
  )
}

// ─── Torrent Card (Compact) ──────────────────────────────────

function TorrentCardInner({ torrent }: { torrent: TorrentInfo }) {
  const selectedId = useTorrentStore(s => s.selectedId)
  const setSelectedId = useTorrentStore(s => s.setSelectedId)
  const isSelected = selectedId === torrent.id
  const status = getStatusClass(torrent)

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  const handlePause = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      if (torrent.paused) await window.electronAPI.resumeTorrent(torrent.infoHash)
      else await window.electronAPI.pauseTorrent(torrent.infoHash)
    } catch {}
  }

  const handleStop = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try { await window.electronAPI.pauseTorrent(torrent.infoHash) } catch {}
  }

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try { await window.electronAPI.removeTorrent(torrent.infoHash, false) } catch {}
  }

  const handleOpenFolder = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try { await window.electronAPI.openPath(torrent.savePath) } catch {}
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedId(torrent.id)
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <>
      <div
        className={`torrent-card ${isSelected ? 'selected' : ''} ${status}`}
        onClick={() => setSelectedId(isSelected ? null : torrent.id)}
        onContextMenu={handleContextMenu}
      >
        {/* Line 1: icon, name, size, actions */}
        <div className="tc-line1">
          <div className={`tc-status-dot ${status}`} />
          <div className="tc-name">{torrent.name}</div>
          <div className="tc-size">{formatSize(torrent.size)}</div>
          <div className="tc-actions">
            <button className="btn-icon-sm" onClick={handleOpenFolder} title="Папка">
              <FolderOpen size={12} />
            </button>
            <button className="btn-icon-sm" onClick={handlePause} title={torrent.paused ? 'Старт' : 'Пауза'}>
              {torrent.paused ? <Play size={12} /> : <Pause size={12} />}
            </button>
            {!torrent.paused && torrent.progress >= 100 && (
              <button className="btn-icon-sm" onClick={handleStop} title="Стоп">
                <Square size={12} />
              </button>
            )}
            <button className="btn-icon-sm tc-del" onClick={handleRemove} title="Удалить">
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {/* Line 2: status, speed, peers, eta */}
        <div className="tc-line2">
          <span className={`tc-status ${status}`}>{getStatusLabel(torrent)}</span>
          {!torrent.paused && torrent.progress < 100 && (
            <>
              <span className="tc-speed down">↓{formatSpeed(torrent.downloadSpeed)}</span>
              <span className="tc-speed up">↑{formatSpeed(torrent.uploadSpeed)}</span>
            </>
          )}
          {!torrent.paused && torrent.progress >= 100 && (
            <span className="tc-speed up">↑{formatSpeed(torrent.uploadSpeed)}</span>
          )}
          <span className="tc-peers">{torrent.numPeers}/{torrent.numSeeds} Seeds</span>
          {torrent.progress < 100 && <span className="tc-eta">ETA: {formatETA(torrent.eta)}</span>}
        </div>

        {/* Progress bar */}
        <div className="tc-progress">
          <div className={`tc-progress-fill ${status}`} style={{ width: `${Math.min(torrent.progress, 100)}%` }} />
        </div>
      </div>

      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} torrent={torrent} onClose={() => setCtxMenu(null)} />
      )}
    </>
  )
}

// React.memo with custom comparator — skip re-render if visible data unchanged
export const TorrentCard = React.memo(TorrentCardInner, (prev, next) => {
  const a = prev.torrent
  const b = next.torrent
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.progress === b.progress &&
    a.paused === b.paused &&
    a.state === b.state &&
    a.downloadSpeed === b.downloadSpeed &&
    a.uploadSpeed === b.uploadSpeed &&
    a.numPeers === b.numPeers &&
    a.numSeeds === b.numSeeds &&
    a.size === b.size &&
    a.eta === b.eta
  )
})
