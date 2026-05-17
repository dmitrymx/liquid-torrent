import React, { useEffect, useState } from 'react'
import { X, FolderOpen } from 'lucide-react'

interface SettingsData {
  downloadDir: string
  maxDownloadSpeed: number
  maxUploadSpeed: number
  maxConnections: number
  port: number
  activeDownloads: number
  activeSeeds: number
  activeLimit: number
  minimizeToTray: boolean
  startMinimized: boolean
  showNotifications: boolean
  autoStart: boolean
  autoStopSeeding: boolean
}

const DEFAULT_EXTRA = {
  minimizeToTray: true,
  startMinimized: false,
  showNotifications: true,
  autoStart: false,
  autoStopSeeding: false,
  activeDownloads: -1,
  activeSeeds: -1,
  activeLimit: -1,
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.electronAPI.getSettings()
      .then(s => setSettings({ ...DEFAULT_EXTRA, ...s }))
      .catch(() => {})
  }, [])

  const handleSave = async () => {
    if (!settings) return
    try {
      await window.electronAPI.saveSettings(settings)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {}
  }

  const handleChooseDir = async () => {
    try {
      const dir = await window.electronAPI.chooseDirDialog()
      if (dir) setSettings(s => s ? { ...s, downloadDir: dir } : s)
    } catch {}
  }

  const toggle = (key: keyof SettingsData) => {
    setSettings(s => s ? { ...s, [key]: !s[key] } : s)
  }

  if (!settings) return null

  // Convert bytes/s to KB/s for display, handle 0 = unlimited
  const dlKB = settings.maxDownloadSpeed <= 0 ? 0 : Math.round(settings.maxDownloadSpeed / 1024)
  const ulKB = settings.maxUploadSpeed <= 0 ? 0 : Math.round(settings.maxUploadSpeed / 1024)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">⚙️ Настройки</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="settings-grid">
          {/* Download dir */}
          <div className="settings-group">
            <label className="settings-label">📂 Папка загрузок</label>
            <div className="settings-dir-row">
              <input
                className="modal-input"
                value={settings.downloadDir}
                onChange={e => setSettings({ ...settings, downloadDir: e.target.value })}
              />
              <button className="btn btn-glass" onClick={handleChooseDir} style={{ flexShrink: 0 }}>
                <FolderOpen size={14} />
              </button>
            </div>
          </div>

          {/* Speed limits */}
          <div className="settings-section-title">Ограничения скорости</div>
          <div className="settings-row-2">
            <div className="settings-group">
              <label className="settings-label">↓ Макс. загрузка (КБ/с)</label>
              <input
                className="modal-input"
                type="number"
                min="0"
                placeholder="0 = без лимита"
                value={dlKB}
                onChange={e => setSettings({ ...settings, maxDownloadSpeed: Number(e.target.value) * 1024 })}
              />
              <span className="settings-hint">0 = без ограничений</span>
            </div>
            <div className="settings-group">
              <label className="settings-label">↑ Макс. отдача (КБ/с)</label>
              <input
                className="modal-input"
                type="number"
                min="0"
                placeholder="0 = без лимита"
                value={ulKB}
                onChange={e => setSettings({ ...settings, maxUploadSpeed: Number(e.target.value) * 1024 })}
              />
              <span className="settings-hint">0 = без ограничений</span>
            </div>
          </div>

          {/* Queueing */}
          <div className="settings-section-title">Очередь</div>
          <div className="settings-row-3">
            <div className="settings-group">
              <label className="settings-label">Актив. загрузки</label>
              <input
                className="modal-input"
                type="number"
                min="-1"
                placeholder="-1 = ∞"
                value={settings.activeDownloads}
                onChange={e => setSettings({ ...settings, activeDownloads: Number(e.target.value) })}
              />
              <span className="settings-hint">-1 = без лимита</span>
            </div>
            <div className="settings-group">
              <label className="settings-label">Актив. раздачи</label>
              <input
                className="modal-input"
                type="number"
                min="-1"
                placeholder="-1 = ∞"
                value={settings.activeSeeds}
                onChange={e => setSettings({ ...settings, activeSeeds: Number(e.target.value) })}
              />
              <span className="settings-hint">-1 = без лимита</span>
            </div>
            <div className="settings-group">
              <label className="settings-label">Актив. всего</label>
              <input
                className="modal-input"
                type="number"
                min="-1"
                placeholder="-1 = ∞"
                value={settings.activeLimit}
                onChange={e => setSettings({ ...settings, activeLimit: Number(e.target.value) })}
              />
              <span className="settings-hint">-1 = без лимита</span>
            </div>
          </div>

          {/* Connections & Port */}
          <div className="settings-section-title">Сеть</div>
          <div className="settings-row-2">
            <div className="settings-group">
              <label className="settings-label">Макс. подключений</label>
              <input
                className="modal-input"
                type="number"
                value={settings.maxConnections}
                onChange={e => setSettings({ ...settings, maxConnections: Number(e.target.value) })}
              />
            </div>
            <div className="settings-group">
              <label className="settings-label">Порт</label>
              <input
                className="modal-input"
                type="number"
                value={settings.port}
                onChange={e => setSettings({ ...settings, port: Number(e.target.value) })}
              />
            </div>
          </div>

          {/* Toggles */}
          <div className="settings-section-title">Поведение</div>
          <div className="settings-toggles">
            <label className="settings-toggle">
              <input type="checkbox" checked={settings.minimizeToTray} onChange={() => toggle('minimizeToTray')} />
              <span>Сворачивать в трей при закрытии</span>
            </label>
            <label className="settings-toggle">
              <input type="checkbox" checked={settings.startMinimized} onChange={() => toggle('startMinimized')} />
              <span>Запускать свёрнутым в трей</span>
            </label>
            <label className="settings-toggle">
              <input type="checkbox" checked={settings.showNotifications} onChange={() => toggle('showNotifications')} />
              <span>Уведомления о завершении загрузки</span>
            </label>
            <label className="settings-toggle">
              <input type="checkbox" checked={settings.autoStart} onChange={() => toggle('autoStart')} />
              <span>Автозапуск с Windows</span>
            </label>
            <label className="settings-toggle">
              <input type="checkbox" checked={settings.autoStopSeeding} onChange={() => toggle('autoStopSeeding')} />
              <span>Автостоп раздачи через 10 сек. после скачивания</span>
            </label>
          </div>
        </div>

        <div className="modal-actions">
          {saved && <span style={{ color: '#00ff88', fontSize: 12, marginRight: 'auto' }}>✓ Сохранено!</span>}
          <button className="btn btn-glass" onClick={onClose}>Закрыть</button>
          <button className="btn btn-primary" onClick={handleSave}>Сохранить</button>
        </div>
      </div>
    </div>
  )
}
