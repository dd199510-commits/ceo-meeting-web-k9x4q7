import { useMemo, useState } from 'react'
import { CalendarPlus, CheckSquare, Download, Search, Square, TriangleAlert } from 'lucide-react'
import { FREQUENCY_LABELS } from '../../data/meetingData'
import { buildOutlookInviteRows, downloadOutlookVbaScript, downloadOutlookVbsScript } from './outlookInviteUtils'

function formatDateTime(row) {
  return `${row.date} ${row.startTime} - ${row.endTime}`
}

function summarizePeople(people, fallback = '无') {
  if (!Array.isArray(people) || people.length === 0) return fallback
  return people.map((person) => person.label).join('、')
}

function formatScheduleDate(dateString) {
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return dateString || '未定日期'
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`
}

export function OutlookInviteBoard({
  meetings = [],
  schemeOptions = [],
  taskOptions = [],
  selectedTaskId = '',
  onTaskChange,
  onExportDrafts,
}) {
  const [selectedIds, setSelectedIds] = useState([])
  const [searchText, setSearchText] = useState('')
  const [senderEmail, setSenderEmail] = useState('')
  const [selectedSchemeId, setSelectedSchemeId] = useState('')
  const [selectedScheduleId, setSelectedScheduleId] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const selectedTask = taskOptions.find((task) => task.id === selectedTaskId) ?? taskOptions[0] ?? null
  const activeSchemeId = schemeOptions.some((scheme) => scheme.id === selectedSchemeId)
    ? selectedSchemeId
    : schemeOptions[0]?.id ?? ''
  const selectedScheme = schemeOptions.find((scheme) => scheme.id === activeSchemeId) ?? null
  const scheduledMeetings = useMemo(
    () => selectedScheme?.scheduledMeetings ?? [],
    [selectedScheme],
  )

  const scheduleOptions = useMemo(() => {
    const byDate = new Map()
    scheduledMeetings.forEach((meeting) => {
      const date = meeting.date || 'undated'
      const current = byDate.get(date) ?? []
      current.push(meeting)
      byDate.set(date, current)
    })

    return [
      { id: 'all', label: '全部日程', count: scheduledMeetings.length },
      ...Array.from(byDate.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, items]) => ({
          id: `date:${date}`,
          label: `${formatScheduleDate(date)}（${items.length}）`,
          count: items.length,
        })),
    ]
  }, [scheduledMeetings])
  const selectedScheduleMeetings = useMemo(() => {
    const activeScheduleId = scheduleOptions.some((option) => option.id === selectedScheduleId)
      ? selectedScheduleId
      : 'all'
    if (activeScheduleId === 'all') return scheduledMeetings
    if (activeScheduleId.startsWith('date:')) {
      const date = activeScheduleId.slice(5)
      return scheduledMeetings.filter((meeting) => meeting.date === date)
    }
    return scheduledMeetings
  }, [scheduleOptions, scheduledMeetings, selectedScheduleId])
  const rows = useMemo(
    () => buildOutlookInviteRows({ meetings, scheduledMeetings: selectedScheduleMeetings }),
    [meetings, selectedScheduleMeetings],
  )
  const selectableRows = useMemo(
    () => rows.filter((row) => row.requiredEmails.length > 0 && row.missingRequired.length === 0),
    [rows],
  )
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const filteredRows = useMemo(() => {
    const search = searchText.trim().toLowerCase()
    return rows.filter((row) => {
      if (!search) return true
      const haystack = [
        row.subject,
        row.date,
        row.startTime,
        row.endTime,
        row.requiredEmails.join(' '),
        row.optionalEmails.join(' '),
        row.requiredPeople.map((person) => person.label).join(' '),
        row.optionalPeople.map((person) => person.label).join(' '),
        row.missingRequired.join(' '),
        row.body,
      ].join(' ').toLowerCase()
      if (!haystack.includes(search)) return false
      return true
    }).filter((row) => {
      const canGenerate = row.requiredEmails.length > 0 && row.missingRequired.length === 0
      if (filterType === 'ready') return canGenerate
      if (filterType === 'missing') return !canGenerate || row.missingOptional.length > 0
      if (filterType === 'selected') return selectedSet.has(row.id)
      return true
    })
  }, [filterType, rows, searchText, selectedSet])
  const filteredSelectableRows = useMemo(
    () => filteredRows.filter((row) => row.requiredEmails.length > 0 && row.missingRequired.length === 0),
    [filteredRows],
  )
  const selectedRows = rows.filter((row) => selectedSet.has(row.id))
  const hiddenSelectedCount = selectedRows.filter(
    (row) => !filteredRows.some((filteredRow) => filteredRow.id === row.id),
  ).length
  const completeCount = selectableRows.length
  const missingCount = rows.filter((row) => row.missingRequired.length > 0 || row.missingOptional.length > 0).length

  function handleTaskChange(taskId) {
    setSelectedIds([])
    setSelectedSchemeId('')
    setSelectedScheduleId('all')
    onTaskChange?.(taskId)
  }

  function handleSchemeChange(schemeId) {
    setSelectedIds([])
    setSelectedSchemeId(schemeId)
    setSelectedScheduleId('all')
  }

  function handleScheduleChange(scheduleId) {
    setSelectedIds([])
    setSelectedScheduleId(scheduleId)
  }

  function toggleRow(rowId) {
    setSelectedIds((current) =>
      current.includes(rowId) ? current.filter((id) => id !== rowId) : [...current, rowId],
    )
  }

  function selectAllVisibleRows() {
    setSelectedIds(filteredSelectableRows.map((row) => row.id))
  }

  function unselectVisibleRows() {
    const visibleIds = new Set(filteredRows.map((row) => row.id))
    setSelectedIds((current) => current.filter((id) => !visibleIds.has(id)))
  }

  function exportSelectedRows() {
    exportRows('vba')
  }

  function exportOneClickScript() {
    exportRows('vbs')
  }

  function exportRows(format) {
    if (selectedRows.length === 0) {
      window.alert('请先选择至少一个可生成会邀的会议方案。')
      return
    }

    const blocked = selectedRows.filter((row) => row.requiredEmails.length === 0 || row.missingRequired.length > 0)
    if (blocked.length > 0) {
      window.alert('有会议缺少必填参会人邮箱，请补齐后再生成 VBA。')
      return
    }

    const payload = {
      rows: selectedRows,
      taskName: selectedTask?.name ?? '排程任务',
      senderEmail,
    }

    if (format === 'vbs') {
      downloadOutlookVbsScript(payload)
    } else {
      downloadOutlookVbaScript(payload)
    }
    onExportDrafts?.(selectedRows.length, format)
  }

  return (
    <section className="panel outlook-invite-shell">
      <div className="outlook-invite-topbar">
        <div className="reserve-task-selector outlook-invite-task-selector">
          <div>
            <span>排程任务</span>
            <strong>{selectedTask?.name ?? '请选择已排程任务'}</strong>
          </div>
          <select
            value={selectedTask?.id ?? ''}
            onChange={(event) => handleTaskChange(event.target.value)}
            disabled={taskOptions.length === 0}
          >
            {(taskOptions.length > 0 ? taskOptions : [{ id: 'empty', name: '暂无已排程任务' }]).map((task) => (
              <option key={task.id} value={task.id}>
                {task.name}
              </option>
            ))}
          </select>
        </div>

        <div className="outlook-invite-summary-cards">
          <div className="reserve-notice-summary-card">
            <span>会议方案</span>
            <strong>{rows.length}</strong>
          </div>
          <div className="reserve-notice-summary-card">
            <span>可生成</span>
            <strong>{completeCount}</strong>
          </div>
          <div className="reserve-notice-summary-card">
            <span>缺邮箱</span>
            <strong>{missingCount}</strong>
          </div>
          <div className="reserve-notice-summary-card">
            <span>已选择</span>
            <strong>{selectedRows.length}</strong>
          </div>
        </div>

        <div className="outlook-invite-action-buttons">
          <button className="ghost-button" type="button" onClick={selectAllVisibleRows}>
            <CheckSquare size={16} />
            全选当前
          </button>
          <button className="ghost-button" type="button" onClick={unselectVisibleRows}>
            <Square size={16} />
            全不选
          </button>
          <button className="primary-button" type="button" onClick={exportOneClickScript}>
            <Download size={16} />
            生成一键 VBS
          </button>
          <button className="ghost-button" type="button" onClick={exportSelectedRows}>
            <Download size={16} />
            VBA 模块
          </button>
        </div>
      </div>

      <div className="outlook-invite-actions">
        <label className="field outlook-invite-scheme-field">
          <span>排程方案</span>
          <select
            value={activeSchemeId}
            onChange={(event) => handleSchemeChange(event.target.value)}
            disabled={schemeOptions.length === 0}
          >
            {(schemeOptions.length > 0 ? schemeOptions : [{ id: 'empty', label: '暂无排程方案' }]).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field outlook-invite-schedule-field">
          <span>日程安排</span>
          <select
            value={scheduleOptions.some((option) => option.id === selectedScheduleId) ? selectedScheduleId : 'all'}
            onChange={(event) => handleScheduleChange(event.target.value)}
            disabled={schemeOptions.length === 0}
          >
            {scheduleOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="final-check-search">
          <Search size={15} />
          <input
            type="text"
            placeholder="搜索会议、日期或邮箱"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </label>
        <label className="field outlook-invite-sender-field">
          <span>指定发件邮箱</span>
          <input
            type="email"
            placeholder="留空则使用 Outlook 默认账号"
            value={senderEmail}
            onChange={(event) => setSenderEmail(event.target.value)}
          />
        </label>
        <div className="outlook-invite-filter-group" role="group" aria-label="会邀筛选">
          {[
            ['all', '全部'],
            ['ready', '可生成'],
            ['missing', '缺邮箱'],
            ['selected', '已选择'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filterType === value ? 'outlook-invite-filter outlook-invite-filter-active' : 'outlook-invite-filter'}
              onClick={() => setFilterType(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {hiddenSelectedCount > 0 ? (
          <div className="outlook-invite-hidden-selection">
            当前筛选外还有 {hiddenSelectedCount} 个已选择项
          </div>
        ) : null}
      </div>

      <div className="outlook-invite-layout">
        <div className="outlook-invite-list">
          {filteredRows.map((row) => {
            const isSelected = selectedSet.has(row.id)
            const canGenerate = row.requiredEmails.length > 0 && row.missingRequired.length === 0

            return (
              <article
                key={row.id}
                className={[
                  'outlook-invite-item',
                  isSelected ? 'outlook-invite-item-active' : '',
                  canGenerate ? '' : 'outlook-invite-item-warning',
                ].filter(Boolean).join(' ')}
              >
                <label className="outlook-invite-check">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={!canGenerate}
                    onChange={() => toggleRow(row.id)}
                  />
                  <span>{isSelected ? '已选择' : '选择'}</span>
                </label>

                <div className="outlook-invite-item-main">
                  <div className="outlook-invite-item-head">
                    <div>
                      <strong>{row.subject}</strong>
                      <p>
                        {formatDateTime(row)}
                        <span>{row.duration} 分钟</span>
                        <span>{canGenerate ? '邮箱完整' : '缺少邮箱'}</span>
                      </p>
                    </div>
                    <span className={`final-check-frequency-mark final-check-frequency-mark-${row.scheduledMeeting.frequency === 'weekly' ? 'blue' : row.scheduledMeeting.frequency === 'monthly' ? 'green' : row.scheduledMeeting.frequency === 'yearly' ? 'orange' : 'gray'}`}>
                      {FREQUENCY_LABELS[row.scheduledMeeting.frequency] ?? '不定期'}
                    </span>
                  </div>

                  <div className="outlook-invite-detail-grid">
                    <div>
                      <span>参会人</span>
                      <p>{summarizePeople(row.requiredPeople, '未解析到邮箱')}</p>
                    </div>
                    <div>
                      <span>不参会需发会邀</span>
                      <p>{summarizePeople(row.optionalPeople)}</p>
                    </div>
                    <div className="outlook-invite-body-preview">
                      <span>会邀正文</span>
                      <p>{row.body || '无'}</p>
                    </div>
                    {(row.missingRequired.length > 0 || row.missingOptional.length > 0) ? (
                      <div className="outlook-invite-warning">
                        <TriangleAlert size={15} />
                        <p>
                          未解析邮箱：
                          {[...row.missingRequired, ...row.missingOptional].join('、')}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            )
          })}

          {filteredRows.length === 0 ? (
            <div className="empty-state">暂无匹配的会议方案</div>
          ) : null}
        </div>

        <aside className="outlook-invite-preview">
          <div className="outlook-invite-preview-head">
            <CalendarPlus size={18} />
            <div>
              <strong>脚本输出说明</strong>
              <span>生成 `.vbs` 后在 Windows 上双击运行；`.bas` 仍可用于 Outlook VBA 调试。</span>
            </div>
          </div>

          <div className="outlook-invite-preview-card">
            <span className="final-check-item-label">脚本行为</span>
            <p>批量创建会议项，设置为会议状态并保存；不会 Display，也不会 Send。填写发件邮箱后会指定 SendUsingAccount。</p>
          </div>

          <div className="outlook-invite-preview-card">
            <span className="final-check-item-label">Outlook 中的位置</span>
            <p>生成后请到 Outlook 日历中检查草稿会议，确认无误后再手动发送。</p>
          </div>

          <div className="outlook-invite-preview-card">
            <span className="final-check-item-label">当前选择</span>
            <p>
              已选择 {selectedRows.length} 个会议方案，
              共 {selectedRows.reduce((total, row) => total + row.requiredEmails.length + row.optionalEmails.length, 0)} 个收件邮箱。
              {senderEmail.trim() ? `发件邮箱：${senderEmail.trim()}。` : '发件邮箱：Outlook 默认账号。'}
            </p>
          </div>

          <div className="outlook-invite-preview-card outlook-invite-preview-card-warning">
            <span className="final-check-item-label">运行前检查</span>
            <p>如重复运行同一脚本，Outlook 会再次创建一批新草稿。确认生成前建议先筛选并只选择需要创建的方案。</p>
          </div>
        </aside>
      </div>
    </section>
  )
}
