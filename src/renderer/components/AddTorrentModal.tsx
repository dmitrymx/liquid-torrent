import React, { useState, useEffect, useMemo } from 'react'
import { Folder, FileText, ChevronDown, ChevronRight, HardDrive, X } from 'lucide-react'

interface FileItem {
  index: number
  path: string
  name: string
  size: number
  progress: number
  priority?: number
}

interface AddTorrentModalProps {
  filePath: string
  onClose: () => void
  onAdd: (filePath: string, savePath: string, start: boolean, filePriorities: number[]) => void
}

interface FileNode {
  name: string
  size: number
  isDir: boolean
  children?: Record<string, FileNode>
  index?: number
  fileIndices?: number[]
  checked?: boolean
  indeterminate?: boolean
}

function buildFileTree(files: FileItem[]): FileNode {
  const root: FileNode = { name: '', size: 0, isDir: true, children: {}, fileIndices: [] }

  for (const f of files) {
    const filePath = (f.path || f.name).replace(/\\/g, '/')
    const parts = filePath.split('/')
    let node = root
    node.fileIndices?.push(f.index)
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!node.children) node.children = {}
      if (i === parts.length - 1) {
        node.children[part] = { name: part, size: f.size, isDir: false, index: f.index }
      } else {
        if (!node.children[part]) {
          node.children[part] = { name: part, size: 0, isDir: true, children: {}, fileIndices: [] }
        }
        node = node.children[part]
        node.fileIndices?.push(f.index)
      }
    }
  }

  function computeSize(n: FileNode): number {
    if (!n.isDir || !n.children) return n.size
    let total = 0
    for (const c of Object.values(n.children)) total += computeSize(c)
    n.size = total
    return total
  }
  computeSize(root)

  return root
}

