import React, { useState, useEffect, useRef } from 'react'
import { useTorrentStore } from '../store/useTorrentStore'

function formatSpeed(bps: number): string {
  if (!bps || bps <= 0 || !isFinite(bps)) return '0 Б/с'
  const units = ['Б/с', 'КБ/с', 'МБ/с', 'ГБ/с']
  const i = Math.min(Math.floor(Math.log(bps) / Math.log(1024)), units.length - 1)
  return (bps / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i]
}

export function StatusBar() {
  const stats = useTorrentStore(s => s.stats)
  
  const [showDownMenu, setShowDownMenu] = useState(false)
  const [showUpMenu, setShowUpMenu] = useState(false)
  const [downLimit, setDownLimit] = useState(0)
  const [upLimit, setUpLimit] = useState(0)
  const [customDown, setCustomDown] = useState('')
  const [customUp, setCustomUp] = useState('')

  const downMenuRef = useRef<HTMLDivElement>(null)
  const upMenuRef = useRef<HTMLDivElement>(null)

  // Fetch current speed limits on mount
  useEffect(() => {
    window.electronAPI.getSettings().then(s => {
      setDownLimit(s.maxDownloadSpeed || 0)
      setUpLimit(s.maxUploadSpeed || 0)
    })
  }, [])

  // Close menus on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (downMenuRef.current && !downMenuRef.current.contains(event.target as Node)) {
        setShowDownMenu(false)
      }
      if (upMenuRef.current && !upMenuRef.current.contains(event.target as Node)) {
        setShowUpMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSaveDownLimit = async (limitBps: number) => {
    setDownLimit(limitBps)
    try {
      const current = await window.electronAPI.getSettings()
      await window.electronAPI.saveSettings({ ...current, maxDownloadSpeed: limitBps })
    } catch (e) {
      console.error(e)
    }
    setShowDownMenu(false)
  }

  const handleSaveUpLimit = async (limitBps: number) => {
    setUpLimit(limitBps)
    try {
      const current = await window.electronAPI.getSettings()
      await window.electronAPI.saveSettings({ ...current, maxUploadSpeed: limitBps })
    } catch (e) {
      console.error(e)
    }
    setShowUpMenu(false)
  }

  const handleCustomDownSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const val = parseFloat(customDown)
    if (!isNaN(val) && val >= 0) {
      // Input is in KB/s, convert to B/s
      handleSaveDownLimit(Math.round(val * 1024))
    }
    setCustomDown('')
  }

  const handleCustomUpSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const val = parseFloat(customUp)
    if (!isNaN(val) && val >= 0) {
      // Input is in KB/s, convert to B/s
      handleSaveUpLimit(Math.round(val * 1024))
    }
    setCustomUp('')
  }

  const downOptions = [
    { label: 'Без ограничений', value: 0 },
    { label: '50 КБ/с', value: 50 * 1024 },
    { label: '100 КБ/с', value: 100 * 1024 },
    { label: '500 КБ/с', value: 500 * 1024 },
    { label: '1 МБ/с', value: 1024 * 1024 },
    { label: '5 МБ/с', value: 5 * 1024 * 1024 },
    { label: '10 МБ/с', value: 10 * 1024 * 1024 }
  ]

  const upOptions = [
    { label: 'Без ограничений', value: 0 },
    { label: '10 КБ/с', value: 10 * 1024 },
    { label: '50 КБ/с', value: 50 * 1024 },
    { label: '100 КБ/с', value: 100 * 1024 },
    { label: '500 КБ/с', value: 500 * 1024 },
    { label: '1 МБ/с', value: 1024 * 1024 },
    { label: '5 МБ/с', value: 5 * 1024 * 1024 }
  ]

  return (
    <div className="statusbar">
      {/* Download speed indicator with popup limit menu */}
      <div className="statusbar-item" style={{ position: 'relative' }} ref={downMenuRef}>
        <div 
          className="status-bar-speed-trigger" 
          onClick={() => { setShowDownMenu(!showDownMenu); setShowUpMenu(false) }}
        >
          <span style={{ color: '#00bbff' }}>↓</span>
          Down: <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{formatSpeed(stats.downloadRate)}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 2 }}>
            [{downLimit > 0 ? formatSpeed(downLimit) : '∞'}]
          </span>
        </div>

        {showDownMenu && (
          <div className="status-bar-speed-menu">
            <h4>Лимит скачивания</h4>
            {downOptions.map(opt => (
              <div 
                key={opt.value}
                className={`speed-limit-option ${downLimit === opt.value ? 'active' : ''}`}
                onClick={() => handleSaveDownLimit(opt.value)}
              >
                <span>{opt.label}</span>
              </div>
            ))}
            <form onSubmit={handleCustomDownSubmit} style={{ marginTop: 4, display: 'flex', gap: 6 }}>
              <input 
                type="number"
                placeholder="Свой (КБ/с)"
                className="add-torrent-input"
                style={{ padding: '4px 8px', fontSize: 11 }}
                value={customDown}
                onChange={e => setCustomDown(e.target.value)}
                min="0"
              />
              <button 
                type="submit" 
                className="add-torrent-btn" 
                style={{ padding: '4px 8px', fontSize: 11 }}
              >
                ОК
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Upload speed indicator with popup limit menu */}
      <div className="statusbar-item" style={{ position: 'relative' }} ref={upMenuRef}>
        <div 
          className="status-bar-speed-trigger" 
          onClick={() => { setShowUpMenu(!showUpMenu); setShowDownMenu(false) }}
        >
          <span style={{ color: '#00ff88' }}>↑</span>
          Up: <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{formatSpeed(stats.uploadRate)}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 2 }}>
            [{upLimit > 0 ? formatSpeed(upLimit) : '∞'}]
          </span>
        </div>

        {showUpMenu && (
          <div className="status-bar-speed-menu">
            <h4>Лимит отдачи</h4>
            {upOptions.map(opt => (
              <div 
                key={opt.value}
                className={`speed-limit-option ${upLimit === opt.value ? 'active' : ''}`}
                onClick={() => handleSaveUpLimit(opt.value)}
              >
                <span>{opt.label}</span>
              </div>
            ))}
            <form onSubmit={handleCustomUpSubmit} style={{ marginTop: 4, display: 'flex', gap: 6 }}>
              <input 
                type="number"
                placeholder="Свой (КБ/с)"
                className="add-torrent-input"
                style={{ padding: '4px 8px', fontSize: 11 }}
                value={customUp}
                onChange={e => setCustomUp(e.target.value)}
                min="0"
              />
              <button 
                type="submit" 
                className="add-torrent-btn" 
                style={{ padding: '4px 8px', fontSize: 11 }}
              >
                ОК
              </button>
            </form>
          </div>
        )}
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
