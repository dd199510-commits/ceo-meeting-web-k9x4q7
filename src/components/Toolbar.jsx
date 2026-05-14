import { Download, ChevronDown, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const TAB_META = {
  meetings: { label: '会议库', description: '管理会议资料与历史' },
  planner: { label: '排程', description: '生成、审核并确认安排' },
  logs: { label: '记录', description: '查看系统操作日志' },
}

export function Toolbar({
  activeTab,
  onTabChange,
  onImportData,
  onExport,
}) {
  const [backupMenuOpen, setBackupMenuOpen] = useState(false)
  const backupMenuRef = useRef(null)

  useEffect(() => {
    function handlePointerDown(event) {
      if (!backupMenuRef.current?.contains(event.target)) {
        setBackupMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  return (
    <div className="toolbar">
      <div className="toolbar-top">
        <div className="toolbar-brand">
          <div className="toolbar-title-row">
            <h1>CEO Office 会议管理系统</h1>
            <span className="toolbar-version-badge">2.5</span>
            <span className="toolbar-subtitle">{TAB_META[activeTab]?.description}</span>
          </div>
        </div>
        <div className="toolbar-actions toolbar-system-actions">
          <div className="toolbar-menu" ref={backupMenuRef}>
            <button
              className={backupMenuOpen ? 'ghost-button toolbar-menu-trigger toolbar-menu-trigger-open' : 'ghost-button toolbar-menu-trigger'}
              onClick={() => setBackupMenuOpen((current) => !current)}
              type="button"
            >
              系统备份
              <ChevronDown size={16} />
            </button>
            {backupMenuOpen ? (
              <div className="toolbar-menu-popover">
                <button
                  className="toolbar-menu-item"
                  onClick={() => {
                    setBackupMenuOpen(false)
                    onImportData()
                  }}
                  type="button"
                >
                  <Upload size={16} />
                  恢复系统备份
                </button>
                <button
                  className="toolbar-menu-item"
                  onClick={() => {
                    setBackupMenuOpen(false)
                    onExport()
                  }}
                  type="button"
                >
                  <Download size={16} />
                  导出系统备份
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="toolbar-nav-shell">
        <div className="tab-row" role="tablist" aria-label="系统模块导航">
          {Object.entries(TAB_META).map(([id, meta]) => (
            <button
              key={id}
              className={activeTab === id ? 'tab-button tab-active' : 'tab-button'}
              onClick={() => onTabChange(id)}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
            >
              {meta.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