export default function AddTorrentModal({ filePath, onClose, onAdd }: AddTorrentModalProps) {
  const [metadata, setMetadata] = useState<{ name: string; size: number; files: FileItem[] } | null>(null)
  const [savePath, setSavePath] = useState('')
  const [startTorrent, setStartTorrent] = useState(true)
  const [filePriorities, setFilePriorities] = useState<Record<number, boolean>>({})
  const [freeSpace, setFreeSpace] = useState<{ free: number; total: number } | null>(null)
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({ '': true })
  const [loading, setLoading] = useState(true)

  const onCloseRef = React.useRef(onClose)
  onCloseRef.current = onClose

  // Parse file and load settings
  useEffect(() => {
    let active = true
    setLoading(true)
    
    // Get initial settings to set default save path
    window.electronAPI.getSettings().then((settings) => {
      if (active) {
        setSavePath(settings.downloadDir || '')
      }
    })

    window.electronAPI.parseTorrentFile(filePath)
      .then((meta) => {
        if (!active) return
        if (!meta) {
          alert('Не удалось разобрать торрент-файл. Возможно, файл поврежден или заблокирован.')
          onCloseRef.current()
          return
        }
        setMetadata(meta)
        // Check all files by default
        const prios: Record<number, boolean> = {}
        meta.files.forEach((f: FileItem) => {
          prios[f.index] = true
        })
        setFilePriorities(prios)
        setLoading(false)
      })
      .catch((err) => {
        console.error(err)
        if (active) {
          alert('Произошла ошибка при загрузке торрент-файла.')
          onCloseRef.current()
        }
      })

    return () => {
      active = false
    }
  }, [filePath])

  // Fetch free disk space when savePath changes
  useEffect(() => {
    if (!savePath) return
    let active = true
    window.electronAPI.getFreeSpace(savePath).then((space) => {
      if (active) setFreeSpace(space)
    }).catch(() => {
      if (active) setFreeSpace(null)
    })
    return () => {
      active = false
    }
  }, [savePath])

  const fileTree = useMemo(() => {
    if (!metadata?.files) return null
    const root = buildFileTree(metadata.files)

    // Compute checked and indeterminate states for every node
    function computeCheckStates(n: FileNode): { checkedCount: number; totalCount: number } {
      if (!n.isDir) {
        const isChecked = !!filePriorities[n.index ?? 0]
        n.checked = isChecked
        n.indeterminate = false
        return { checkedCount: isChecked ? 1 : 0, totalCount: 1 }
      }

      let checkedCount = 0
      let totalCount = 0
      if (n.children) {
        for (const c of Object.values(n.children)) {
          const stats = computeCheckStates(c)
          checkedCount += stats.checkedCount
          totalCount += stats.totalCount
        }
      }

      n.checked = checkedCount === totalCount && totalCount > 0
      n.indeterminate = checkedCount > 0 && checkedCount < totalCount
      return { checkedCount, totalCount }
    }

    computeCheckStates(root)
    return root
  }, [metadata, filePriorities])

  const handleChooseDir = async () => {
    const dir = await window.electronAPI.chooseDirDialog()
    if (dir) setSavePath(dir)
  }

  const toggleFile = (index: number) => {
    setFilePriorities((prev) => ({ ...prev, [index]: !prev[index] }))
  }

  const toggleFolder = (indices: number[], check: boolean) => {
    setFilePriorities((prev) => {
      const next = { ...prev }
      indices.forEach((idx) => {
        next[idx] = check
      })
      return next
    })
  }

  const formatSize = (bytes: number) => {
    if (bytes <= 0) return '0 B'
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`
  }

  // Recursive tree renderer
  const renderTreeNode = (node: FileNode, pathKey: string, depth: number) => {
    const isExpanded = !!expandedNodes[pathKey]
    const toggleExpand = () => {
      setExpandedNodes((prev) => ({ ...prev, [pathKey]: !prev[pathKey] }))
    }

    if (node.isDir && node.children) {
      const childrenEntries = Object.entries(node.children).sort((a, b) => {
        if (a[1].isDir !== b[1].isDir) return a[1].isDir ? -1 : 1
        return a[0].localeCompare(b[0])
      })

      const indices = node.fileIndices || []
      const isChecked = !!node.checked
      const isSomeChecked = !!node.indeterminate

      const handleFolderCheckClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        toggleFolder(indices, !isChecked)
      }

      return (
        <div key={pathKey}>
          {node.name && (
            <div
              className="file-tree-row"
              style={{ paddingLeft: depth * 16 }}
              onClick={toggleExpand}
            >
              <span className="file-tree-arrow">
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
              <div
                className={`tree-checkbox ${isChecked ? 'checked' : ''} ${isSomeChecked ? 'indeterminate' : ''}`}
                onClick={handleFolderCheckClick}
              />
              <Folder size={14} style={{ color: '#ffab40', flexShrink: 0 }} />
              <span className="file-tree-name">{node.name}</span>
              <span className="file-tree-size">{formatSize(node.size)}</span>
            </div>
          )}
          {(isExpanded || !node.name) &&
            childrenEntries.map(([name, child]) =>
              renderTreeNode(child, pathKey ? `${pathKey}/${name}` : name, node.name ? depth + 1 : 0)
            )}
        </div>
      )
    }

    // Leaf file node
    const fileIdx = node.index ?? 0
    const isChecked = !!filePriorities[fileIdx]

    return (
      <div
        key={pathKey}
        className="file-tree-row"
        style={{ paddingLeft: depth * 16 }}
        onClick={() => toggleFile(fileIdx)}
      >
        <span className="file-tree-arrow" style={{ visibility: 'hidden' }}>
          <ChevronRight size={14} />
        </span>
        <div
          className={`tree-checkbox ${isChecked ? 'checked' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            toggleFile(fileIdx)
          }}
        />
        <FileText size={14} style={{ color: '#9ca3af', flexShrink: 0 }} />
        <span className="file-tree-name">{node.name}</span>
        <span className="file-tree-size">{formatSize(node.size)}</span>
      </div>
    )
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!metadata) return
    const priorities = metadata.files.map((f) => (filePriorities[f.index] ? 4 : 0))
    onAdd(filePath, savePath, startTorrent, priorities)
  }

  if (loading || !metadata) {
    return (
      <div className="add-torrent-modal-overlay">
        <div className="add-torrent-modal" style={{ width: 400, height: 200, justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Загрузка метаданных торрента...</div>
        </div>
      </div>
    )
  }

  // Calculate selected size
  const selectedSize = metadata.files
    .filter((f) => filePriorities[f.index])
    .reduce((acc, f) => acc + f.size, 0)

  // Calculate free space percentage
  const spacePercentage = freeSpace && freeSpace.total > 0
    ? Math.max(0, Math.min(100, Math.round((freeSpace.free / freeSpace.total) * 100)))
    : 0

  return (
    <div className="add-torrent-modal-overlay">
      <form className="add-torrent-modal" onSubmit={handleSubmit}>
        <div className="add-torrent-header">
          <h2>Добавить новый торрент</h2>
          <button type="button" className="titlebar-btn" onClick={onClose} style={{ height: 28, width: 28 }}>
            <X size={16} />
          </button>
        </div>

        <div className="add-torrent-body">
          <div className="add-torrent-left">
            <div className="add-torrent-field">
              <label>Имя торрента</label>
              <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 13, wordBreak: 'break-all' }}>
                {metadata.name}
              </div>
            </div>

            <div className="add-torrent-field">
              <label>Папка назначения</label>
              <div className="add-torrent-input-row">
                <input
                  type="text"
                  className="add-torrent-input"
                  value={savePath}
                  onChange={(e) => setSavePath(e.target.value)}
                  required
                />
                <button type="button" className="add-torrent-btn" onClick={handleChooseDir}>
                  Обзор...
                </button>
              </div>
            </div>

            {freeSpace && (
              <div className="disk-info">
                <div className="disk-info-row" style={{ marginBottom: 4, color: 'var(--text-secondary)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <HardDrive size={13} /> Свободно на диске
                  </span>
                  <span>{formatSize(freeSpace.free)} / {formatSize(freeSpace.total)}</span>
                </div>
                <div className="disk-info-bar" style={{ marginBottom: 8 }}>
                  <div className="disk-info-fill" style={{ width: `${spacePercentage}%` }} />
                </div>
                <div className="disk-info-row" style={{ fontSize: 11 }}>
                  <span>Размер раздачи:</span>
                  <span style={{ fontWeight: 600, color: selectedSize > freeSpace.free ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                    {formatSize(selectedSize)}
                  </span>
                </div>
                {selectedSize > freeSpace.free && (
                  <div style={{ color: 'var(--accent-red)', fontSize: 10, marginTop: 6, fontWeight: 600 }}>
                    ⚠️ Недостаточно места на диске!
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="add-torrent-right">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Содержимое торрента
              </label>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Выбрано файлов: {metadata.files.filter((f) => filePriorities[f.index]).length} из {metadata.files.length}
              </span>
            </div>
            <div className="files-tree-container">
              {fileTree && renderTreeNode(fileTree, '', 0)}
            </div>
          </div>
        </div>

        <div className="add-torrent-footer">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
            <input
              type="checkbox"
              checked={startTorrent}
              onChange={(e) => setStartTorrent(e.target.checked)}
              style={{ width: 14, height: 14, cursor: 'pointer' }}
            />
            Начать скачивание сразу
          </label>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="add-torrent-btn" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="add-torrent-btn primary">
              Добавить торрент
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
