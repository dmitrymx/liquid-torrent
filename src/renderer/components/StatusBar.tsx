import React from 'react'
import { useTorrentStore } from '../store/useTorrentStore'

function formatSpeed(bps: number): string {
  if (!bps || bps <= 0 || !isFinite(bps)) return '0 Б/с'
  const units = ['Б/с', 'КБ/с', 'МБ/с', 'ГБ/с']
  const i = Math.min(Math.floor(Math.log(bps) / Math.log(1024)), units.length - 1)
  return (bps / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i]
}

export function StatusBar() {
  const stats = useTorrentStore(s => s.stats)

  return (
    <div className="statusbar">
      <div className="statusbar-item">
        <span style={{ color: '#00bbff' }}>↓</span>
        Total Down: <span style={{ color: '#e5e7eb' }}>{formatSpeed(stats.downloadRate)}</span>
      </div>
      <div className="statusbar-item">
        <span style={{ color: '#00ff88' }}>↑</span>
        Total Up: <span style={{ color: '#e5e7eb' }}>{formatSpeed(stats.uploadRate)}</span>
      </div>
      <div className="statusbar-item">
        Peers: {stats.numPeers}
      </div>
      <div className="statusbar-spacer" />
      <div className="statusbar-item">
        <div className="statusbar-dot" />
        Подключено
      </div>
    </div>
  )
}
