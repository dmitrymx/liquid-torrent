import React, { useState, useMemo } from 'react'
import { useTorrentStore, FilterTab } from '../store/useTorrentStore'
import { Layers, Download, Upload, CheckCircle, PauseCircle, Settings, Info } from 'lucide-react'
import { SettingsModal } from './SettingsModal'
import { AboutModal } from './AboutModal'

const navItems: { id: FilterTab; label: string; icon: React.ReactNode }[] = [
  { id: 'all', label: 'Активные', icon: <Layers size={16} /> },
  { id: 'downloading', label: 'Загружаются', icon: <Download size={16} /> },
  { id: 'seeding', label: 'Раздаются', icon: <Upload size={16} /> },
  { id: 'completed', label: 'Завершённые', icon: <CheckCircle size={16} /> },
  { id: 'paused', label: 'Пауза', icon: <PauseCircle size={16} /> },
]

export function Sidebar() {
  const filterTab = useTorrentStore(s => s.filterTab)
  const setFilterTab = useTorrentStore(s => s.setFilterTab)
  const torrents = useTorrentStore(s => s.torrents)
  const [showSettings, setShowSettings] = useState(false)
  const [showAbout, setShowAbout] = useState(false)

  const counts = useMemo<Record<FilterTab, number>>(() => ({
    all: torrents.length,
    downloading: torrents.filter(t => !t.paused && t.progress < 100).length,
    seeding: torrents.filter(t => !t.paused && t.progress >= 100).length,
    completed: torrents.filter(t => t.progress >= 100).length,
    paused: torrents.filter(t => t.paused).length,
  }), [torrents])

  return (
    <>
      <div className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-anim">
            <div className="sidebar-logo-glow" />
            <div className="sidebar-logo-icon">LT</div>
          </div>
          <div className="sidebar-logo-text">Liquid<br />Torrent</div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`sidebar-item ${filterTab === item.id ? 'active' : ''}`}
              onClick={() => setFilterTab(item.id)}
            >
              <span className="sidebar-item-icon">{item.icon}</span>
              <span>{item.label}</span>
              {counts[item.id] > 0 && (
                <span className="sidebar-count">{counts[item.id]}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-item" onClick={() => setShowSettings(true)}>
            <span className="sidebar-item-icon"><Settings size={16} /></span>
            <span>Настройки</span>
          </button>
          <button className="sidebar-item" onClick={() => setShowAbout(true)}>
            <span className="sidebar-item-icon"><Info size={16} /></span>
            <span>О программе</span>
          </button>
        </div>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </>
  )
}
