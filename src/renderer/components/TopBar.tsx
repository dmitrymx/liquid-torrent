import React, { useState } from 'react'
import { useTorrentStore } from '../store/useTorrentStore'
import { Plus, Link, Play, PauseIcon, Trash2, Search } from 'lucide-react'
import AddTorrentModal from './AddTorrentModal'

export function TopBar() {
  const searchQuery = useTorrentStore(s => s.searchQuery)
  const setSearchQuery = useTorrentStore(s => s.setSearchQuery)
  const selectedId = useTorrentStore(s => s.selectedId)
  const torrents = useTorrentStore(s => s.torrents)

  const [showMagnetModal, setShowMagnetModal] = useState(false)
  const [magnetInput, setMagnetInput] = useState('')
  const [torrentFileToAdd, setTorrentFileToAdd] = useState<string | null>(null)

  const handleAddFile = async () => {
    try {
      const files = await window.electronAPI.openTorrentDialog()
      if (files?.length) {
        setTorrentFileToAdd(files[0])
      }
    } catch {}
  }

  const handleConfirmAddFile = async (filePath: string, savePath: string, start: boolean, filePriorities: number[]) => {
    try {
      await window.electronAPI.addTorrentFile(filePath, savePath, start, filePriorities)
      setTorrentFileToAdd(null)
    } catch (err) {
      console.error('[TopBar] Failed to add torrent file:', err)
    }
  }

  const handleAddMagnet = async () => {
    const uri = magnetInput.trim()
    if (!uri) return
    try {
      await window.electronAPI.addMagnet(uri)
      setMagnetInput('')
      setShowMagnetModal(false)
    } catch {}
  }

  const handleResumeAll = async () => {
    try { await window.electronAPI.resumeAll() } catch {}
  }

  const handlePauseAll = async () => {
    try { await window.electronAPI.pauseAll() } catch {}
  }

  const handleRemoveSelected = async () => {
    if (!selectedId) return
    const t = torrents.find(t => t.id === selectedId)
    if (!t) return
    try { await window.electronAPI.removeTorrent(t.infoHash, false) } catch {}
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-search">
          <Search className="topbar-search-icon" size={14} />
          <input
            type="text"
            placeholder="Поиск..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="topbar-actions">
          <button className="btn btn-primary btn-sm" onClick={handleAddFile} title="Добавить .torrent файл">
            <Plus size={13} /> Добавить
          </button>
          <button className="btn btn-glass btn-sm" onClick={() => setShowMagnetModal(true)} title="Магнет-ссылка">
            <Link size={13} /> Магнет
          </button>

          <div className="topbar-sep" />

          <button className="btn btn-glass btn-sm" onClick={handleResumeAll} title="Старт все">
            <Play size={13} />
          </button>
          <button className="btn btn-glass btn-sm" onClick={handlePauseAll} title="Пауза все">
            <PauseIcon size={13} />
          </button>
          <button className="btn btn-danger btn-sm" onClick={handleRemoveSelected} title="Удалить выбранный">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Magnet Modal */}
      {showMagnetModal && (
        <div className="modal-overlay" onClick={() => setShowMagnetModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Добавить магнет-ссылку</div>
            <input
              className="modal-input"
              type="text"
              placeholder="magnet:?xt=urn:btih:..."
              value={magnetInput}
              onChange={e => setMagnetInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddMagnet()}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn btn-glass" onClick={() => setShowMagnetModal(false)}>Отмена</button>
              <button className="btn btn-primary" onClick={handleAddMagnet}>Добавить</button>
            </div>
          </div>
        </div>
      )}

      {torrentFileToAdd && (
        <AddTorrentModal
          filePath={torrentFileToAdd}
          onClose={() => setTorrentFileToAdd(null)}
          onAdd={handleConfirmAddFile}
        />
      )}
    </>
  )
}
