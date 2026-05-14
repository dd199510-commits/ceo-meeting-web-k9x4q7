import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarDays,
  ChevronDown,
  ChevronsUpDown,
  Clock,
  Download,
  FileText,
  Filter,
  GripVertical,
  Link2,
  Mail,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { FREQUENCY_LABELS, getMeetingFrequencyType } from '../../data/meetingData'
import { getAttendeeSummary, getResolvedAttendeeStats, splitAttendees } from '../../lib/contacts'
import { calculateNextOccurrence, formatNextDateInfo } from '../../lib/meetingFrequency'
import { FilterPanel } from './FilterPanel'
import { InlineEditPanel } from './InlineEditPanel'
import { TrashView } from '../trash/TrashView'
import {
  filterMeetings,
  getActiveFilterTags,
  getCompactFrequencyLabel,
  getGroupTone,
  getGroupSummary,
  getSubGroupKey,
  getSubGroupLabel,
  getSubGroupTone,
  groupMeetingsByFrequency,
  hasActiveFilters,
  sortMeetings,
} from './meetingsUtils'

function getAttendeeList(meeting) {
  return splitAttendees(meeting.attendees)
}

function getMeetingDateLabel(meeting) {
  const nextOccurrence = calculateNextOccurrence(meeting)
  const nextDateInfo = formatNextDateInfo(nextOccurrence)
  return nextDateInfo.prefix ? `${nextDateInfo.prefix} ${nextDateInfo.date}` : nextDateInfo.date
}

