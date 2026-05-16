import React from 'react'
import { Minus, Square, X } from 'lucide-react'

export function TitleBar() {
  return (
    <div className="titlebar">
      <span className="titlebar-title">Liquid Torrent</span>
      <div className="titlebar-controls">
        <button className="titlebar-btn" onClick={() => window.electronAPI.minimize()}>
          <Minus size={12} />
        </button>
        <button className="titlebar-btn" onClick={() => window.electronAPI.maximize()}>
          <Square size={10} />
        </button>
        <button className="titlebar-btn close" onClick={() => window.electronAPI.close()}>
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
