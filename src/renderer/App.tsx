import React, { useEffect, useMemo } from 'react'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { TopBar } from './components/TopBar'
import { TorrentCard } from './components/TorrentCard'
import { RightPanel } from './components/RightPanel'
import { StatusBar } from './components/StatusBar'
import { useTorrentStore, filterTorrents } from './store/useTorrentStore'
import { Download } from 'lucide-react'

export default function App() {
  const setTorrents = useTorrentStore(s => s.setTorrents)
  const setStats = useTorrentStore(s => s.setStats)
  const pushSpeedHistory = useTorrentStore(s => s.pushSpeedHistory)

  const torrents = useTorrentStore(s => s.torrents)
  const filterTab = useTorrentStore(s => s.filterTab)
  const searchQuery = useTorrentStore(s => s.searchQuery)

  const filteredTorrents = useMemo(
    () => filterTorrents(torrents, filterTab, searchQuery),
    [torrents, filterTab, searchQuery]
  )

  // Polling loop: fetch torrent data every 1.5s (less CPU)
  useEffect(() => {
    let running = true

    const poll = async () => {
      while (running && !window.electronAPI) {
        await new Promise(r => setTimeout(r, 500))
      }

      while (running) {
        try {
          const [newTorrents, newStats] = await Promise.all([
            window.electronAPI.getAllTorrentsLight(),
            window.electronAPI.getSessionStats()
          ])
          if (running) {
            setTorrents(newTorrents)
            setStats(newStats)
            pushSpeedHistory(newStats.downloadRate, newStats.uploadRate)
          }
        } catch (e) {
          // ignore
        }
        await new Promise(r => setTimeout(r, 1500))
      }
    }

    poll()
    return () => { running = false }
  }, [])

  return (
    <>
      {/* Ambient background blobs */}
      <div className="ambient-bg">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
      </div>

      <div className="app-layout">
        <Sidebar />
        <div className="main-content">
          <TitleBar />
          <TopBar />
          <div className="torrent-list">
            {filteredTorrents.length > 0 ? (
              filteredTorrents.map(torrent => (
                <TorrentCard key={torrent.id} torrent={torrent} />
              ))
            ) : (
              <div className="empty-state">
                <Download className="empty-state-icon" size={48} />
                <div className="empty-state-text">
                  Нет торрентов. Нажмите «Добавить» чтобы начать.
                </div>
              </div>
            )}
          </div>
          <StatusBar />
        </div>
        <RightPanel />
      </div>
    </>
  )
}
