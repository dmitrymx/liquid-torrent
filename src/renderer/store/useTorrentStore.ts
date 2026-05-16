/**
 * Liquid Torrent — State Management (Zustand)
 */
import { create } from 'zustand'

declare global {
  interface Window {
    electronAPI: {
      minimize: () => void
      maximize: () => void
      close: () => void
      isMaximized: () => Promise<boolean>
      addTorrentFile: (filePath: string, savePath?: string) => Promise<any>
      addMagnet: (magnetURI: string, savePath?: string) => Promise<any>
      removeTorrent: (infoHash: string, deleteFiles: boolean) => Promise<void>
      pauseTorrent: (infoHash: string) => Promise<void>
      resumeTorrent: (infoHash: string) => Promise<void>
      pauseAll: () => Promise<void>
      resumeAll: () => Promise<void>
      throttleTorrent: (infoHash: string, downLimit: number, upLimit: number) => Promise<void>
      getAllTorrents: () => Promise<TorrentInfo[]>
      getAllTorrentsLight: () => Promise<TorrentInfo[]>
      getFullTorrentInfo: (infoHash: string) => Promise<TorrentInfo | null>
      getSessionStats: () => Promise<SessionStats>
      getSettings: () => Promise<any>
      saveSettings: (s: any) => Promise<void>
      openTorrentDialog: () => Promise<string[]>
      chooseDirDialog: () => Promise<string | null>
      openPath: (p: string) => Promise<void>
      openExternal: (url: string) => void
      getFreeSpace: () => Promise<{ free: number; total: number }>
    }
  }
}

export interface TorrentInfo {
  id: string
  name: string
  state: string
  paused: boolean
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  size: number
  totalDownload: number
  totalUpload: number
  numPeers: number
  numSeeds: number
  eta: number
  savePath: string
  files?: { index: number; path: string; name: string; size: number; progress: number }[]
  trackers?: string[]
  magnetURI: string
  infoHash: string
  ratio: number
  creationDate: string | null
  comment: string | null
}

export interface SessionStats {
  downloadRate: number
  uploadRate: number
  numPeers: number
  numTorrents: number
}

export type FilterTab = 'all' | 'downloading' | 'seeding' | 'completed' | 'paused'
export type RightPanelTab = 'status' | 'files' | 'peers' | 'trackers'

interface TorrentStore {
  torrents: TorrentInfo[]
  stats: SessionStats
  selectedId: string | null
  filterTab: FilterTab
  rightTab: RightPanelTab
  searchQuery: string
  speedHistory: { down: number; up: number }[]

  setTorrents: (t: TorrentInfo[]) => void
  setStats: (s: SessionStats) => void
  setSelectedId: (id: string | null) => void
  setFilterTab: (tab: FilterTab) => void
  setRightTab: (tab: RightPanelTab) => void
  setSearchQuery: (q: string) => void
  pushSpeedHistory: (down: number, up: number) => void
}

export const useTorrentStore = create<TorrentStore>((set) => ({
  torrents: [],
  stats: { downloadRate: 0, uploadRate: 0, numPeers: 0, numTorrents: 0 },
  selectedId: null,
  filterTab: 'all',
  rightTab: 'status',
  searchQuery: '',
  speedHistory: [],

  setTorrents: (t) => set({ torrents: t }),
  setStats: (s) => set({ stats: s }),
  setSelectedId: (id) => set({ selectedId: id }),
  setFilterTab: (tab) => set({ filterTab: tab }),
  setRightTab: (tab) => set({ rightTab: tab }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  pushSpeedHistory: (down, up) =>
    set((s) => ({
      speedHistory: [...s.speedHistory.slice(-59), { down, up }]
    }))
}))

// ─── Computed selectors (pure functions, no infinite loops) ───

export function filterTorrents(
  torrents: TorrentInfo[],
  filterTab: FilterTab,
  searchQuery: string
): TorrentInfo[] {
  let filtered = torrents

  switch (filterTab) {
    case 'downloading':
      filtered = filtered.filter(t => !t.paused && t.progress < 100)
      break
    case 'seeding':
      filtered = filtered.filter(t => !t.paused && t.progress >= 100)
      break
    case 'completed':
      filtered = filtered.filter(t => t.progress >= 100)
      break
    case 'paused':
      filtered = filtered.filter(t => t.paused)
      break
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase()
    filtered = filtered.filter(t => t.name.toLowerCase().includes(q))
  }

  return filtered
}

export function getSelectedTorrent(
  torrents: TorrentInfo[],
  selectedId: string | null
): TorrentInfo | null {
  if (!selectedId) return null
  return torrents.find(t => t.id === selectedId) || null
}
