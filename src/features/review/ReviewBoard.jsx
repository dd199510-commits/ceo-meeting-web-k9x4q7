import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Filter, List, Lock, Pin, Plus, Search, Trash2, X } from 'lucide-react'
import { FREQUENCY_COLORS, FREQUENCY_LABELS } from '../../data/meetingData'
import {
  buildTimeSlots,
  calculateCardStyle,
  getCalendarHourRange,
  getMonthView,
  getWeekDays,
  minutesToTime,
  timeToMinutes,
} from './reviewCalendarUtils'
import { addDays, addMonths, formatDate } from '../../lib/date'
import { generateOccurrencesInRange } from '../../lib/meetingFrequency'

function formatSourceFrequency(sourceFrequency) {
  if (!sourceFrequency) return ''

  if (sourceFrequency.type === 'weekly') {
    return `频率：每 ${sourceFrequency.interval} 周 / 周${['日', '一', '二', '三', '四', '五', '六'][sourceFrequency.daySpec]}`
  }

  if (sourceFrequency.type === 'monthly') {
    return `频率：每 ${sourceFrequency.interval} 月 / ${sourceFrequency.daySpec} 号`
  }

  if (sourceFrequency.type === 'yearly') {
    const months = Array.isArray(sourceFrequency.monthSpec)
      ? sourceFrequency.monthSpec.join(',')
      : sourceFrequency.monthSpec
    return `频率：每 ${sourceFrequency.interval} 年 / ${months} 月 / ${sourceFrequency.daySpec} 号`
  }

  return '频率：不定期'
}

function getDefaultManualMeeting() {
  const today = formatDate(new Date())
  return {
    id: '',
    name: '',
    date: today,
    startTime: '09:00',
    endTime: '10:00',
    duration: 60,
    attendees: '',
    notes: '',
    frequency: 'adhoc',
    sourceFrequency: {
      type: 'adhoc',
      interval: 1,
      monthSpec: 1,
      daySpec: 1,
      anchorDate: today,
    },
    aiReason: '手动新增',
    locked: false,
    reserved: false,
    manuallyAdded: true,
  }
}

function getWeekdayName(dateString) {
  const [year, month, day] = String(dateString || '').split('-').map(Number)
  if (!year || !month || !day) return ''
  return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][
    new Date(year, month - 1, day).getDay()
  ]
}

function getDefaultLinkedDraft(defaultDate) {
  return {
    meetingId: '',
    date: defaultDate,
    startTime: '09:00',
  }
}

function summarizeText(value, fallback = '未填写') {
  if (!value) return fallback
  const normalized = String(value).replace(/\s+/g, ' ').trim()
  return normalized || fallback
}

function pairShiftedDates(missingDates, offPatternInstances) {
  const remainingMissing = [...missingDates].sort()
  const shiftedInstances = [...offPatternInstances].sort((left, right) => left.date.localeCompare(right.date))
  const pairs = []

  shiftedInstances.forEach((instance) => {
    if (remainingMissing.length === 0) return

    let bestIndex = 0
    let bestDistance = Number.POSITIVE_INFINITY
    const actualTime = new Date(instance.date).getTime()

    remainingMissing.forEach((date, index) => {
      const distance = Math.abs(new Date(date).getTime() - actualTime)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    })

    const [plannedDate] = remainingMissing.splice(bestIndex, 1)
    pairs.push({
      plannedDate,
      actualDate: instance.date,
      instance,
    })
  })

  return {
    pairs,
    remainingMissing,
  }
}

function formatShortDate(date) {
  return String(date || '').slice(5)
}

function getWeekWindow(dateString) {
  const current = new Date(dateString)
  const weekday = current.getDay()
  const daysToMonday = weekday === 0 ? 6 : weekday - 1
  const start = addDays(current, -daysToMonday)
  const end = addDays(start, 6)

  return {
    start: formatDate(start),
    end: formatDate(end),
  }
}

function describeMissingOccurrence(meeting, dateString) {
  const frequencyType = meeting?.frequency?.type ?? meeting?.frequency ?? 'adhoc'

  if (frequencyType === 'weekly') {
    const window = getWeekWindow(dateString)
    return `原定 ${formatShortDate(dateString)} 所在周（${formatShortDate(window.start)} 至 ${formatShortDate(window.end)}）未排上`
  }

  if (frequencyType === 'monthly' || frequencyType === 'yearly') {
    return `原定 ${formatShortDate(dateString)} 这一轮未排上`
  }

  return `原定 ${formatShortDate(dateString)} 未排上`
}

function buildChecklistNoteLines(row) {
  const lines = []

  if (row.shiftedPairs.length > 0) {
    lines.push(
      ...row.shiftedPairs.map((item, index) => ({
        id: `${row.id}-shifted-${index}`,
        kind: 'shifted',
        text: `原定 ${item.plannedDate.slice(5)}，实际调整到 ${item.actualDate.slice(5)}`,
        plannedDate: item.plannedDate,
        actualDate: item.actualDate,
        instanceId: item.instance?.id ?? '',
      })),
    )
  }

  if (row.missingDates.length > 0) {
    lines.push(
      ...row.missingDates.map((date, index) => ({
        id: `${row.id}-missing-${index}`,
        kind: 'missing',
        text: describeMissingOccurrence(row.meeting, date),
        plannedDate: date,
        actualDate: '',
        instanceId: '',
      })),
    )
  }

  if (lines.length === 0 && row.noteMentionCount > 0) {
    lines.push({
      id: `${row.id}-note-count`,
      kind: 'note',
      text: `备注含 ${row.noteMentionCount} 条关联约束`,
      plannedDate: '',
      actualDate: '',
      instanceId: '',
    })
  }

  return lines
}

function replaceTaskIdsWithMeetingNames(text, taskNameMap) {
  if (!text) return ''

  return text.replace(/\bM-\d{3}\b/g, (taskId) => taskNameMap.get(taskId) ?? taskId)
}

function getCheckStatus(row, checked) {
  if (row.expectedCount === 0 && row.actualCount > 0) {
    return { code: 'warning', label: '本期外排入' }
  }

  if (row.expectedCount > row.actualCount) {
    return { code: 'warning', label: '可能漏排' }
  }

  if (row.expectedCount < row.actualCount) {
    return { code: 'warning', label: '排期次数异常' }
  }

  if (row.noteMentionCount > 0) {
    return { code: 'attention', label: '需核对备注要求' }
  }

  if (checked) {
    return { code: 'ok', label: '已确认' }
  }

  return { code: 'default', label: row.expectedCount === 0 ? '本期无需安排' : '待检查' }
}

function getChecklistMetaPills(row) {
  const frequencyType = row.meeting.frequency?.type ?? row.meeting.frequency ?? 'adhoc'
  const pills = [
    {
      key: 'frequency',
      label: FREQUENCY_LABELS[frequencyType] ?? '不定期',
      className: `review-checklist-pill review-checklist-pill-frequency-${frequencyType}`,
    },
    {
      key: 'expected',
      label: `计划 ${row.expectedCount} 次`,
      className: 'review-checklist-pill review-checklist-pill-plan',
    },
    {
      key: 'normal',
      label: `正常 ${Math.max(row.expectedCount - row.missingDates.length - row.shiftedCount, 0)} 次`,
      className: 'review-checklist-pill review-checklist-pill-normal',
    },
  ]

  if (row.shiftedCount > 0) {
    pills.push({
      key: 'shifted',
      label: `改期 ${row.shiftedCount} 次`,
      className: 'review-checklist-pill review-checklist-pill-shifted',
    })
  }

  if (row.missingDates.length > 0) {
    pills.push({
      key: 'missing',
      label: `未排 ${row.missingDates.length} 次`,
      className: 'review-checklist-pill review-checklist-pill-missing',
    })
  }

  if (row.inAIAttention) {
    pills.push({
      key: 'ai',
      label: 'AI 提醒',
      className: 'review-checklist-pill review-checklist-pill-ai',
    })
  }

  return pills
}