export function MeetingsView({
  contentTab,
  meetings,
  deletedMeetings,
  filters,
  setFilters,
  defaultFilters,
  showFilters,
  setShowFilters,
  onDeleteMeeting,
  onRestoreMeeting,
  onDeleteMeetingForever,
  onReorderMeetings,
  onSaveMeeting,
  contacts = [],
  onAddContact,
  onCreateMeeting,
  onBatchImport,
  onGoToPlanner,
}) {
  const [sortBy, setSortBy] = useState('frequency')
  const [collapsedGroups, setCollapsedGroups] = useState([])
  const [collapsedSubGroups, setCollapsedSubGroups] = useState({})
  const [draggedMeetingId, setDraggedMeetingId] = useState(null)
  const [inlineEditingId, setInlineEditingId] = useState(null)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [selectedMeetingId, setSelectedMeetingId] = useState('')
  const [navigatorFilter, setNavigatorFilter] = useState({ type: 'all', key: 'all' })
  const [quickFilter, setQuickFilter] = useState('all')
  const moreMenuRef = useRef(null)

  const summaryFilters = useMemo(
    () => ({
      ...filters,
      frequency: 'all',
      frequencyTypes: [],
    }),
    [filters],
  )
  const filteredMeetings = useMemo(() => filterMeetings(meetings, filters), [filters, meetings])
  const sortedMeetings = useMemo(() => sortMeetings(filteredMeetings, sortBy), [filteredMeetings, sortBy])
  const quickFilteredMeetings = useMemo(() => {
    if (quickFilter === 'notes') {
      return sortedMeetings.filter((meeting) => meeting.notes?.trim())
    }
    if (quickFilter === 'linked') {
      return sortedMeetings.filter((meeting) => (meeting.noteMentions?.length ?? 0) > 0)
    }
    if (quickFilter === 'history') {
      return sortedMeetings.filter((meeting) => (meeting.history?.length ?? 0) > 0)
    }
    if (quickFilter === 'review') {
      return sortedMeetings.filter((meeting) => !meeting.attendees?.trim() || !meeting.notes?.trim())
    }
    return sortedMeetings
  }, [quickFilter, sortedMeetings])
  const displayedMeetings = useMemo(() => {
    if (navigatorFilter.type === 'group') {
      return quickFilteredMeetings.filter((meeting) => getMeetingFrequencyType(meeting) === navigatorFilter.key)
    }
    if (navigatorFilter.type === 'subgroup') {
      return quickFilteredMeetings.filter((meeting) => getSubGroupKey(meeting) === navigatorFilter.key)
    }
    return quickFilteredMeetings
  }, [navigatorFilter, quickFilteredMeetings])
  const groupedMeetings = useMemo(() => groupMeetingsByFrequency(displayedMeetings), [displayedMeetings])
  const navigatorGroupedMeetings = useMemo(() => groupMeetingsByFrequency(quickFilteredMeetings), [quickFilteredMeetings])
  const groupedSummary = useMemo(
    () => getGroupSummary(filterMeetings(meetings, summaryFilters)),
    [meetings, summaryFilters],
  )
  const isFiltered = hasActiveFilters(filters)
  const activeFilterTags = getActiveFilterTags(filters)
  const canDrag = sortBy === 'custom' && !isFiltered
  const editingMeeting = useMemo(
    () => meetings.find((meeting) => meeting.id === inlineEditingId) ?? null,
    [inlineEditingId, meetings],
  )
  const selectedMeeting = useMemo(
    () => displayedMeetings.find((meeting) => meeting.id === selectedMeetingId) ?? displayedMeetings[0] ?? null,
    [displayedMeetings, selectedMeetingId],
  )
  const quickFilterCounts = useMemo(() => ({
    all: sortedMeetings.length,
    notes: sortedMeetings.filter((meeting) => meeting.notes?.trim()).length,
    linked: sortedMeetings.filter((meeting) => (meeting.noteMentions?.length ?? 0) > 0).length,
    history: sortedMeetings.filter((meeting) => (meeting.history?.length ?? 0) > 0).length,
    review: sortedMeetings.filter((meeting) => !meeting.attendees?.trim() || !meeting.notes?.trim()).length,
  }), [sortedMeetings])

  useEffect(() => {
    function handlePointerDown(event) {
      if (!moreMenuRef.current?.contains(event.target)) {
        setMoreMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  const hasCollapsedSections = useMemo(() => {
    const hasCollapsedGroup = Object.entries(groupedMeetings).some(
      ([groupKey, subGroups]) =>
        Object.values(subGroups).some((items) => items.length > 0) && collapsedGroups.includes(groupKey),
    )

    const hasCollapsedSubGroup = Object.entries(groupedMeetings).some(([groupKey, subGroups]) =>
      Object.entries(subGroups).some(
        ([subGroupKey, items]) => items.length > 0 && collapsedSubGroups[`${groupKey}:${subGroupKey}`] !== false,
      ),
    )

    return hasCollapsedGroup || hasCollapsedSubGroup
  }, [collapsedGroups, collapsedSubGroups, groupedMeetings])

  function moveMeeting(targetId) {
    if (!draggedMeetingId || draggedMeetingId === targetId) return

    const customSorted = sortMeetings(meetings, 'custom')
    const sourceIndex = customSorted.findIndex((meeting) => meeting.id === draggedMeetingId)
    const targetIndex = customSorted.findIndex((meeting) => meeting.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return

    const reordered = [...customSorted]
    const [dragged] = reordered.splice(sourceIndex, 1)
    reordered.splice(targetIndex, 0, dragged)
    onReorderMeetings(reordered.map((meeting) => meeting.id))
  }

  function expandAllGroups() {
    setCollapsedGroups([])
    setCollapsedSubGroups(
      Object.fromEntries(
        Object.entries(groupedMeetings).flatMap(([groupKey, subGroups]) =>
          Object.entries(subGroups)
            .filter(([, items]) => items.length > 0)
            .map(([subGroupKey]) => [`${groupKey}:${subGroupKey}`, false]),
        ),
      ),
    )
  }

  function collapseAllGroups() {
    setCollapsedGroups(
      Object.entries(groupedMeetings)
        .filter(([, subGroups]) => Object.values(subGroups).some((items) => items.length > 0))
        .map(([groupKey]) => groupKey),
    )
    setCollapsedSubGroups(
      Object.fromEntries(
        Object.entries(groupedMeetings).flatMap(([groupKey, subGroups]) =>
          Object.entries(subGroups)
            .filter(([, items]) => items.length > 0)
            .map(([subGroupKey]) => [`${groupKey}:${subGroupKey}`, true]),
        ),
      ),
    )
  }

  function isFrequencySummaryActive(key) {
    return filters.frequencyTypes?.includes(key) || filters.frequency === key
  }

  function toggleFrequencySummary(key) {
    const isActive = isFrequencySummaryActive(key)
    const nextFrequencyTypes = isActive
      ? (filters.frequencyTypes ?? []).filter((item) => item !== key)
      : [...new Set([...(filters.frequencyTypes ?? []), key])]

    setFilters({
      ...filters,
      frequency: 'all',
      frequencyTypes: nextFrequencyTypes,
    })
  }

  function selectNavigatorFilter(nextFilter) {
    setNavigatorFilter(nextFilter)
    setSelectedMeetingId('')
  }

  function renderFrequencyNavigator() {
    const totalVisible = quickFilteredMeetings.length || 1

    return (
      <aside className="meetings-density-nav">
        <button
          type="button"
          className={navigatorFilter.type === 'all' ? 'meetings-density-nav-item meetings-density-nav-item-active' : 'meetings-density-nav-item'}
          onClick={() => selectNavigatorFilter({ type: 'all', key: 'all' })}
        >
          <span>全部会议</span>
          <strong>{quickFilteredMeetings.length}</strong>
          <em style={{ width: '100%' }} />
        </button>
        {Object.entries(navigatorGroupedMeetings).map(([groupKey, subGroups]) => {
          const groupCount = Object.values(subGroups).reduce((count, items) => count + items.length, 0)
          if (groupCount === 0) return null
          const groupTone = getGroupTone(groupKey)

          return (
            <div key={groupKey} className="meetings-density-nav-group">
              <button
                type="button"
                className={
                  navigatorFilter.type === 'group' && navigatorFilter.key === groupKey
                    ? `meetings-density-nav-item meetings-density-nav-item-${groupTone} meetings-density-nav-item-active`
                    : `meetings-density-nav-item meetings-density-nav-item-${groupTone}`
                }
                onClick={() => selectNavigatorFilter({ type: 'group', key: groupKey })}
              >
                <span>{FREQUENCY_LABELS[groupKey]}</span>
                <strong>{groupCount}</strong>
                <em style={{ width: `${Math.max(8, (groupCount / totalVisible) * 100)}%` }} />
              </button>
              <div className="meetings-density-subnav">
                {Object.entries(subGroups)
                  .filter(([, items]) => items.length > 0)
                  .map(([subGroupKey, items]) => {
                    const subTone = getSubGroupTone(subGroupKey)
                    return (
                      <button
                        key={subGroupKey}
                        type="button"
                        className={
                          navigatorFilter.type === 'subgroup' && navigatorFilter.key === subGroupKey
                            ? `meetings-density-subnav-item meetings-density-subnav-item-${subTone} meetings-density-subnav-item-active`
                            : `meetings-density-subnav-item meetings-density-subnav-item-${subTone}`
                        }
                        onClick={() => selectNavigatorFilter({ type: 'subgroup', key: subGroupKey })}
                      >
                        <span>{getSubGroupLabel(subGroupKey)}</span>
                        <strong>{items.length}</strong>
                      </button>
                    )
                  })}
              </div>
            </div>
          )
        })}
      </aside>
    )
  }

  function renderMeetingRow(meeting) {
    const frequencyType = getMeetingFrequencyType(meeting)
    const historyCount = meeting.history?.length ?? 0
    const linkedCount = meeting.noteMentions?.length ?? 0
    const attendeeSummary = getAttendeeSummary(meeting.attendees, 3)
    const isSelected = selectedMeeting?.id === meeting.id
    const isEditing = inlineEditingId === meeting.id

    return (
      <div
        key={meeting.id}
        draggable={canDrag}
        onDragStart={() => setDraggedMeetingId(meeting.id)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => moveMeeting(meeting.id)}
        onDragEnd={() => setDraggedMeetingId(null)}
        className={[
          'meetings-density-row',
          `meetings-density-row-${frequencyType}`,
          isSelected ? 'meetings-density-row-selected' : '',
          isEditing ? 'meetings-density-row-editing' : '',
          draggedMeetingId === meeting.id ? 'meeting-dragging' : '',
        ].filter(Boolean).join(' ')}
        onClick={() => {
          setSelectedMeetingId(meeting.id)
          setInlineEditingId((current) => (current ? meeting.id : current))
        }}
      >
        <div className="meetings-density-cell meetings-density-cell-name">
          {canDrag ? <GripVertical size={14} className="meetings-density-drag" /> : null}
          <div>
            <strong>{meeting.name}</strong>
            <span>{meeting.notes?.trim() || '暂无备注'}</span>
          </div>
        </div>
        <div className="meetings-density-cell">
          <span className={`meeting-frequency-badge meeting-frequency-badge-${frequencyType}`}>
            {getCompactFrequencyLabel(meeting)}
          </span>
        </div>
        <div className="meetings-density-cell meetings-density-cell-date">
          <CalendarDays size={14} />
          <span>{getMeetingDateLabel(meeting)}</span>
        </div>
        <div className="meetings-density-cell meetings-density-cell-duration">
          <Clock size={14} />
          <span>{meeting.duration}m</span>
        </div>
        <div className="meetings-density-cell meetings-density-cell-attendees">
          <Users size={14} />
          <span>{attendeeSummary}</span>
        </div>
        <div className="meetings-density-cell meetings-density-cell-signals">
          {linkedCount > 0 ? <span><Link2 size={13} />{linkedCount}</span> : <span className="muted">无依赖</span>}
          <span>{historyCount} 次</span>
        </div>
        <div className="meetings-density-actions">
          <button
            type="button"
            className={isEditing ? 'icon-button icon-button-active' : 'icon-button'}
            onClick={(event) => {
              event.stopPropagation()
              setInlineEditingId((current) => (current === meeting.id ? null : meeting.id))
              setSelectedMeetingId(meeting.id)
            }}
            aria-label={`编辑 ${meeting.name}`}
          >
            <FileText size={15} />
          </button>
          <button
            type="button"
            className="icon-button danger"
            onClick={(event) => {
              event.stopPropagation()
              onDeleteMeeting(meeting.id)
            }}
            aria-label={`删除 ${meeting.name}`}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    )
  }

  function renderMeetingInspector() {
    if (editingMeeting) {
      return (
        <aside className="panel meetings-density-inspector meetings-density-inspector-edit">
          <div className="meetings-editor-sidebar-head">
            <div className="meetings-editor-sidebar-copy">
              <strong>{editingMeeting.name}</strong>
              <span>编辑会议资料</span>
            </div>
            <button className="icon-button" onClick={() => setInlineEditingId(null)} type="button" aria-label="关闭编辑栏">
              <X size={16} />
            </button>
          </div>
          <InlineEditPanel
            key={editingMeeting.id}
            meeting={editingMeeting}
            meetings={meetings}
            contacts={contacts}
            embedded
            onCancel={() => setInlineEditingId(null)}
            onAddContact={onAddContact}
            onSave={(nextMeeting) => {
              onSaveMeeting(nextMeeting)
              setInlineEditingId(null)
              setSelectedMeetingId(nextMeeting.id)
            }}
          />
        </aside>
      )
    }

    if (!selectedMeeting) {
      return (
        <aside className="panel meetings-density-inspector">
          <div className="info-note">选择一条会议查看详情。</div>
        </aside>
      )
    }

    const frequencyType = getMeetingFrequencyType(selectedMeeting)
    const attendees = getAttendeeList(selectedMeeting)
    const extraInvitees = splitAttendees(selectedMeeting.extraInvitees)
    const attendeeStats = getResolvedAttendeeStats(selectedMeeting.attendeeRefs)
    const extraInviteeStats = getResolvedAttendeeStats(selectedMeeting.extraInviteeRefs)
    const history = [...(selectedMeeting.history ?? [])].slice(-5).reverse()
    const linkedMeetings = (selectedMeeting.noteMentions ?? []).filter(Boolean)

    return (
      <aside className="panel meetings-density-inspector">
        <div className="meetings-inspector-head">
          <div>
            <span className={`meeting-frequency-badge meeting-frequency-badge-${frequencyType}`}>
              {getCompactFrequencyLabel(selectedMeeting)}
            </span>
            <h2>{selectedMeeting.name}</h2>
            <p>{getMeetingDateLabel(selectedMeeting)} · {selectedMeeting.duration} 分钟</p>
          </div>
          <button className="icon-button" type="button" aria-label="固定详情">
            <Pin size={15} />
          </button>
        </div>

        <div className="meetings-inspector-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => setInlineEditingId(selectedMeeting.id)}
          >
            <FileText size={15} />
            编辑
          </button>
          <button
            type="button"
            className="ghost-button danger"
            onClick={() => onDeleteMeeting(selectedMeeting.id)}
          >
            <Trash2 size={15} />
            删除
          </button>
        </div>

        <div className="meetings-inspector-metrics">
          <div><span>历史</span><strong>{selectedMeeting.history?.length ?? 0}</strong></div>
          <div><span>参会人</span><strong>{attendees.length || '-'}</strong></div>
          <div><span>依赖</span><strong>{linkedMeetings.length}</strong></div>
        </div>

        <section className="meetings-inspector-section">
          <div className="meetings-inspector-section-head">
            <Users size={15} />
            <strong>参会人</strong>
            {attendeeStats.total > 0 ? <span>{attendeeStats.linked}/{attendeeStats.total} 已关联</span> : null}
          </div>
          <p>{attendees.length > 0 ? attendees.join('、') : '未指定'}</p>
        </section>

        <section className="meetings-inspector-section">
          <div className="meetings-inspector-section-head">
            <Mail size={15} />
            <strong>不参会但需发会邀</strong>
            {extraInviteeStats.total > 0 ? <span>{extraInviteeStats.linked}/{extraInviteeStats.total} 已关联</span> : null}
          </div>
          <p>{extraInvitees.length > 0 ? extraInvitees.join('、') : '未指定'}</p>
        </section>

        <section className="meetings-inspector-section">
          <div className="meetings-inspector-section-head">
            <FileText size={15} />
            <strong>备注与排程约束</strong>
          </div>
          <p>{selectedMeeting.notes?.trim() || '暂无备注'}</p>
        </section>

        <section className="meetings-inspector-section">
          <div className="meetings-inspector-section-head">
            <Link2 size={15} />
            <strong>关联会议</strong>
          </div>
          {linkedMeetings.length > 0 ? (
            <div className="meetings-inspector-tags">
              {linkedMeetings.map((mention) => (
                <span key={`${mention.meetingId}-${mention.label}`}>@{mention.label}</span>
              ))}
            </div>
          ) : (
            <p>暂无关联会议。</p>
          )}
        </section>

        <section className="meetings-inspector-section">
          <div className="meetings-inspector-section-head">
            <Clock size={15} />
            <strong>最近记录</strong>
          </div>
          {history.length > 0 ? (
            <div className="meetings-inspector-history">
              {history.map((item) => <span key={item}>{item}</span>)}
            </div>
          ) : (
            <p>暂无历史记录。</p>
          )}
        </section>
      </aside>
    )
  }

  return (
    <>
      <section className="panel">
        {contentTab === 'active' ? (
          <div className="meetings-toolbar-stack">
            <div className="meetings-toolbar-row meetings-toolbar-row-primary">
              <div className="search-box search-box-prominent meetings-toolbar-search">
                <Search size={16} />
                <input
                  value={filters.search}
                  onChange={(event) => setFilters({ ...filters, search: event.target.value })}
                  placeholder="搜索会议名称或参会人"
                />
              </div>

              <div className="toolbar-menu meetings-more-menu" ref={moreMenuRef}>
                <button
                  className={moreMenuOpen ? 'ghost-button toolbar-menu-trigger toolbar-menu-trigger-open' : 'ghost-button toolbar-menu-trigger'}
                  onClick={() => setMoreMenuOpen((current) => !current)}
                  type="button"
                >
                  更多
                  <MoreHorizontal size={16} />
                </button>
                {moreMenuOpen ? (
                  <div className="toolbar-menu-popover meetings-more-popover">
                    <button
                      className={showFilters ? 'toolbar-menu-item toolbar-menu-item-active' : 'toolbar-menu-item'}
                      onClick={() => {
                        setMoreMenuOpen(false)
                        setShowFilters((value) => !value)
                      }}
                      type="button"
                    >
                      <Filter size={16} />
                      {showFilters ? '收起筛选' : '显示筛选'}
                    </button>
                    <button
                      className="toolbar-menu-item"
                      onClick={() => {
                        setMoreMenuOpen(false)
                        onBatchImport()
                      }}
                      type="button"
                    >
                      <Download size={16} />
                      批量导入历史
                    </button>
                    <button
                      className="toolbar-menu-item"
                      onClick={() => {
                        setMoreMenuOpen(false)
                        if (hasCollapsedSections) {
                          expandAllGroups()
                        } else {
                          collapseAllGroups()
                        }
                      }}
                      type="button"
                    >
                      <ChevronsUpDown size={16} />
                      {hasCollapsedSections ? '全部展开' : '全部折叠'}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="meetings-toolbar-row meetings-toolbar-row-secondary">
              <div className="meetings-toolbar-controls meetings-toolbar-controls-inline">
                <label className="sort-select">
                  <span>排序</span>
                  <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                    <option value="frequency">按频率分组</option>
                    <option value="nextDate">按下次会议</option>
                    <option value="lastDate">按最近历史</option>
                    <option value="name">按名称</option>
                    <option value="custom">自定义排序</option>
                  </select>
                </label>
                <button className="primary-button" onClick={onCreateMeeting}>
                  <Plus size={16} />
                  新建会议
                </button>
              </div>

              <div className="meetings-toolbar-meta">
                <div className="meetings-summary-inline meetings-density-summary" aria-label="会议数量概览">
                  {Object.entries(FREQUENCY_LABELS).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={
                        isFrequencySummaryActive(key)
                          ? `meetings-summary-item meetings-summary-item-${key} meetings-summary-item-active`
                          : `meetings-summary-item meetings-summary-item-${key}`
                      }
                      onClick={() => toggleFrequencySummary(key)}
                      aria-pressed={isFrequencySummaryActive(key)}
                    >
                      {label} {groupedSummary[key] ?? 0}
                    </button>
                  ))}
                  {[
                    ['notes', '有备注'],
                    ['linked', '有依赖'],
                    ['history', '有记录'],
                    ['review', '待复核'],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={quickFilter === key ? 'meetings-summary-item meetings-summary-item-active' : 'meetings-summary-item'}
                      onClick={() => {
                        setQuickFilter((current) => (current === key ? 'all' : key))
                        selectNavigatorFilter({ type: 'all', key: 'all' })
                      }}
                      aria-pressed={quickFilter === key}
                    >
                      {label} {quickFilterCounts[key]}
                    </button>
                  ))}
                </div>
                <div className="meetings-meta-actions">
                  <span className="meetings-secondary-label">
                    {filteredMeetings.length} / {meetings.length} 条会议
                  </span>
                  <button className="ghost-button meetings-jump-button" onClick={onGoToPlanner}>
                    去排程
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {contentTab === 'trash' ? (
          <TrashView
            deletedMeetings={deletedMeetings}
            onRestore={onRestoreMeeting}
            onDeleteForever={onDeleteMeetingForever}
          />
        ) : (
          <>
            <div className="meetings-workbench">
              {showFilters ? (
                <div className="meetings-secondary-tools">
                  <span className="meetings-secondary-label">筛选条件</span>
                  {!canDrag && sortBy === 'custom' ? (
                    <span className="meetings-secondary-hint">筛选状态下禁用拖拽排序</span>
                  ) : null}
                </div>
              ) : null}

              <FilterPanel
                open={showFilters}
                filters={filters}
                onChange={(nextFilters) => {
                  setFilters(nextFilters)
                  setShowFilters(false)
                }}
                onReset={() => setFilters(defaultFilters)}
              />

              {activeFilterTags.length > 0 ? (
                <div className="active-filter-row">
                  {activeFilterTags.map((tag) => (
                    <span key={tag.key} className="filter-chip">
                      {tag.label}
                    </span>
                  ))}
                  <button className="ghost-button" onClick={() => setFilters(defaultFilters)}>
                    <X size={14} />
                    清除筛选
                  </button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </section>

      {contentTab === 'active' && sortedMeetings.length === 0 ? (
        <div className="panel empty-state">
          <p>{meetings.length === 0 ? '还没有会议，建议先新建一条会议资料。' : '没有符合条件的会议。'}</p>
          <div className="panel-actions">
            <button className="primary-button" onClick={onCreateMeeting}>
              <Plus size={16} />
              新建会议
            </button>
            {meetings.length === 0 ? (
              <button className="ghost-button" onClick={onBatchImport}>
                <Download size={16} />
                导入历史记录
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {contentTab === 'active' ? (
        <div className="meetings-density-workspace">
          {renderFrequencyNavigator()}
          <section className="panel meetings-density-list-panel">
            <div className="meetings-density-list-head">
              <div>
                <strong>会议列表</strong>
                <span>{displayedMeetings.length} / {meetings.length} 条</span>
              </div>
              {!canDrag && sortBy === 'custom' ? (
                <em>筛选状态下禁用拖拽排序</em>
              ) : null}
            </div>
            <div className="meetings-density-table-head">
              <span>会议</span>
              <span>类型</span>
              <span>下次</span>
              <span>时长</span>
              <span>参会人</span>
              <span>信号</span>
              <span />
            </div>
            <div className="meetings-density-list">
              {displayedMeetings.map((meeting) => renderMeetingRow(meeting))}
              {displayedMeetings.length === 0 ? (
                <div className="meetings-density-empty">当前筛选下没有会议。</div>
              ) : null}
            </div>
          </section>
          {renderMeetingInspector()}
        </div>
      ) : null}
    </>
  )
}
