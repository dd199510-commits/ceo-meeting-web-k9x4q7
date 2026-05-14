import {
  Building2,
  CalendarRange,
  CalendarPlus,
  ChevronDown,
  ContactRound,
  Download,
  FolderKanban,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Upload,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const TAB_META = {
  meetings: { label: '会议库', icon: FolderKanban },
  planner: { label: '排程', icon: CalendarRange },
  reserveNotice: { label: '预留通知', icon: Megaphone },
  outlookInvite: { label: '会邀生成', icon: CalendarPlus },
  contacts: { label: '通讯录', icon: ContactRound },
  logs: { label: '记录', icon: ScrollText },
}

export function AppSidebar({
  activeTab,
  collapsed,
  onTabChange,
  onToggleCollapse,
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
    <aside className={collapsed ? 'app-sidebar app-sidebar-collapsed' : 'app-sidebar'}>
      <div className="app-sidebar-brand">
        <div className="app-sidebar-logo" aria-hidden="true">
          <Building2 size={22} />
        </div>
        {collapsed ? null : (
          <div className="app-sidebar-brand-copy">
            <span className="app-sidebar-eyebrow">CEO Office</span>
            <strong>会议管理系统</strong>
            <span>Version 2.5</span>
          </div>
        )}
        <button
          className="icon-button app-sidebar-toggle"
          onClick={onToggleCollapse}
          type="button"
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="app-sidebar-nav" aria-label="系统主导航">
        {Object.entries(TAB_META).map(([id, meta]) => (
          <button
            key={id}
            className={activeTab === id ? 'app-sidebar-link app-sidebar-link-active' : 'app-sidebar-link'}
            onClick={() => onTabChange(id)}
            type="button"
            title={meta.label}
            aria-label={meta.label}
          >
            <meta.icon size={16} />
            {collapsed ? null : <strong>{meta.label}</strong>}
          </button>
        ))}
      </nav>

      <div className="app-sidebar-footer">
        <div className="toolbar-menu app-sidebar-menu" ref={backupMenuRef}>
          <button
            className={
              backupMenuOpen
                ? `ghost-button toolbar-menu-trigger app-sidebar-backup-trigger${collapsed ? ' app-sidebar-backup-trigger-collapsed' : ''} toolbar-menu-trigger-open`
                : `ghost-button toolbar-menu-trigger app-sidebar-backup-trigger${collapsed ? ' app-sidebar-backup-trigger-collapsed' : ''}`
            }
            onClick={() => setBackupMenuOpen((current) => !current)}
            type="button"
            title="系统备份"
          >
            {collapsed ? <Download size={16} /> : '系统备份'}
            {collapsed ? null : <ChevronDown size={16} />}
          </button>
          {backupMenuOpen ? (
            <div className="toolbar-menu-popover app-sidebar-popover app-sidebar-popover-up">
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
    </aside>
  )
}