export function ReviewBoard({
  meetings = [],
  scheduledMeetings,
  reviewState = null,
  conflicts,
  onToggleLocked,
  onToggleReserved,
  onDeleteMeeting,
  onMoveMeeting,
  onLockAll,
  onUnlockAll,
  onReserveAll,
  onUnreserveAll,
  onAddMeeting,
  onExportPlan,
  onImportPlan,
  onGoToPlannerStep,
  onToggleChecked,
  onRestoreMissingInstance,
}) {
  const DRAG_THRESHOLD = 6
  const DEFAULT_START_HOUR = 8
  const DEFAULT_END_HOUR = 20
  const WEEK_BLOCK_HEIGHT = 18
  const MONTH_BLOCK_HEIGHT = 14
  const firstDate = scheduledMeetings[0]?.date ?? new Date().toISOString().slice(0, 10)
  const [viewType, setViewType] = useState('calendar')
  const [weekAnchor, setWeekAnchor] = useState(firstDate)
  const [monthAnchor, setMonthAnchor] = useState(firstDate)
  const [selectedDay, setSelectedDay] = useState(null)
  const [selectedMeeting, setSelectedMeeting] = useState(null)
  const [detailEdits, setDetailEdits] = useState({})
  const [showAddModal, setShowAddModal] = useState(false)
  const [addMode, setAddMode] = useState('adhoc')
  const [newMeeting, setNewMeeting] = useState(getDefaultManualMeeting())
  const [linkedDraft, setLinkedDraft] = useState(() => getDefaultLinkedDraft(firstDate))
  const [checkFilterType, setCheckFilterType] = useState('all')
  const [checkSearchText, setCheckSearchText] = useState('')
  const [hoveredCheckMeetingId, setHoveredCheckMeetingId] = useState('')
  const [selectedCheckMeetingId, setSelectedCheckMeetingId] = useState('')
  const [checkLocateCycleMap, setCheckLocateCycleMap] = useState({})
  const [checkFocus, setCheckFocus] = useState(null)
  const [pendingScrollTarget, setPendingScrollTarget] = useState(null)
  const [selectedChecklistDetailId, setSelectedChecklistDetailId] = useState('')
  const [restoreDraft, setRestoreDraft] = useState(null)
  const [draggingMeeting, setDraggingMeeting] = useState(null)
  const [dragTarget, setDragTarget] = useState(null)
  const dragTargetRef = useRef(null)
  const pointerSessionRef = useRef(null)
  const rowRefs = useRef(new Map())

  const conflictIdSet = useMemo(() => new Set(conflicts.flatMap((item) => item.meetingIds)), [conflicts])
  const calendarHourRange = useMemo(
    () => getCalendarHourRange(scheduledMeetings, DEFAULT_START_HOUR, DEFAULT_END_HOUR),
    [scheduledMeetings],
  )
  const startHour = calendarHourRange.startHour
  const endHour = calendarHourRange.endHour
  const weekDays = useMemo(() => getWeekDays(weekAnchor), [weekAnchor])
  const timeSlots = useMemo(() => buildTimeSlots(startHour, endHour), [endHour, startHour])
  const weekBodyHeight = timeSlots.length * WEEK_BLOCK_HEIGHT
  const monthBodyHeight = timeSlots.length * MONTH_BLOCK_HEIGHT
  const monthView = useMemo(() => getMonthView(monthAnchor), [monthAnchor])
  const monthWeeks = useMemo(() => {
    const weeks = []
    for (let index = 0; index < monthView.days.length; index += 7) {
      weeks.push(monthView.days.slice(index, index + 7))
    }
    return weeks
  }, [monthView.days])

  const meetingsByDate = useMemo(() => {
    return scheduledMeetings.reduce((accumulator, meeting) => {
      const current = accumulator.get(meeting.date) ?? []
      current.push(meeting)
      accumulator.set(meeting.date, current.sort((a, b) => a.startTime.localeCompare(b.startTime)))
      return accumulator
    }, new Map())
  }, [scheduledMeetings])
  const sourceMeetingsById = useMemo(
    () => new Map((Array.isArray(meetings) ? meetings : []).map((meeting) => [meeting.id, meeting])),
    [meetings],
  )
  const activeMeetings = useMemo(
    () => (Array.isArray(meetings) ? meetings.filter((meeting) => meeting.status === 'active') : []),
    [meetings],
  )
  const checkStatusMap = useMemo(() => reviewState?.finalCheckStatus ?? {}, [reviewState])
  const taskNameMap = useMemo(
    () =>
      new Map(
        scheduledMeetings
          .filter((meeting) => meeting.taskId && meeting.name)
          .map((meeting) => [meeting.taskId, meeting.name]),
      ),
    [scheduledMeetings],
  )

  const stats = useMemo(() => {
    return {
      total: scheduledMeetings.length,
      reserved: scheduledMeetings.filter((meeting) => meeting.reserved).length,
      locked: scheduledMeetings.filter((meeting) => meeting.locked).length,
      conflicts: conflicts.length,
    }
  }, [scheduledMeetings, conflicts.length])

  const sourceRange = reviewState?.sourceInputMeetings?.timeRange ?? null
  const getReadableAiReason = useCallback(
    (reason) => replaceTaskIdsWithMeetingNames(reason ?? '', taskNameMap),
    [taskNameMap],
  )
  const aiUnscheduledNames = useMemo(() => {
    return new Set(
      Array.isArray(reviewState?.aiSummary?.unscheduledMeetingNames)
        ? reviewState.aiSummary.unscheduledMeetingNames
        : [],
    )
  }, [reviewState])

  const checklistRows = useMemo(() => {
    return activeMeetings
      .map((meeting) => {
        const expectedDates =
          sourceRange?.start && sourceRange?.end
            ? generateOccurrencesInRange(meeting, sourceRange.start, sourceRange.end)
            : []
        const actualInstances = scheduledMeetings.filter((item) => item.meetingId === meeting.id)
        const expectedDateSet = new Set(expectedDates)
        const actualDateSet = new Set(actualInstances.map((instance) => instance.date))
        const missingDates = expectedDates.filter((date) => !actualDateSet.has(date))
        const offPatternInstances = actualInstances.filter((instance) => !expectedDateSet.has(instance.date))
        const shifted = pairShiftedDates(missingDates, offPatternInstances)
        const checked = Boolean(checkStatusMap[meeting.id])
        const status = getCheckStatus(
          {
            expectedCount: expectedDates.length,
            actualCount: actualInstances.length,
            noteMentionCount: Array.isArray(meeting.noteMentions) ? meeting.noteMentions.length : 0,
          },
          checked,
        )

        return {
          id: meeting.id,
          meeting,
          checked,
          status,
          expectedDates,
          expectedCount: expectedDates.length,
          actualCount: actualInstances.length,
          actualInstances,
          missingDates: shifted.remainingMissing,
          shiftedPairs: shifted.pairs,
          shiftedCount: shifted.pairs.length,
          offPatternCount: offPatternInstances.length,
          noteMentionCount: Array.isArray(meeting.noteMentions) ? meeting.noteMentions.length : 0,
          inAIAttention: aiUnscheduledNames.has(meeting.name),
        }
      })
      .sort((left, right) => {
        if (left.status.code !== right.status.code) {
          const order = { warning: 0, attention: 1, default: 2, ok: 3 }
          return order[left.status.code] - order[right.status.code]
        }
        return left.meeting.name.localeCompare(right.meeting.name, 'zh-CN')
      })
  }, [activeMeetings, aiUnscheduledNames, checkStatusMap, scheduledMeetings, sourceRange])

  const filteredChecklistRows = useMemo(() => {
    return checklistRows.filter((row) => {
      const search = checkSearchText.trim().toLowerCase()
      if (search) {
        const haystack = `${row.meeting.name} ${row.meeting.attendees ?? ''} ${row.meeting.notes ?? ''}`.toLowerCase()
        if (!haystack.includes(search)) return false
      }

      if (checkFilterType === 'unchecked') return !row.checked
      if (checkFilterType === 'warning') return row.status.code === 'warning'
      if (checkFilterType === 'checked') return row.checked
      return true
    })
  }, [checkFilterType, checklistRows, checkSearchText])

  const checklistCheckedCount = useMemo(
    () => checklistRows.filter((row) => row.checked).length,
    [checklistRows],
  )
  const activeChecklistMeetingId = hoveredCheckMeetingId || selectedCheckMeetingId
  const activeChecklistRow = useMemo(
    () => checklistRows.find((row) => row.id === activeChecklistMeetingId) ?? null,
    [activeChecklistMeetingId, checklistRows],
  )
  const activeChecklistActualIds = useMemo(
    () => new Set(activeChecklistRow?.actualInstances.map((item) => item.id) ?? []),
    [activeChecklistRow],
  )
  const activeChecklistActualDates = useMemo(
    () => new Set(activeChecklistRow?.actualInstances.map((item) => item.date) ?? []),
    [activeChecklistRow],
  )
  const activeChecklistMissingDates = useMemo(
    () => new Set(activeChecklistRow?.missingDates ?? []),
    [activeChecklistRow],
  )
  const activeChecklistPrimaryMeetingId = useMemo(() => {
    if (!activeChecklistRow) return ''
    if (activeChecklistRow.shiftedPairs[0]?.instance?.id) return activeChecklistRow.shiftedPairs[0].instance.id
    if (activeChecklistRow.actualInstances[0]?.id) return activeChecklistRow.actualInstances[0].id
    return ''
  }, [activeChecklistRow])
  const focusedChecklistActualId = checkFocus?.actualInstanceId ?? ''
  const focusedChecklistActualDates = useMemo(
    () => new Set(checkFocus?.actualDates ?? []),
    [checkFocus],
  )
  const focusedChecklistMissingDates = useMemo(
    () => new Set(checkFocus?.missingDates ?? []),
    [checkFocus],
  )
  const selectedChecklistDetailRow = useMemo(
    () => checklistRows.find((row) => row.id === selectedChecklistDetailId) ?? null,
    [checklistRows, selectedChecklistDetailId],
  )

  const allReserved = scheduledMeetings.length > 0 && scheduledMeetings.every((meeting) => meeting.reserved)
  const allLocked = scheduledMeetings.length > 0 && scheduledMeetings.every((meeting) => meeting.locked)

  useEffect(() => {
    if (!pendingScrollTarget) return undefined

    const frameId = window.requestAnimationFrame(() => {
      const selector =
        pendingScrollTarget.kind === 'card'
          ? `[data-review-meeting-id="${pendingScrollTarget.meetingId}"]`
          : `[data-review-day-head="${pendingScrollTarget.date}"]`
      const target = document.querySelector(selector)
      if (!target) return

      const topOffset =
        pendingScrollTarget.kind === 'card'
          ? 124
          : pendingScrollTarget.kind === 'issue'
            ? 96
            : 88
      const nextTop = Math.max(window.scrollY + target.getBoundingClientRect().top - topOffset, 0)
      window.scrollTo({ top: nextTop, behavior: 'smooth' })
      setPendingScrollTarget(null)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [monthAnchor, pendingScrollTarget, viewType, weekAnchor])

  const weekRangeLabel = `${weekDays[0]?.date ?? ''} 至 ${weekDays[weekDays.length - 1]?.date ?? ''}`
  const statItems = [
    { key: 'total', label: '总数', value: stats.total, tone: 'blue' },
    { key: 'reserved', label: '已预留', value: stats.reserved, tone: 'amber' },
    { key: 'locked', label: '已锁定', value: stats.locked, tone: 'green' },
    { key: 'conflicts', label: '冲突', value: stats.conflicts, tone: 'violet' },
  ]

  const viewTabs = (
    <div className="review-tab-group">
      <button className={viewType === 'calendar' ? 'primary-button' : 'ghost-button'} onClick={() => setViewType('calendar')}>
        周视图
      </button>
      <button className={viewType === 'month' ? 'primary-button' : 'ghost-button'} onClick={() => setViewType('month')}>
        月视图
      </button>
      <button className={viewType === 'list' ? 'primary-button' : 'ghost-button'} onClick={() => setViewType('list')}>
        <List size={16} />
        列表视图
      </button>
    </div>
  )

  const planActions = (
    <div className="review-batch-group">
      <button className="ghost-button" onClick={onImportPlan}>
        导入排程方案
      </button>
      <button className="ghost-button" onClick={onExportPlan}>
        导出排程方案
      </button>
    </div>
  )

  const batchActions = (
    <div className="review-batch-group">
      <button className="ghost-button" onClick={allReserved ? onUnreserveAll : onReserveAll}>
        <Pin size={16} />
        {allReserved ? '取消预留' : '全部预留'}
      </button>
      <button className="ghost-button" onClick={allLocked ? onUnlockAll : onLockAll}>
        <Lock size={16} />
        {allLocked ? '取消锁定' : '全部锁定'}
      </button>
      <button className="ghost-button" onClick={openLinkedAddModal}>
        <Plus size={16} />
        从会议列表补进
      </button>
      <button className="primary-button" onClick={openAdhocAddModal}>
        <Plus size={16} />
        新增临时日程
      </button>
    </div>
  )

  const monthNavigation = (
    <div className="month-nav review-inline-nav">
      <button className="icon-button" onClick={() => setMonthAnchor(formatDate(addMonths(new Date(monthAnchor), -1)))}>
        <ChevronLeft size={16} />
      </button>
      <strong>{monthView.year} 年 {monthView.month + 1} 月</strong>
      <button className="icon-button" onClick={() => setMonthAnchor(formatDate(addMonths(new Date(monthAnchor), 1)))}>
        <ChevronRight size={16} />
      </button>
    </div>
  )

  const weekNavigation = (
    <div className="month-nav review-inline-nav">
      <button className="icon-button" onClick={() => setWeekAnchor(shiftDate(weekAnchor, -7))}>
        <ChevronLeft size={16} />
      </button>
      <strong>{weekRangeLabel}</strong>
      <button className="icon-button" onClick={() => setWeekAnchor(shiftDate(weekAnchor, 7))}>
        <ChevronRight size={16} />
      </button>
    </div>
  )

  function renderReviewToolbar(navigation = null) {
    return (
      <div className="review-toolbar">
        <div className="review-toolbar-row review-toolbar-row-top">
          <div className="review-toolbar-main">
            {viewTabs}
            {navigation ? <div className="review-toolbar-nav-slot">{navigation}</div> : null}
          </div>
          <div className="review-toolbar-stats" aria-label="排程统计">
            {statItems.map((item) => (
              <div key={item.key} className={`review-toolbar-stat review-toolbar-stat-${item.tone}`}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="review-toolbar-row review-toolbar-row-bottom">
          {planActions}
          {batchActions}
        </div>
      </div>
    )
  }

  function shiftDate(dateString, days) {
    const next = new Date(dateString)
    next.setDate(next.getDate() + days)
    return formatDate(next)
  }

  function hasDetailConflict(meetingId, date, startTime, endTime) {
    return scheduledMeetings.some((meeting) => {
      if (meeting.id === meetingId || meeting.date !== date) return false
      return meeting.startTime < endTime && startTime < meeting.endTime
    })
  }

  function startDraggingMeeting(item) {
    setDraggingMeeting({
      id: item.id,
      duration: item.duration,
      startTime: item.startTime,
      endTime: item.endTime,
    })
  }

  function clearDragState() {
    setDraggingMeeting(null)
    setDragTarget(null)
  }

  const buildDragTarget = useCallback((date, slot, duration, meetingId) => {
    const startMinutes = timeToMinutes(slot)
    const endMinutes = startMinutes + duration
    return {
      date,
      startTime: slot,
      endTime: minutesToTime(endMinutes),
      meetingId,
    }
  }, [])

  const updateDragTargetFromPoint = useCallback((clientX, clientY, currentDrag = draggingMeeting) => {
    if (!currentDrag) return null

    const pointedElement = document.elementFromPoint(clientX, clientY)
    const slotElement = pointedElement?.closest?.('.review-slot[data-date][data-slot]')

    if (!slotElement) {
      setDragTarget(null)
      return null
    }

    const nextTarget = buildDragTarget(
      slotElement.dataset.date,
      slotElement.dataset.slot,
      currentDrag.duration,
      currentDrag.id,
    )

    setDragTarget(nextTarget)
    return nextTarget
  }, [buildDragTarget, draggingMeeting])

  function slotIsTargeted(date, slot) {
    if (!dragTarget || dragTarget.date !== date) return false
    const slotMinutes = timeToMinutes(slot)
    const startMinutes = timeToMinutes(dragTarget.startTime)
    const endMinutes = timeToMinutes(dragTarget.endTime)
    return slotMinutes >= startMinutes && slotMinutes < endMinutes
  }

  useEffect(() => {
    dragTargetRef.current = dragTarget
  }, [dragTarget])

  useEffect(() => {
    function handlePointerMove(event) {
      const session = pointerSessionRef.current
      if (!session) return

      if (!session.dragStarted) {
        const deltaX = event.clientX - session.startX
        const deltaY = event.clientY - session.startY
        const distance = Math.hypot(deltaX, deltaY)

        if (distance < DRAG_THRESHOLD || session.item.locked) {
          return
        }

        session.dragStarted = true
        startDraggingMeeting(session.item)
      }

      updateDragTargetFromPoint(event.clientX, event.clientY, {
        id: session.item.id,
        duration: session.item.duration,
        startTime: session.item.startTime,
        endTime: session.item.endTime,
      })
    }

    function handlePointerUp(event) {
      const session = pointerSessionRef.current
      if (!session) return

      pointerSessionRef.current = null

      if (!session.dragStarted) {
        setSelectedMeeting(session.item)
        clearDragState()
        return
      }

      const finalTarget =
        updateDragTargetFromPoint(event.clientX, event.clientY, {
          id: session.item.id,
          duration: session.item.duration,
          startTime: session.item.startTime,
          endTime: session.item.endTime,
        }) ?? dragTargetRef.current

      if (finalTarget && finalTarget.meetingId === session.item.id) {
        onMoveMeeting(session.item.id, finalTarget.date, finalTarget.startTime, finalTarget.endTime)
      }

      clearDragState()
    }

    function handlePointerCancel() {
      pointerSessionRef.current = null
      clearDragState()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [onMoveMeeting, updateDragTargetFromPoint])

  function renderReviewCard(item, variant = 'week', blockHeight = WEEK_BLOCK_HEIGHT) {
    const style = calculateCardStyle(item, startHour, blockHeight)
    const cardClassNames = [
      'review-card',
      variant === 'month' ? 'review-card-compact' : '',
      variant === 'week' && style.height <= 56 ? 'review-card-short' : '',
      `review-card-${item.frequency}`,
      activeChecklistActualIds.has(item.id) ? 'review-card-related' : '',
      activeChecklistPrimaryMeetingId === item.id ? 'review-card-related-primary' : '',
      focusedChecklistActualId === item.id ? 'review-card-related-targeted' : '',
      conflictIdSet.has(item.id) ? 'review-card-conflict' : '',
      draggingMeeting?.id === item.id ? 'review-card-dragging' : '',
      item.locked ? 'review-card-locked' : '',
      item.reserved ? 'review-card-reserved' : '',
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <div
        key={item.id}
        className={cardClassNames}
        data-review-meeting-id={item.id}
        data-review-date={item.date}
        style={{ top: `${style.top}px`, height: `${style.height}px` }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          if (event.target.closest('button')) return
          event.preventDefault()
          pointerSessionRef.current = {
            item,
            startX: event.clientX,
            startY: event.clientY,
            dragStarted: false,
          }
        }}
      >
        <div className="review-card-main">
          {item.reserved ? <span className="review-card-corner review-card-corner-reserved" aria-hidden="true" /> : null}
          {item.locked ? <span className="review-card-corner review-card-corner-locked" aria-hidden="true" /> : null}
          <div className="review-card-title">
            <span>{item.name}</span>
          </div>
          <p>{item.startTime} - {item.endTime}</p>
          <div className="review-card-toolbar">
            <button className="review-card-icon" onClick={() => onToggleReserved(item.id)} title="预留">
              <Pin size={12} className={item.reserved ? 'icon-active-orange' : ''} />
            </button>
            <button className="review-card-icon" onClick={() => onToggleLocked(item.id)} title="锁定">
              <Lock size={12} className={item.locked ? 'icon-active-green' : ''} />
            </button>
            <button className="review-card-icon review-card-icon-danger" onClick={() => onDeleteMeeting(item.id)} title="删除">
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  function submitManualMeeting() {
    if (!newMeeting.name.trim()) {
      window.alert('请输入会议名称')
      return
    }
    if (newMeeting.endTime <= newMeeting.startTime) {
      window.alert('结束时间必须晚于开始时间')
      return
    }
    if (hasDetailConflict('', newMeeting.date, newMeeting.startTime, newMeeting.endTime)) {
      const proceed = window.confirm('检测到时间冲突，是否仍然新增？')
      if (!proceed) return
    }

    const duration = timeToMinutes(newMeeting.endTime) - timeToMinutes(newMeeting.startTime)
    onAddMeeting({
      ...newMeeting,
      id: `manual-${crypto.randomUUID()}`,
      duration,
      addSource: 'adhoc',
    })
    setShowAddModal(false)
    setNewMeeting(getDefaultManualMeeting())
  }

  function getSuggestedLinkedStartTime(meetingId) {
    const matchingMeeting = scheduledMeetings
      .filter((meeting) => meeting.meetingId === meetingId)
      .sort((left, right) => right.date.localeCompare(left.date) || right.startTime.localeCompare(left.startTime))[0]
    return matchingMeeting?.startTime ?? '09:00'
  }

  function openLinkedAddModal() {
    const defaultMeetingId = activeMeetings[0]?.id ?? ''
    setAddMode('linked')
    setLinkedDraft({
      meetingId: defaultMeetingId,
      date: formatDate(new Date()),
      startTime: defaultMeetingId ? getSuggestedLinkedStartTime(defaultMeetingId) : '09:00',
    })
    setShowAddModal(true)
  }

  function openAdhocAddModal() {
    setAddMode('adhoc')
    setNewMeeting(getDefaultManualMeeting())
    setShowAddModal(true)
  }

  function focusChecklistRow(row, focus = {}) {
    setSelectedCheckMeetingId(row.id)
    const anchorDate = focus.anchorDate ?? row.actualInstances[0]?.date ?? row.missingDates[0] ?? row.expectedDates[0] ?? ''
    setCheckFocus({
      rowId: row.id,
      kind: focus.kind ?? 'row',
      actualInstanceId: focus.actualInstanceId ?? '',
      actualDates: focus.actualDates ?? [],
      missingDates: focus.missingDates ?? [],
    })

    if (anchorDate) {
      setWeekAnchor(anchorDate)
      setMonthAnchor(anchorDate)
      if (viewType !== 'calendar') {
        setViewType('calendar')
      }
      setPendingScrollTarget({
        kind: focus.kind === 'shifted' || focus.kind === 'missing' ? 'issue' : 'day',
        date: anchorDate,
      })
    }
    const element = rowRefs.current.get(row.id)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  function handleLocateChecklistRow(row) {
    const sortedInstances = [...row.actualInstances].sort(
      (left, right) => left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime),
    )

    if (sortedInstances.length > 0) {
      const currentIndex = checkLocateCycleMap[row.id] ?? 0
      const targetInstance = sortedInstances[currentIndex % sortedInstances.length]
      setCheckLocateCycleMap((current) => ({
        ...current,
        [row.id]: (currentIndex + 1) % sortedInstances.length,
      }))
      focusChecklistRow(row, {
        kind: 'actual',
        anchorDate: targetInstance.date,
        actualInstanceId: targetInstance.id,
        actualDates: [targetInstance.date],
        missingDates: [],
      })
      return
    }

    const targetMissingDate = row.missingDates[0] ?? row.expectedDates[0] ?? ''
    focusChecklistRow(row, {
      kind: 'missing',
      anchorDate: targetMissingDate,
      actualDates: [],
      missingDates: targetMissingDate ? [targetMissingDate] : [],
    })
  }

  function handleOpenChecklistDetail(row, event) {
    event.stopPropagation()
    setSelectedCheckMeetingId(row.id)
    const primaryInstance = row.shiftedPairs[0]?.instance ?? row.actualInstances[0] ?? null
    if (primaryInstance) {
      setSelectedMeeting(primaryInstance)
      return
    }
    setSelectedChecklistDetailId(row.id)
  }

  function closeChecklistDetail() {
    setSelectedChecklistDetailId('')
  }

  function handleLocateChecklistIssue(row, line, event) {
    event.stopPropagation()
    const issueDates = [line.plannedDate, line.actualDate].filter(Boolean).sort()
    const anchorDate = issueDates[0] ?? row.actualInstances[0]?.date ?? row.expectedDates[0] ?? ''
    focusChecklistRow(row, {
      kind: line.kind,
      anchorDate,
      actualInstanceId: line.instanceId ?? '',
      actualDates: line.actualDate ? [line.actualDate] : [],
      missingDates: line.plannedDate ? [line.plannedDate] : [],
    })
  }

  function openRestoreModal(row, event) {
    event.stopPropagation()
    const referenceInstance = row.actualInstances[0] ?? null
    const defaultStartTime = referenceInstance?.startTime ?? '09:00'
    const defaultDate = row.missingDates[0] ?? row.expectedDates[0] ?? sourceRange?.start ?? ''
    setRestoreDraft({
      rowId: row.id,
      date: defaultDate,
      startTime: defaultStartTime,
    })
  }

  function closeRestoreModal() {
    setRestoreDraft(null)
  }

  const restoreRow = useMemo(
    () => (restoreDraft ? checklistRows.find((item) => item.id === restoreDraft.rowId) ?? null : null),
    [restoreDraft, checklistRows],
  )

  function handleRestoreSubmit() {
    if (!restoreDraft || !restoreRow || !onRestoreMissingInstance) return
    if (!restoreDraft.date || !restoreDraft.startTime) return

    const endTime = minutesToTime(timeToMinutes(restoreDraft.startTime) + restoreRow.meeting.duration)
    onRestoreMissingInstance({
      meeting: restoreRow.meeting,
      date: restoreDraft.date,
      startTime: restoreDraft.startTime,
      endTime,
    })
    setSelectedCheckMeetingId(restoreRow.id)
    closeRestoreModal()
  }

  function submitLinkedMeeting() {
    const sourceMeeting = sourceMeetingsById.get(linkedDraft.meetingId)
    if (!sourceMeeting) {
      window.alert('请选择一个会议列表中的会议')
      return
    }
    if (!linkedDraft.date || !linkedDraft.startTime) {
      window.alert('请选择日期和开始时间')
      return
    }

    const endTime = minutesToTime(timeToMinutes(linkedDraft.startTime) + sourceMeeting.duration)
    if (hasDetailConflict('', linkedDraft.date, linkedDraft.startTime, endTime)) {
      const proceed = window.confirm('检测到时间冲突，是否仍然补进审核方案？')
      if (!proceed) return
    }

    onAddMeeting({
      id: `review-linked-${crypto.randomUUID()}`,
      taskId: '',
      meetingId: sourceMeeting.id,
      name: sourceMeeting.name,
      date: linkedDraft.date,
      startTime: linkedDraft.startTime,
      endTime,
      duration: sourceMeeting.duration,
      attendees: sourceMeeting.attendees ?? '',
      notes: sourceMeeting.notes ?? '',
      noteMentions: sourceMeeting.noteMentions ?? [],
      frequency: sourceMeeting.frequency?.type ?? 'adhoc',
      sourceFrequency: sourceMeeting.frequency ?? null,
      sourceAnchorDate: sourceMeeting.frequency?.anchorDate ?? '',
      aiReason: '从会议列表补进',
      locked: false,
      reserved: false,
      manuallyAdded: false,
      addSource: 'linked',
    })

    setShowAddModal(false)
    setLinkedDraft(getDefaultLinkedDraft(firstDate))
  }

  function renderChecklistPanel() {
    return (
      <aside className="panel review-checklist-panel">
        <div className="review-checklist-topbar">
          <div className="review-checklist-title">
            <CheckCircle2 size={16} />
            <strong>检查清单</strong>
          </div>
          <span className="review-checklist-progress">
            {checklistCheckedCount} / {checklistRows.length}
          </span>
        </div>
        <label className="review-checklist-search">
          <Search size={15} />
          <input
            type="text"
            placeholder="搜索会议、参会人或备注"
            value={checkSearchText}
            onChange={(event) => setCheckSearchText(event.target.value)}
          />
        </label>
        <div className="review-checklist-filters">
          <Filter size={14} />
          {[
            ['all', '全部'],
            ['warning', '待处理'],
            ['unchecked', '未确认'],
            ['checked', '已确认'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={checkFilterType === id ? 'review-checklist-filter review-checklist-filter-active' : 'review-checklist-filter'}
              onClick={() => setCheckFilterType(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="review-checklist-list">
          {filteredChecklistRows.map((row) => {
            const noteLines = buildChecklistNoteLines(row)
            const metaPills = getChecklistMetaPills(row)

            return (
              <div
                key={row.id}
                ref={(node) => {
                  if (node) rowRefs.current.set(row.id, node)
                  else rowRefs.current.delete(row.id)
                }}
              className={[
                'review-checklist-item',
                `review-checklist-item-${row.status.code}`,
                selectedCheckMeetingId === row.id ? 'review-checklist-item-active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseEnter={() => setHoveredCheckMeetingId(row.id)}
              onMouseLeave={() => setHoveredCheckMeetingId('')}
              onClick={() => handleLocateChecklistRow(row)}
            >
                <div className="review-checklist-item-head">
                  <button
                    type="button"
                    className="review-checklist-item-title"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleLocateChecklistRow(row)
                    }}
                  >
                    <strong>{row.meeting.name}</strong>
                  </button>
                </div>
                <div className="review-checklist-item-state">{row.status.label}</div>
                <div className="review-checklist-item-meta">
                  {metaPills.map((pill) => (
                    <span key={`${row.id}-${pill.key}`} className={pill.className}>
                      {pill.label}
                    </span>
                  ))}
                </div>
                {noteLines.length > 0 ? (
                  <div className="review-checklist-item-note">
                    {noteLines.map((line) => (
                      <div key={line.id} className="review-checklist-item-note-line">
                        {line.kind === 'shifted' || line.kind === 'missing' ? (
                          <button
                            type="button"
                            className="review-checklist-note-button"
                            onClick={(event) => handleLocateChecklistIssue(row, line, event)}
                          >
                            {line.text}
                          </button>
                        ) : (
                          line.text
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="review-checklist-actions">
                  <label className="review-checklist-checkbox" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={row.checked}
                      onChange={() => onToggleChecked?.(row.id)}
                    />
                    <span>确认</span>
                  </label>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={(event) => handleOpenChecklistDetail(row, event)}
                  >
                    查看
                  </button>
                  {row.missingDates.length > 0 ? (
                    <button type="button" className="ghost-button" onClick={(event) => openRestoreModal(row, event)}>
                      补回
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
          {filteredChecklistRows.length === 0 ? <div className="info-note">当前筛选下没有检查项。</div> : null}
        </div>
      </aside>
    )
  }

  if (viewType === 'month') {
    return (
      <div className="review-layout review-layout-integrated">
        {renderChecklistPanel()}
        <section className="panel">
          {renderReviewToolbar(monthNavigation)}
          <div className="review-month-board">
            {monthWeeks.map((week, weekIndex) => (
              <div key={`month-week-${weekIndex}`} className="review-month-week">
                <div
                  className="time-column time-column-compact"
                  style={{ gridTemplateRows: `38px repeat(${timeSlots.length}, ${MONTH_BLOCK_HEIGHT}px)` }}
                >
                  <div className="time-head time-head-compact" />
                  {timeSlots.map((slot) => (
                    <div
                      key={`month-${weekIndex}-${slot}`}
                      className={
                        slot.endsWith(':00')
                          ? 'time-cell time-cell-hour time-cell-compact'
                          : slot.endsWith(':30')
                            ? 'time-cell time-cell-half time-cell-compact'
                            : 'time-cell time-cell-compact'
                      }
                    >
                      {slot.endsWith(':00') ? slot : ''}
                    </div>
                  ))}
                </div>
                <div className="review-grid review-grid-month">
                {week.map((day) => {
                  const items = meetingsByDate.get(day.date) ?? []
                  const isRelatedDate =
                    activeChecklistActualDates.has(day.date) ||
                    activeChecklistMissingDates.has(day.date) ||
                    focusedChecklistActualDates.has(day.date) ||
                    focusedChecklistMissingDates.has(day.date)
                  const isMissingDate =
                    activeChecklistMissingDates.has(day.date) || focusedChecklistMissingDates.has(day.date)
                  const isTargetDate =
                    focusedChecklistActualDates.has(day.date) || focusedChecklistMissingDates.has(day.date)
                  return (
                      <div
                        key={day.date}
                        className={[
                          day.isCurrentMonth
                            ? 'review-day-column review-day-column-month'
                            : 'review-day-column review-day-column-month review-day-column-muted',
                          isRelatedDate ? 'review-day-column-related' : '',
                          isMissingDate ? 'review-day-column-missing' : '',
                          isTargetDate ? 'review-day-column-targeted' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <div
                          className="review-day-head review-day-head-month"
                          data-review-day-head={day.date}
                          onClick={() => setSelectedDay({ date: day.date, meetings: items })}
                        >
	                          <div className="review-day-head-main">
	                            <strong>{getWeekdayName(day.date)}</strong>
	                            <span>{day.date}</span>
	                          </div>
                          {focusedChecklistMissingDates.has(day.date) || isMissingDate || focusedChecklistActualDates.has(day.date) ? (
                            <div className="review-day-flags">
                              {focusedChecklistMissingDates.has(day.date) ? (
                                <em className="review-day-flag review-day-flag-strong">待补</em>
                              ) : isMissingDate ? (
                                <em className="review-day-flag">待补</em>
                              ) : null}
                              {focusedChecklistActualDates.has(day.date) ? (
                                <em className="review-day-flag review-day-flag-focus">定位</em>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="review-day-body review-day-body-month" style={{ height: `${monthBodyHeight}px` }}>
                          {timeSlots.map((slot) => (
                            <div
                              key={`${day.date}-month-${slot}`}
                              className={
                                slot.endsWith(':00')
                                  ? 'review-slot review-slot-hour review-slot-month'
                                  : slot.endsWith(':30')
                                    ? 'review-slot review-slot-half review-slot-month'
                                    : 'review-slot review-slot-month'
                              }
                              data-date={day.date}
                              data-slot={slot}
                            >
                              {slotIsTargeted(day.date, slot) ? <div className="review-drop-preview review-drop-preview-month" /> : null}
                            </div>
                          ))}
                          {items.map((item) => renderReviewCard(item, 'month', MONTH_BLOCK_HEIGHT))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
        {selectedDay ? renderDayDetail() : null}
        {showAddModal ? renderAddModal() : null}
        {selectedMeeting ? renderMeetingDetail() : null}
        {selectedChecklistDetailRow ? renderChecklistDetail() : null}
        {restoreDraft ? renderRestoreModal() : null}
      </div>
    )
  }

  if (viewType === 'calendar') {
    return (
      <div className="review-layout review-layout-integrated">
        {renderChecklistPanel()}
        <section className="panel">
          {renderReviewToolbar(weekNavigation)}
          {scheduledMeetings.length === 0 ? (
            <div className="empty-state review-empty-state">
              <p>审核区暂无数据，通常先去“生成清单”完成 AI 排程，再把结果导入这里。</p>
              <div className="panel-actions">
                <button className="primary-button" onClick={onGoToPlannerStep}>
                  去生成清单
                </button>
                <button className="ghost-button" onClick={onImportPlan}>
                  直接导入排程方案
                </button>
              </div>
            </div>
          ) : (
            <div className="review-calendar">
              <div className="time-column" style={{ gridTemplateRows: `44px repeat(${timeSlots.length}, ${WEEK_BLOCK_HEIGHT}px)` }}>
                <div className="time-head" />
                {timeSlots.map((slot) => (
                  <div
                    key={slot}
                    className={
                      slot.endsWith(':00')
                        ? 'time-cell time-cell-hour'
                        : slot.endsWith(':30')
                          ? 'time-cell time-cell-half'
                          : 'time-cell'
                    }
                  >
                    {slot.endsWith(':00') ? slot : ''}
                  </div>
                ))}
              </div>
              <div className="review-grid">
                {weekDays.map((day) => {
                  const items = meetingsByDate.get(day.date) ?? []
                const isRelatedDate =
                  activeChecklistActualDates.has(day.date) ||
                  activeChecklistMissingDates.has(day.date) ||
                  focusedChecklistActualDates.has(day.date) ||
                  focusedChecklistMissingDates.has(day.date)
                const isMissingDate =
                  activeChecklistMissingDates.has(day.date) || focusedChecklistMissingDates.has(day.date)
                const isTargetDate =
                  focusedChecklistActualDates.has(day.date) || focusedChecklistMissingDates.has(day.date)
                return (
                    <div
                      key={day.date}
                      className={[
                        'review-day-column',
                        isRelatedDate ? 'review-day-column-related' : '',
                    isMissingDate ? 'review-day-column-missing' : '',
                    isTargetDate ? 'review-day-column-targeted' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <div className="review-day-head" data-review-day-head={day.date}>
                        <div className="review-day-head-main">
                          <strong>{day.weekdayLabel}</strong>
                          <span>{day.date}</span>
                        </div>
                        {focusedChecklistMissingDates.has(day.date) || isMissingDate || focusedChecklistActualDates.has(day.date) ? (
                          <div className="review-day-flags">
                            {focusedChecklistMissingDates.has(day.date) ? (
                              <em className="review-day-flag review-day-flag-strong">待补</em>
                            ) : isMissingDate ? (
                              <em className="review-day-flag">待补</em>
                            ) : null}
                            {focusedChecklistActualDates.has(day.date) ? (
                              <em className="review-day-flag review-day-flag-focus">定位</em>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="review-day-body" style={{ height: `${weekBodyHeight}px` }}>
                        {timeSlots.map((slot) => (
                          <div
                            key={`${day.date}-${slot}`}
                            className={
                              slot.endsWith(':00')
                                ? 'review-slot review-slot-hour'
                                : slot.endsWith(':30')
                                  ? 'review-slot review-slot-half'
                                  : 'review-slot'
                            }
                            data-date={day.date}
                            data-slot={slot}
                          >
                            {slotIsTargeted(day.date, slot) ? <div className="review-drop-preview" /> : null}
                          </div>
                        ))}
                        {items.map((item) => renderReviewCard(item, 'week', WEEK_BLOCK_HEIGHT))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>
        {showAddModal ? renderAddModal() : null}
        {selectedMeeting ? renderMeetingDetail() : null}
        {selectedChecklistDetailRow ? renderChecklistDetail() : null}
        {restoreDraft ? renderRestoreModal() : null}
      </div>
    )
  }

  return (
    <div className="review-layout review-layout-integrated">
      {renderChecklistPanel()}
      <section className="panel review-list-panel">
        {renderReviewToolbar()}
        <div className="review-list-scroll">
          {[...meetingsByDate.entries()].map(([date, items]) => (
            <div key={date} className="day-block">
              <div className="day-head">
                <strong>{date}</strong>
                <span>{items.length} 个会议</span>
              </div>
              <div className="schedule-list">
                {items.map((item) => (
                  <div key={item.id} className={conflictIdSet.has(item.id) ? 'schedule-item conflict' : 'schedule-item'}>
                    <div>
                      <strong>{item.name}</strong>
                      <p>{item.startTime} - {item.endTime}</p>
                      {item.sourceFrequency ? <p>{formatSourceFrequency(item.sourceFrequency)}</p> : null}
                      {item.aiReason ? <p>{getReadableAiReason(item.aiReason)}</p> : null}
                    </div>
                    <div className="review-actions">
                      <span className={FREQUENCY_COLORS[item.frequency]}>{FREQUENCY_LABELS[item.frequency]}</span>
                      <button className="icon-button" onClick={() => onToggleReserved(item.id)}>
                        <Pin size={14} className={item.reserved ? 'icon-active-orange' : ''} />
                      </button>
                      <button className="icon-button" onClick={() => onToggleLocked(item.id)}>
                        <Lock size={14} className={item.locked ? 'icon-active-green' : ''} />
                      </button>
                      <button className="icon-button danger" onClick={() => onDeleteMeeting(item.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      {showAddModal ? renderAddModal() : null}
      {selectedMeeting ? renderMeetingDetail() : null}
      {selectedChecklistDetailRow ? renderChecklistDetail() : null}
      {restoreDraft ? renderRestoreModal() : null}
    </div>
  )

  function renderRestoreModal() {
    if (!restoreRow) return null

    return (
      <div className="modal-backdrop" onClick={closeRestoreModal}>
        <div className="modal-card" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header">
            <h2>补回遗漏排期</h2>
            <button className="icon-button" onClick={closeRestoreModal}>
              <X size={16} />
            </button>
          </div>
          <div className="log-list">
            <div className="log-item">
              <strong>{restoreRow.meeting.name}</strong>
              <p>建议补排日期：{restoreRow.missingDates.join('、') || '无'}</p>
              <p>{summarizeText(restoreRow.meeting.notes, '无备注')}</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>日期</span>
              <input
                type="date"
                value={restoreDraft.date}
                onChange={(event) => setRestoreDraft((current) => ({ ...current, date: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>开始时间</span>
              <input
                type="time"
                value={restoreDraft.startTime}
                onChange={(event) => setRestoreDraft((current) => ({ ...current, startTime: event.target.value }))}
              />
            </label>
            <div className="field">
              <span>结束时间</span>
              <div className="field-static-value">
                {minutesToTime(timeToMinutes(restoreDraft.startTime) + restoreRow.meeting.duration)}
              </div>
            </div>
          </div>
          <div className="panel-actions">
            <button className="ghost-button" onClick={closeRestoreModal}>
              取消
            </button>
            <button className="primary-button" onClick={handleRestoreSubmit}>
              补回到排程区
            </button>
          </div>
        </div>
      </div>
    )
  }

  function renderMeetingDetail() {
    const editDate = detailEdits[selectedMeeting.id]?.date ?? selectedMeeting.date
    const editStart = detailEdits[selectedMeeting.id]?.startTime ?? selectedMeeting.startTime
    const editEnd = detailEdits[selectedMeeting.id]?.endTime ?? selectedMeeting.endTime
    const sourceMeeting = selectedMeeting.meetingId ? sourceMeetingsById.get(selectedMeeting.meetingId) : null
    const lastHistoryDate =
      Array.isArray(sourceMeeting?.history) && sourceMeeting.history.length > 0
        ? sourceMeeting.history[sourceMeeting.history.length - 1]
        : ''

    return (
      <div className="modal-backdrop" onClick={() => setSelectedMeeting(null)}>
        <div className="modal-card" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header">
            <h2>{selectedMeeting.name}</h2>
            <button className="icon-button" onClick={() => setSelectedMeeting(null)}>
              <X size={16} />
            </button>
          </div>
          <div className="log-list">
            <div className="log-item review-meeting-info-card">
              <div className="review-meeting-info">
                <strong>会议信息</strong>
                <div className="review-meeting-info-grid">
                  <div className="review-meeting-info-metric">
                    <span>当前排程时间</span>
                    <strong>
                      {selectedMeeting.date} · {selectedMeeting.startTime} - {selectedMeeting.endTime}
                    </strong>
                  </div>
                  <div className="review-meeting-info-metric">
                    <span>最近一次发生日期</span>
                    <strong>{lastHistoryDate || '暂无记录'}</strong>
                  </div>
                  <div className="review-meeting-info-metric">
                    <span>排程频率</span>
                    <strong>{selectedMeeting.sourceFrequency ? formatSourceFrequency(selectedMeeting.sourceFrequency) : '未设置'}</strong>
                  </div>
                </div>
                {selectedMeeting.attendees ? (
                  <div className="review-meeting-info-section">
                    <span>参会人</span>
                    <p className="preserve-lines">{selectedMeeting.attendees}</p>
                  </div>
                ) : null}
                {selectedMeeting.notes ? (
                  <div className="review-meeting-info-section">
                    <span>备注</span>
                    <p>{selectedMeeting.notes}</p>
                  </div>
                ) : null}
                {selectedMeeting.aiReason ? (
                  <div className="review-meeting-info-section review-meeting-info-section-ai">
                    <span>AI 说明</span>
                    <p>{getReadableAiReason(selectedMeeting.aiReason)}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>日期</span>
              <input
                type="date"
                value={editDate}
                onChange={(event) =>
                  setDetailEdits((current) => ({
                    ...current,
                    [selectedMeeting.id]: {
                      date: event.target.value,
                      startTime: current[selectedMeeting.id]?.startTime ?? selectedMeeting.startTime,
                      endTime: current[selectedMeeting.id]?.endTime ?? selectedMeeting.endTime,
                    },
                  }))
                }
              />
            </label>
            <label className="field">
              <span>开始时间</span>
              <input
                type="time"
                value={editStart}
                onChange={(event) =>
                  setDetailEdits((current) => ({
                    ...current,
                    [selectedMeeting.id]: {
                      date: current[selectedMeeting.id]?.date ?? selectedMeeting.date,
                      startTime: event.target.value,
                      endTime: current[selectedMeeting.id]?.endTime ?? selectedMeeting.endTime,
                    },
                  }))
                }
              />
            </label>
            <label className="field">
              <span>结束时间</span>
              <input
                type="time"
                value={editEnd}
                onChange={(event) =>
                  setDetailEdits((current) => ({
                    ...current,
                    [selectedMeeting.id]: {
                      date: current[selectedMeeting.id]?.date ?? selectedMeeting.date,
                      startTime: current[selectedMeeting.id]?.startTime ?? selectedMeeting.startTime,
                      endTime: event.target.value,
                    },
                  }))
                }
              />
            </label>
          </div>
          <div className="panel-actions">
            <button className="ghost-button" onClick={() => onToggleReserved(selectedMeeting.id)}>
              <Pin size={14} className={selectedMeeting.reserved ? 'icon-active-orange' : ''} />
              {selectedMeeting.reserved ? '取消预留' : '标记预留'}
            </button>
            <button className="ghost-button" onClick={() => onToggleLocked(selectedMeeting.id)}>
              <Lock size={14} className={selectedMeeting.locked ? 'icon-active-green' : ''} />
              {selectedMeeting.locked ? '取消锁定' : '锁定日程'}
            </button>
            <button
              className="ghost-button"
              onClick={() => {
                if (editEnd <= editStart) {
                  window.alert('结束时间必须晚于开始时间')
                  return
                }
                if (hasDetailConflict(selectedMeeting.id, editDate, editStart, editEnd)) {
                  const proceed = window.confirm('检测到当天存在时间冲突，是否仍然保存？')
                  if (!proceed) return
                }
                onMoveMeeting(selectedMeeting.id, editDate, editStart, editEnd)
                setSelectedMeeting((current) =>
                  current
                    ? { ...current, date: editDate, startTime: editStart, endTime: editEnd }
                    : current,
                )
              }}
            >
              保存时间
            </button>
            <button
              className="ghost-button danger"
              onClick={() => {
                onDeleteMeeting(selectedMeeting.id)
                setSelectedMeeting(null)
              }}
            >
              <Trash2 size={14} />
              删除日程
            </button>
          </div>
        </div>
      </div>
    )
  }

  function renderDayDetail() {
    return (
      <div className="modal-backdrop" onClick={() => setSelectedDay(null)}>
        <div className="modal-card" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header">
            <h2>{selectedDay.date} 日程详情</h2>
            <button className="icon-button" onClick={() => setSelectedDay(null)}>
              <X size={16} />
            </button>
          </div>
          {selectedDay.meetings.length === 0 ? (
            <div className="empty-state">当天没有会议。</div>
          ) : (
            <div className="log-list">
              {selectedDay.meetings.map((item) => (
                <div key={item.id} className={conflictIdSet.has(item.id) ? 'log-item schedule-item-conflict' : 'log-item'}>
                  <div>
                    <strong>{item.name}</strong>
                    <p>{item.startTime} - {item.endTime}</p>
                    {item.sourceFrequency ? <p>{formatSourceFrequency(item.sourceFrequency)}</p> : null}
                    {item.attendees ? <p className="preserve-lines">{item.attendees}</p> : null}
                    {item.aiReason ? <p>{getReadableAiReason(item.aiReason)}</p> : null}
                    <div className="detail-edit-row">
                      <input
                        type="time"
                        value={detailEdits[item.id]?.startTime ?? item.startTime}
                        onChange={(event) =>
                          setDetailEdits((current) => ({
                            ...current,
                            [item.id]: {
                              startTime: event.target.value,
                              endTime: current[item.id]?.endTime ?? item.endTime,
                            },
                          }))
                        }
                      />
                      <input
                        type="time"
                        value={detailEdits[item.id]?.endTime ?? item.endTime}
                        onChange={(event) =>
                          setDetailEdits((current) => ({
                            ...current,
                            [item.id]: {
                              startTime: current[item.id]?.startTime ?? item.startTime,
                              endTime: event.target.value,
                            },
                          }))
                        }
                      />
                      <button
                        className="ghost-button"
                        onClick={() => {
                          const nextStart = detailEdits[item.id]?.startTime ?? item.startTime
                          const nextEnd = detailEdits[item.id]?.endTime ?? item.endTime
                          if (nextEnd <= nextStart) {
                            window.alert('结束时间必须晚于开始时间')
                            return
                          }
                          if (hasDetailConflict(item.id, selectedDay.date, nextStart, nextEnd)) {
                            const proceed = window.confirm('检测到当天存在时间冲突，是否仍然保存？')
                            if (!proceed) return
                          }
                          onMoveMeeting(item.id, selectedDay.date, nextStart, nextEnd)
                          setSelectedDay((current) =>
                            current
                              ? {
                                  ...current,
                                  meetings: current.meetings.map((meeting) =>
                                    meeting.id === item.id ? { ...meeting, startTime: nextStart, endTime: nextEnd } : meeting,
                                  ),
                                }
                              : current,
                          )
                        }}
                      >
                        保存时间
                      </button>
                    </div>
                  </div>
                  <div className="review-actions">
                    <span className={FREQUENCY_COLORS[item.frequency]}>{FREQUENCY_LABELS[item.frequency]}</span>
                    <button className="icon-button danger" onClick={() => onDeleteMeeting(item.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderChecklistDetail() {
    if (!selectedChecklistDetailRow) return null

    const row = selectedChecklistDetailRow
    const noteLines = buildChecklistNoteLines(row)
    const normalCount = Math.max(row.expectedCount - row.missingDates.length - row.shiftedCount, 0)

    return (
      <div className="modal-backdrop" onClick={closeChecklistDetail}>
        <div className="modal-card" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header">
            <h2>{row.meeting.name}</h2>
            <button className="icon-button" onClick={closeChecklistDetail}>
              <X size={16} />
            </button>
          </div>
          <div className="review-linked-preview">
            <div className="review-linked-preview-head">
              <strong>检查项详情</strong>
              <span>{row.status.label}</span>
            </div>
            <div className="review-linked-preview-grid">
              <div>
                <span>频率</span>
                <p>{FREQUENCY_LABELS[row.meeting.frequency?.type ?? row.meeting.frequency ?? 'adhoc']}</p>
              </div>
              <div>
                <span>计划 / 正常</span>
                <p>{row.expectedCount} 次 / {normalCount} 次</p>
              </div>
              <div>
                <span>改期 / 未排</span>
                <p>{row.shiftedCount} 次 / {row.missingDates.length} 次</p>
              </div>
              <div>
                <span>备注约束</span>
                <p>{row.noteMentionCount > 0 ? `${row.noteMentionCount} 条` : '无'}</p>
              </div>
            </div>
            {row.expectedDates.length > 0 ? (
              <div className="conflict-note">
                <strong>计划日期</strong>
                <p>{row.expectedDates.join('、')}</p>
              </div>
            ) : null}
            {noteLines.length > 0 ? (
              <div className="conflict-note">
                <strong>问题说明</strong>
                <div className="review-note-list">
                  {noteLines.map((line) => (
                    <div key={line.id} className="review-note-item">
                      <span className="review-note-item-reason">{line.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {row.meeting.attendees ? (
              <div className="conflict-note">
                <strong>参会人</strong>
                <p className="preserve-lines">{row.meeting.attendees}</p>
              </div>
            ) : null}
            {row.meeting.notes ? (
              <div className="conflict-note">
                <strong>备注</strong>
                <p className="preserve-lines">{row.meeting.notes}</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  function renderAddModal() {
    const linkedMeeting = sourceMeetingsById.get(linkedDraft.meetingId)
    const linkedEndTime = linkedMeeting
      ? minutesToTime(timeToMinutes(linkedDraft.startTime) + linkedMeeting.duration)
      : '--:--'

    return (
      <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
        <div className="modal-card" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header">
            <h2>{addMode === 'linked' ? '从会议列表补进' : '新增临时日程'}</h2>
            <button className="icon-button" onClick={() => setShowAddModal(false)}>
              <X size={16} />
            </button>
          </div>
          {addMode === 'linked' ? (
            <>
              <div className="form-grid">
                <label className="field field-span-2">
                  <span>选择会议</span>
                  <select
                    value={linkedDraft.meetingId}
                    onChange={(event) => {
                      const nextMeetingId = event.target.value
                      setLinkedDraft((current) => ({
                        ...current,
                        meetingId: nextMeetingId,
                        startTime: getSuggestedLinkedStartTime(nextMeetingId),
                      }))
                    }}
                  >
                    <option value="">请选择会议</option>
                    {activeMeetings.map((meeting) => (
                      <option key={meeting.id} value={meeting.id}>
                        {meeting.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>日期</span>
                  <input
                    type="date"
                    value={linkedDraft.date}
                    onChange={(event) => setLinkedDraft((current) => ({ ...current, date: event.target.value }))}
                  />
                </label>
                <label className="field">
                  <span>开始时间</span>
                  <input
                    type="time"
                    value={linkedDraft.startTime}
                    onChange={(event) => setLinkedDraft((current) => ({ ...current, startTime: event.target.value }))}
                  />
                </label>
                <div className="field">
                  <span>结束时间</span>
                  <div className="field-static-value">{linkedEndTime}</div>
                </div>
              </div>
              {linkedMeeting ? (
                <div className="review-linked-preview">
                  <div className="review-linked-preview-head">
                    <strong>{linkedMeeting.name}</strong>
                    <span>{FREQUENCY_LABELS[linkedMeeting.frequency?.type] ?? '不定期'} · {linkedMeeting.duration} 分钟</span>
                  </div>
                  <div className="review-linked-preview-grid">
                    <div>
                      <span>参会人</span>
                      <p className="preserve-lines">{linkedMeeting.attendees || '未填写参会人'}</p>
                    </div>
                    <div>
                      <span>备注</span>
                      <p>{linkedMeeting.notes || '未填写备注'}</p>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="form-grid">
              <label className="field field-span-2">
                <span>会议名称</span>
                <input value={newMeeting.name} onChange={(event) => setNewMeeting({ ...newMeeting, name: event.target.value })} />
              </label>
              <label className="field">
                <span>日期</span>
                <input type="date" value={newMeeting.date} onChange={(event) => setNewMeeting({ ...newMeeting, date: event.target.value })} />
              </label>
              <label className="field">
                <span>频率类型</span>
                <select value={newMeeting.frequency} onChange={(event) => setNewMeeting({ ...newMeeting, frequency: event.target.value })}>
                  {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>开始时间</span>
                <input type="time" value={newMeeting.startTime} onChange={(event) => setNewMeeting({ ...newMeeting, startTime: event.target.value })} />
              </label>
              <label className="field">
                <span>结束时间</span>
                <input type="time" value={newMeeting.endTime} onChange={(event) => setNewMeeting({ ...newMeeting, endTime: event.target.value })} />
              </label>
              <label className="field field-span-2">
                <span>参会人</span>
                <textarea rows="2" value={newMeeting.attendees} onChange={(event) => setNewMeeting({ ...newMeeting, attendees: event.target.value })} />
              </label>
              <label className="field field-span-2">
                <span>备注</span>
                <textarea rows="2" value={newMeeting.notes} onChange={(event) => setNewMeeting({ ...newMeeting, notes: event.target.value })} />
              </label>
            </div>
          )}
          <div className="panel-actions">
            <button className="ghost-button" onClick={() => setShowAddModal(false)}>取消</button>
            <button className="primary-button" onClick={addMode === 'linked' ? submitLinkedMeeting : submitManualMeeting}>
              {addMode === 'linked' ? '补进审核方案' : '确认添加'}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
