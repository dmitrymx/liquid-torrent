import React from 'react'
import { X, Globe, Send } from 'lucide-react'

declare const __APP_VERSION__: string

export function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content about-modal" onClick={e => e.stopPropagation()}>
        <button className="about-close" onClick={onClose}><X size={16} /></button>

        {/* Animated spinning logo */}
        <div className="about-logo-wrapper">
          <div className="about-logo-glow" />
          <div className="about-logo">
            <span>LT</span>
          </div>
        </div>

        <div className="about-app-name">Liquid Torrent</div>
        <div className="about-version">v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.4.0'}</div>

        <div className="about-divider" />

        <div className="about-dev-label">Разработчик</div>
        <div className="about-dev-name">Максимов Д.А.</div>

        <div className="about-links">
          <button
            className="about-link-btn"
            onClick={() => window.electronAPI.openExternal('https://mxmvdev.ru')}
          >
            <Globe size={15} />
            <span>mxmvdev.ru</span>
          </button>
          <button
            className="about-link-btn telegram"
            onClick={() => window.electronAPI.openExternal('https://t.me/dmitrymx')}
          >
            <Send size={15} />
            <span>@dmitrymx</span>
          </button>
        </div>

        <div className="about-footer">
          © 2026 Liquid Torrent. Все права защищены.
        </div>
      </div>
    </div>
  )
}
