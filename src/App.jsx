import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { AppSidebar } from './components/AppSidebar'
import {
  AI_STORAGE_KEY,
  createEmptyMeeting,
  LOG_STORAGE_KEY,
  normalizeMeeting,
  REVIEW_STORAGE_KEY,
} from './data/meetingData'
import { BatchImportModal } from './features/batchImport/BatchImportModal'
import { ContactsView } from './features/contacts/ContactsView'
import { LogsView } from './features/logs/LogsView'
import { createLog, persistLogs, readLogs } from './features/logs/logUtils'
import { MeetingsView } from './features/meetings/MeetingsView'
import { EditModal } from './features/meetings/EditModal'
import { PlanningWorkbench } from './features/planner/PlanningWorkbench'
import { ReviewBoard } from './features/review/ReviewBoard'
import { ReserveNoticeBoard } from './features/reserveNotice/ReserveNoticeBoard'
import { normalizeNoticeTemplates } from './features/reserveNotice/notificationTemplates'
import { OutlookInviteBoard } from './features/outlookInvite/OutlookInviteBoard'
import {
  DEFAULT_REVIEW_STATE,
  normalizeReviewState,
  importAiScheduleToReview,
  persistReviewState,
  readReviewState,
} from './features/review/reviewUtils'
import { TrashView } from './features/trash/TrashView'
import { detectConflicts } from './lib/conflicts'
import { normalizeContact, resolveAttendeeRefs } from './lib/contacts'
import { calculateNextOccurrence, syncMeetingAnchorDate } from './lib/meetingFrequency'
import { persistStorage, readStorage } from './lib/storage'
import {
  DEFAULT_AI_STATE,
  normalizeAiState,
  persistAiState,
  readAiState,
} from './features/aiScheduler/aiSchedulerUtils'

const PLANNING_TASKS_STORAGE_KEY = 'meeting-manager:planning-tasks:v1'
const RESERVE_NOTICE_SCHEME_STATUS_KEY = 'meeting-manager:reserve-notice-scheme-status:v1'

function normalizePlanningTask(task) {
  const now = new Date().toISOString()
  const range = task?.timeRange ?? task?.aiState?.inputMeetings?.timeRange ?? null

  return {
    id: task?.id || `planning-task-${crypto.randomUUID()}`,
    name: task?.name || (range ? `${range.start} 至 ${range.end}` : '未命名排程任务'),
    status: task?.status || 'draft',
    timeRange: range,
    aiState: task?.aiState ?? null,
    reviewState: task?.reviewState ? normalizeReviewState(task.reviewState) : null,
    generatedCount: Number(task?.generatedCount ?? task?.aiState?.inputMeetings?.meetings?.length ?? 0),
    scheduledCount: Number(task?.scheduledCount ?? task?.reviewState?.scheduledMeetings?.length ?? 0),
    createdAt: task?.createdAt || now,
    updatedAt: task?.updatedAt || now,
  }
}

function readPlanningTasks() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PLANNING_TASKS_STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.map(normalizePlanningTask) : []
  } catch {
    return []
  }
}

function persistPlanningTasks(tasks) {
  window.localStorage.setItem(PLANNING_TASKS_STORAGE_KEY, JSON.stringify(tasks))
}

function readReserveNoticeSchemeStatus() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RESERVE_NOTICE_SCHEME_STATUS_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeReserveNoticeSchemeStatus(input) {
  return input && typeof input === 'object' && !Array.isArray(input) ? input : {}
}

function clearAiPlanningState(state) {
  const normalized = normalizeAiState(state)
  return {
    ...normalized,
    inputMeetings: null,
    exportBatch: null,
    scheduledMeetings: null,
  }
}

function App() {
  const PAGE_META = {
    meetings: {
      title: '会议库',
      description: '会议资料、回收站与排程准备',
    },
    planner: {
      title: '排程',
      description: '创建排程任务、生成清单并完成排程调整',
    },
    reserveNotice: {
      title: '预留通知',
      description: '选择已排程任务，生成与跟踪预留通知',
    },
    outlookInvite: {
      title: '会邀生成',
      description: '选择已排程任务、日程安排和会议方案，生成 Outlook 批量草稿脚本',
    },
    contacts: {
      title: '通讯录',
      description: '维护参会人姓名、邮箱与别名',
    },
    logs: {
      title: '记录',
      description: '会议与排程操作记录',
    },
  }
  const MEETING_TAB_META = {
    active: '会议列表',
    trash: '回收站',
  }
  const LOG_TAB_META = {
    meetings: '会议记录',
    planning: '排程记录',
  }

  const defaultFilters = {
    search: '',
    frequency: 'all',
    frequencyTypes: [],
    attendee: '',
    timeRange: 'all',
    historyStatus: 'all',
  }

  const initialData = useMemo(() => readStorage(), [])
  const [activeTab, setActiveTab] = useState('meetings')
  const [meetings, setMeetings] = useState(initialData.meetings)
  const [scheduledMeetings, setScheduledMeetings] = useState(initialData.scheduled)
  const [contacts, setContacts] = useState(initialData.contacts)
  const [noticeTemplates, setNoticeTemplates] = useState(
    normalizeNoticeTemplates(initialData.noticeTemplates),
  )
  const [disabledNoticeTemplateKeys, setDisabledNoticeTemplateKeys] = useState(
    initialData.disabledNoticeTemplateKeys ?? [],
  )
  const [aiState, setAiState] = useState(() => readAiState(AI_STORAGE_KEY) ?? DEFAULT_AI_STATE)
  const [reviewState, setReviewState] = useState(
    () => readReviewState(REVIEW_STORAGE_KEY) ?? DEFAULT_REVIEW_STATE,
  )
  const [planningTasks, setPlanningTasks] = useState(() => readPlanningTasks())
  const [outlookInviteJobs, setOutlookInviteJobs] = useState([])
  const [reserveNoticeSchemeStatus, setReserveNoticeSchemeStatus] = useState(() => readReserveNoticeSchemeStatus())
  const [currentPlanningTaskId, setCurrentPlanningTaskId] = useState('')
  const [selectedNoticeTaskId, setSelectedNoticeTaskId] = useState('current')
  const [selectedOutlookTaskId, setSelectedOutlookTaskId] = useState('current')
  const [logs, setLogs] = useState(() => readLogs(LOG_STORAGE_KEY))
  const [filters, setFilters] = useState(defaultFilters)
  const [showFilters, setShowFilters] = useState(false)
  const [planningTab, setPlanningTab] = useState('planner')
  const [meetingTab, setMeetingTab] = useState('active')
  const [logsTab, setLogsTab] = useState('meetings')
  const [editingMeeting, setEditingMeeting] = useState(null)
  const [isEditModalClosing, setIsEditModalClosing] = useState(false)
  const [showBatchImport, setShowBatchImport] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)

  useEffect(() => {
    persistStorage({
      meetings,
      scheduled: scheduledMeetings,
      contacts,
      noticeTemplates,
      disabledNoticeTemplateKeys,
    })
  }, [meetings, scheduledMeetings, contacts, noticeTemplates, disabledNoticeTemplateKeys])

  useEffect(() => {
    persistAiState(AI_STORAGE_KEY, aiState)
  }, [aiState])

  useEffect(() => {
    persistReviewState(REVIEW_STORAGE_KEY, reviewState)
  }, [reviewState])

  useEffect(() => {
    persistPlanningTasks(planningTasks)
  }, [planningTasks])

  useEffect(() => {
    window.localStorage.setItem(RESERVE_NOTICE_SCHEME_STATUS_KEY, JSON.stringify(reserveNoticeSchemeStatus))
  }, [reserveNoticeSchemeStatus])

  useEffect(() => {
    if (!['outlookInvite', 'reserveNotice'].includes(activeTab) || typeof window === 'undefined') return undefined
    if (typeof window.aiScheduler?.listJobs !== 'function') return undefined

    let cancelled = false

    const loadOutlookInviteJobs = async () => {
      try {
        const jobs = await window.aiScheduler.listJobs()
        if (!cancelled) {
          setOutlookInviteJobs(Array.isArray(jobs) ? jobs : [])
        }
      } catch {
        if (!cancelled) setOutlookInviteJobs([])
      }
    }

    loadOutlookInviteJobs()
    const timerId = window.setInterval(loadOutlookInviteJobs, 15000)

    return () => {
      cancelled = true
      window.clearInterval(timerId)
    }
  }, [activeTab])

  useEffect(() => {
    if (!currentPlanningTaskId || reviewState.scheduledMeetings.length === 0) return

    setPlanningTasks((current) =>
      current.map((task) =>
        task.id === currentPlanningTaskId
          ? task.status === 'scheduled' || task.reviewState
            ? normalizePlanningTask({
                ...task,
                status: task.status === 'draft' || task.status === 'list_ready' ? 'scheduled' : task.status,
                reviewState,
                scheduledCount: reviewState.scheduledMeetings.length,
                updatedAt: new Date().toISOString(),
              })
            : task
          : task,
      ),
    )
  }, [currentPlanningTaskId, reviewState])

  useEffect(() => {
    persistLogs(LOG_STORAGE_KEY, logs)
  }, [logs])

  useEffect(() => {
    if (planningTab !== 'planner') {
      setPlanningTab('planner')
    }
  }, [planningTab])

  const activeMeetings = useMemo(
    () =>
      meetings
        .filter((meeting) => meeting.status === 'active')
        .map((meeting) => {
          const syncedMeeting = syncMeetingAnchorDate(normalizeMeeting(meeting))
          return {
            ...syncedMeeting,
            nextDate: calculateNextOccurrence(syncedMeeting) || '',
          }
        }),
    [meetings],
  )

  const reviewConflicts = useMemo(
    () => detectConflicts(reviewState.scheduledMeetings),
    [reviewState.scheduledMeetings],
  )
  const deletedMeetings = useMemo(
    () => meetings.filter((meeting) => meeting.status === 'deleted'),
    [meetings],
  )
  const pageTabs = (() => {
    if (activeTab === 'meetings') {
      return Object.entries(MEETING_TAB_META).map(([id, label]) => ({
        id,
        label: id === 'trash' && deletedMeetings.length > 0 ? `${label} (${deletedMeetings.length})` : label,
      }))
    }

    if (activeTab === 'logs') {
      return Object.entries(LOG_TAB_META).map(([id, label]) => ({ id, label }))
    }

    return []
  })()

  const activePageTab =
    activeTab === 'meetings' ? meetingTab : activeTab === 'planner' ? planningTab : activeTab === 'logs' ? logsTab : ''

  useEffect(() => {
    const scrollToTop = () => {
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
      window.scrollTo({ top: 0, left: 0 })
    }
    scrollToTop()
    const frameId = window.requestAnimationFrame(scrollToTop)
    const timeoutId = window.setTimeout(scrollToTop, 0)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
    }
  }, [activeTab, activePageTab])

  function buildImportedQueueJobPayload(reviewPlan) {
    const scheduledList = Array.isArray(reviewPlan?.scheduledMeetings) ? reviewPlan.scheduledMeetings : []
    const unscheduledDetails = Array.isArray(reviewPlan?.aiSummary?.unscheduledMeetingDetails)
      ? reviewPlan.aiSummary.unscheduledMeetingDetails
      : []
    const exportTaskMap = [
      ...scheduledList
        .filter((meeting) => meeting.taskId)
        .map((meeting) => ({
          taskId: meeting.taskId,
          instanceId: meeting.id ?? '',
          meetingId: meeting.meetingId ?? '',
          date: meeting.date ?? '',
        })),
      ...unscheduledDetails
        .filter((meeting) => meeting?.taskId)
        .map((meeting) => ({
          taskId: meeting.taskId,
          instanceId: meeting.instanceId ?? '',
          meetingId: meeting.meetingId ?? '',
          date: meeting.date ?? '',
        })),
    ]

    const dedupedTaskMap = exportTaskMap.filter(
      (item, index, items) => item.taskId && items.findIndex((candidate) => candidate.taskId === item.taskId) === index,
    )

    const importedResult = {
      scheduledMeetings: scheduledList
        .filter((meeting) => meeting.taskId)
        .map((meeting) => ({
          taskId: meeting.taskId,
          date: meeting.date ?? '',
          startTime: meeting.startTime ?? '',
          endTime: meeting.endTime ?? '',
          duration: Number(meeting.duration ?? 0),
          frequency: meeting.frequency ?? 'adhoc',
          ...(meeting.notes ? { notes: meeting.notes } : {}),
          aiReason: meeting.aiReason ?? '导入排程方案',
        })),
      unscheduledMeetings: unscheduledDetails
        .filter((meeting) => meeting?.taskId)
        .map((meeting) => ({
          taskId: meeting.taskId,
          reason: meeting.reason ?? '无',
          ...(meeting.type ? { type: meeting.type } : {}),
        })),
      summary: {
        unscheduledMeetings: reviewPlan?.aiSummary?.unscheduledMeetings ?? unscheduledDetails.length,
      },
    }

    if (!reviewPlan?.sourceInputMeetings?.timeRange || dedupedTaskMap.length === 0) {
      return null
    }

    return {
      provider: 'imported',
      model: '导入方案',
      inputMeetings: reviewPlan.sourceInputMeetings,
      exportBatch: {
        batchId: `imported-${reviewPlan.importedAt ?? Date.now()}`,
        taskMap: dedupedTaskMap,
      },
      result: importedResult,
    }
  }

  function appendLog(actionType, targetName, detail) {
    setLogs((current) => [createLog(actionType, targetName, detail), ...current])
  }

  function upsertPlanningTask(patch) {
    const now = new Date().toISOString()
    const taskId = patch.id || (patch.createNew ? '' : currentPlanningTaskId) || `planning-task-${crypto.randomUUID()}`
    const normalizedPatch = normalizePlanningTask({
      ...patch,
      id: taskId,
      updatedAt: now,
      createdAt: patch.createdAt || now,
    })

    setPlanningTasks((current) => {
      const exists = current.some((task) => task.id === taskId)
      const nextTasks = exists
        ? current.map((task) =>
            task.id === taskId
              ? normalizePlanningTask({
                  ...task,
                  ...patch,
                  id: taskId,
                  createdAt: task.createdAt,
                  updatedAt: now,
                })
              : task,
          )
        : [normalizedPatch, ...current]

      return nextTasks.sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
    })
    setCurrentPlanningTaskId(taskId)
    return taskId
  }

  function createPlanningTaskFromAiState(payload, fallbackStatus = 'list_ready') {
    const hasExplicitAiState = Object.prototype.hasOwnProperty.call(payload ?? {}, 'aiState')
    const nextAiState = hasExplicitAiState ? payload.aiState : payload
    const status = payload?.status ?? fallbackStatus
    const range = nextAiState?.inputMeetings?.timeRange ?? null
    const isNewDraft = payload?.createNew && status === 'draft'
    const explicitName = String(payload?.name || '').trim()

    const taskId = upsertPlanningTask({
      ...payload,
      aiState: nextAiState,
      status,
      timeRange: payload?.timeRange ?? range,
      ...(explicitName ? { name: explicitName } : {}),
      generatedCount: payload?.generatedCount ?? nextAiState?.inputMeetings?.meetings?.length ?? 0,
    })
    if (isNewDraft) {
      setAiState((current) => clearAiPlanningState(current))
      setReviewState(DEFAULT_REVIEW_STATE)
    }
    return taskId
  }

  function deletePlanningTask(taskId) {
    setPlanningTasks((current) => current.filter((task) => task.id !== taskId))
    if (taskId === currentPlanningTaskId) {
      setCurrentPlanningTaskId('')
      setAiState((current) => clearAiPlanningState(current))
      setReviewState(DEFAULT_REVIEW_STATE)
    }
    if (taskId === selectedNoticeTaskId) {
      setSelectedNoticeTaskId('current')
    }
    if (taskId === selectedOutlookTaskId) {
      setSelectedOutlookTaskId('current')
    }
  }

  function openEditMeeting(meeting) {
    setIsEditModalClosing(false)
    setEditingMeeting(meeting)
  }

  function closeEditMeeting() {
    setIsEditModalClosing(true)
    window.setTimeout(() => {
      setEditingMeeting(null)
      setIsEditModalClosing(false)
    }, 220)
  }

  function updateReviewMeetings(updater) {
    setReviewState((current) => ({
      ...current,
      scheduledMeetings:
        typeof updater === 'function' ? updater(current.scheduledMeetings) : updater,
    }))
  }

  function toggleFinalCheckLinkage(currentState, meetingId) {
    const nextChecked = !currentState.finalCheckStatus?.[meetingId]

    return {
      ...currentState,
      finalCheckStatus: {
        ...(currentState.finalCheckStatus ?? {}),
        [meetingId]: nextChecked,
      },
      scheduledMeetings: currentState.scheduledMeetings.map((meeting) =>
        meeting.meetingId === meetingId ? { ...meeting, locked: nextChecked } : meeting,
      ),
    }
  }

  function toggleReserveNoticeLinkage(currentState, noticeId) {
    const nextSent = !currentState.reserveNoticeStatus?.[noticeId]
    const [scope, scopedId] = String(noticeId).split(':')

    return {
      ...currentState,
      reserveNoticeStatus: {
        ...(currentState.reserveNoticeStatus ?? {}),
        [noticeId]: nextSent,
      },
      scheduledMeetings: currentState.scheduledMeetings.map((meeting) => {
        if (scope === 'meeting' && meeting.meetingId === scopedId) {
          return { ...meeting, reserved: nextSent }
        }

        if (scope === 'adhoc' && meeting.id === scopedId) {
          return { ...meeting, reserved: nextSent }
        }

        return meeting
      }),
    }
  }

  function handleSaveMeeting(nextMeeting) {
    const isNew = !nextMeeting.id
    const syncedMeeting = syncMeetingAnchorDate({
      ...nextMeeting,
      attendeeRefs: resolveAttendeeRefs(nextMeeting.attendees, contacts),
      extraInviteeRefs: resolveAttendeeRefs(nextMeeting.extraInvitees, contacts),
      secretaryInviteContactIds: Array.isArray(nextMeeting.secretaryInviteContactIds)
        ? nextMeeting.secretaryInviteContactIds
        : [],
      noteMentions: Array.isArray(nextMeeting.noteMentions) ? nextMeeting.noteMentions : [],
    })
    const persistedMeeting = {
      ...syncedMeeting,
      nextDate: calculateNextOccurrence(syncedMeeting) || syncedMeeting.nextDate || '',
    }

    setMeetings((current) => {
      if (!persistedMeeting.id) {
        const maxOrder = Math.max(-1, ...current.map((meeting) => meeting.customOrder ?? 0))
        return [
          ...current,
          {
            ...persistedMeeting,
            id: `m${crypto.randomUUID()}`,
            customOrder: maxOrder + 1,
          },
        ]
      }

      return current.map((meeting) => (meeting.id === persistedMeeting.id ? persistedMeeting : meeting))
    })
    appendLog(
      isNew ? 'create' : 'update',
      persistedMeeting.name || '未命名会议',
      isNew ? '新建会议' : '编辑会议',
    )
    closeEditMeeting()
  }

  function refreshMeetingAttendeeRefs(nextContacts) {
    setMeetings((current) =>
      current.map((meeting) => ({
        ...meeting,
        attendeeRefs: resolveAttendeeRefs(meeting.attendees, nextContacts),
        extraInviteeRefs: resolveAttendeeRefs(meeting.extraInvitees, nextContacts),
      })),
    )
  }

  function handleSaveContact(contact) {
    const normalizedContact = normalizeContact(contact)
    const nextContacts = contacts.some((item) => item.id === normalizedContact.id)
      ? contacts.map((item) => (item.id === normalizedContact.id ? normalizedContact : item))
      : [...contacts, normalizedContact]

    setContacts(nextContacts)
    refreshMeetingAttendeeRefs(nextContacts)
    appendLog('update', normalizedContact.name || '未命名联系人', '保存通讯录联系人')
  }

  function handleAddContactFromName(name) {
    const trimmedName = String(name || '').trim()
    if (!trimmedName) return

    const nextContact = normalizeContact({
      name: trimmedName,
      email: '',
      aliases: [],
      department: '',
      title: '',
      notes: '',
      status: 'active',
    })

    if (contacts.some((contact) => contact.name.toLowerCase() === trimmedName.toLowerCase())) {
      return
    }

    const nextContacts = [...contacts, nextContact]
    setContacts(nextContacts)
    refreshMeetingAttendeeRefs(nextContacts)
    appendLog('create', trimmedName, '从参会人标签添加到通讯录')
  }

  function handleDeleteContact(id) {
    const target = contacts.find((contact) => contact.id === id)
    const nextContacts = contacts.filter((contact) => contact.id !== id)
    setContacts(nextContacts)
    refreshMeetingAttendeeRefs(nextContacts)
    if (target) appendLog('delete', target.name, '从通讯录删除')
  }

  function handleDeleteMeeting(id) {
    const target = meetings.find((meeting) => meeting.id === id)
    setMeetings((current) =>
      current.map((meeting) => (meeting.id === id ? { ...meeting, status: 'deleted' } : meeting)),
    )
    if (target) {
      appendLog('delete', target.name, '移入回收站')
    }
  }

  function formatExportTimestamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0')

    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      '-',
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
    ].join('')
  }

  function handleExport() {
    const exportedMeetings = meetings.map((meeting) => ({
      ...meeting,
      attendeeRefs: resolveAttendeeRefs(meeting.attendees, contacts),
      extraInviteeRefs: resolveAttendeeRefs(meeting.extraInvitees, contacts),
    }))
    const exportPayload = {
      version: '2.5',
      exportedAt: new Date().toISOString(),
      meetings: exportedMeetings,
      scheduled: scheduledMeetings,
      contacts,
      noticeTemplates,
      disabledNoticeTemplateKeys,
      logs,
      aiState,
      reviewState,
      planningTasks,
      reserveNoticeSchemeStatus,
    }

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `meeting-manager-export-${formatExportTimestamp()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function handleImportData() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'

    input.onchange = async (event) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        const text = await file.text()
        const parsed = JSON.parse(text)

        const importedMeetings = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.meetings)
            ? parsed.meetings
            : null

        if (!importedMeetings) {
          window.alert('导入失败：文件中未找到 meetings 数据。')
          return
        }

        const importedContacts = Array.isArray(parsed.contacts)
          ? parsed.contacts.map(normalizeContact)
          : initialData.contacts
        const normalizedMeetings = importedMeetings.map((meeting) => {
          const normalizedMeeting = normalizeMeeting(meeting)

          return {
            ...normalizedMeeting,
            attendeeRefs: resolveAttendeeRefs(normalizedMeeting.attendees, importedContacts),
            extraInviteeRefs: resolveAttendeeRefs(normalizedMeeting.extraInvitees, importedContacts),
          }
        })

        const overwriteConfirmed = window.confirm(
          `检测到 ${normalizedMeetings.length} 条会议记录。\n\n恢复系统备份会使用备份内容覆盖当前系统数据。\n点击“确定”继续恢复，点击“取消”放弃导入。`,
        )

        if (!overwriteConfirmed) return

        setMeetings(normalizedMeetings)
        setScheduledMeetings(Array.isArray(parsed.scheduled) ? parsed.scheduled : [])
        setContacts(importedContacts)
        setNoticeTemplates(normalizeNoticeTemplates(parsed.noticeTemplates))
        setDisabledNoticeTemplateKeys(
          Array.isArray(parsed.disabledNoticeTemplateKeys) ? parsed.disabledNoticeTemplateKeys : [],
        )
        setLogs(Array.isArray(parsed.logs) ? parsed.logs : [])
        setAiState(parsed.aiState ? normalizeAiState(parsed.aiState) : DEFAULT_AI_STATE)
        setReviewState(parsed.reviewState ? normalizeReviewState(parsed.reviewState) : DEFAULT_REVIEW_STATE)
        setPlanningTasks(Array.isArray(parsed.planningTasks) ? parsed.planningTasks.map(normalizePlanningTask) : [])
        setReserveNoticeSchemeStatus(normalizeReserveNoticeSchemeStatus(parsed.reserveNoticeSchemeStatus))
        appendLog('import', '系统备份', `恢复系统备份，覆盖 ${normalizedMeetings.length} 条会议`)
        window.alert('系统备份恢复完成。')
      } catch (error) {
        window.alert(`导入失败：${error.message}`)
      }
    }

    input.click()
  }

  function handleExportReviewPlan() {
    const exportPayload = {
      version: '2.5',
      exportedAt: new Date().toISOString(),
      reviewState,
    }

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'review-schedule-plan.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  function handleImportReviewPlan() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'

    input.onchange = async (event) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        const text = await file.text()
        const parsed = JSON.parse(text)
        const importedReview = parsed.reviewState ?? parsed
        const normalized = normalizeReviewState(importedReview)

        if (!normalized?.scheduledMeetings || !Array.isArray(normalized.scheduledMeetings)) {
          window.alert('导入失败：文件中未找到有效的审核排程数据。')
          return
        }

        setReviewState(normalized)
        upsertPlanningTask({
          reviewState: normalized,
          status: 'scheduled',
          timeRange: normalized.sourceInputMeetings?.timeRange ?? null,
          scheduledCount: normalized.scheduledMeetings.length,
          generatedCount: normalized.sourceInputMeetings?.meetings?.length ?? normalized.scheduledMeetings.length,
        })
        if (typeof window !== 'undefined' && typeof window.aiScheduler?.registerImportedJob === 'function') {
          const importedJobPayload = buildImportedQueueJobPayload(normalized)
          if (importedJobPayload) {
            try {
              await window.aiScheduler.registerImportedJob(importedJobPayload)
            } catch (queueError) {
              console.error('register imported review plan failed', queueError)
            }
          }
        }
        appendLog('review_import', '审核排程', `导入 ${normalized.scheduledMeetings.length} 条排程方案`)
        window.alert('审核排程方案导入完成。')
      } catch (error) {
        window.alert(`导入失败：${error.message}`)
      }
    }

    input.click()
  }

  function importAiStateToReview(nextAiState) {
    const nextReview = importAiScheduleToReview(nextAiState)
    setReviewState(nextReview)
    upsertPlanningTask({
      aiState: nextAiState,
      reviewState: nextReview,
      status: 'scheduled',
      timeRange: nextAiState?.inputMeetings?.timeRange ?? nextReview.sourceInputMeetings?.timeRange ?? null,
      generatedCount: nextAiState?.inputMeetings?.meetings?.length ?? 0,
      scheduledCount: nextReview.scheduledMeetings.length,
    })
    appendLog(
      'review_import',
      '审核排程',
      `导入 ${nextReview.scheduledMeetings.length} 条 AI 排程结果`,
    )

    setPlanningTab('planner')
  }

  function renderReviewBoard(onGoToPlannerStep = () => setPlanningTab('planner')) {
    return (
      <ReviewBoard
        meetings={meetings}
        scheduledMeetings={reviewState.scheduledMeetings}
        reviewState={reviewState}
        conflicts={reviewConflicts}
        onGoToPlannerStep={onGoToPlannerStep}
        onToggleLocked={(id) => {
          const target = reviewState.scheduledMeetings.find((meeting) => meeting.id === id)
          updateReviewMeetings((meetingsList) =>
            meetingsList.map((meeting) =>
              meeting.id === id ? { ...meeting, locked: !meeting.locked } : meeting,
            ),
          )
          if (target) appendLog('review', target.name, '切换锁定状态')
        }}
        onToggleReserved={(id) => {
          const target = reviewState.scheduledMeetings.find((meeting) => meeting.id === id)
          updateReviewMeetings((meetingsList) =>
            meetingsList.map((meeting) =>
              meeting.id === id ? { ...meeting, reserved: !meeting.reserved } : meeting,
            ),
          )
          if (target) appendLog('review', target.name, '切换预留状态')
        }}
        onDeleteMeeting={(id) => {
          const target = reviewState.scheduledMeetings.find((meeting) => meeting.id === id)
          updateReviewMeetings((meetingsList) => meetingsList.filter((meeting) => meeting.id !== id))
          if (target) appendLog('review_delete', target.name, '从审核区删除')
        }}
        onMoveMeeting={(id, date, startTime, endTime) => {
          const target = reviewState.scheduledMeetings.find((meeting) => meeting.id === id)
          updateReviewMeetings((meetingsList) =>
            meetingsList.map((meeting) =>
              meeting.id === id ? { ...meeting, date, startTime, endTime } : meeting,
            ),
          )
          if (target) appendLog('review_move', target.name, `调整到 ${date} ${startTime}-${endTime}`)
        }}
        onLockAll={() => {
          updateReviewMeetings((meetingsList) => meetingsList.map((meeting) => ({ ...meeting, locked: true })))
          appendLog('review', '审核区', '全部锁定')
        }}
        onUnlockAll={() => {
          updateReviewMeetings((meetingsList) => meetingsList.map((meeting) => ({ ...meeting, locked: false })))
          appendLog('review', '审核区', '全部解锁')
        }}
        onReserveAll={() => {
          updateReviewMeetings((meetingsList) => meetingsList.map((meeting) => ({ ...meeting, reserved: true })))
          appendLog('review', '审核区', '全部预留')
        }}
        onUnreserveAll={() => {
          updateReviewMeetings((meetingsList) => meetingsList.map((meeting) => ({ ...meeting, reserved: false })))
          appendLog('review', '审核区', '取消全部预留')
        }}
        onAddMeeting={(meeting) => {
          updateReviewMeetings((meetingsList) => [...meetingsList, meeting])
          const actionLabel =
            meeting.addSource === 'linked'
              ? '从会议列表补进'
              : meeting.addSource === 'review-checklist' || meeting.addSource === 'final-check'
                ? '检查清单补进'
                : '新增临时日程'
          appendLog('review', meeting.name, `${actionLabel} ${meeting.date} ${meeting.startTime}-${meeting.endTime}`)
        }}
        onExportPlan={handleExportReviewPlan}
        onImportPlan={handleImportReviewPlan}
        onToggleChecked={(meetingId) => {
          const target = meetings.find((meeting) => meeting.id === meetingId)
          const nextChecked = !reviewState.finalCheckStatus?.[meetingId]
          setReviewState((current) => toggleFinalCheckLinkage(current, meetingId))
          if (target) {
            appendLog(
              'review',
              target.name,
              nextChecked ? '检查清单已确认，审核排程自动锁定' : '取消检查确认，审核排程自动解锁',
            )
          }
        }}
        onRestoreMissingInstance={({ meeting, date, startTime, endTime }) => {
          const restoredMeeting = {
            id: `review-restored-${crypto.randomUUID()}`,
            taskId: '',
            meetingId: meeting.id,
            name: meeting.name,
            date,
            startTime,
            endTime,
            duration: meeting.duration,
            attendees: meeting.attendees ?? '',
            notes: meeting.notes ?? '',
            noteMentions: meeting.noteMentions ?? [],
            frequency: meeting.frequency?.type ?? 'adhoc',
            sourceFrequency: meeting.frequency ?? null,
            sourceAnchorDate: meeting.frequency?.anchorDate ?? '',
            aiReason: '检查清单补进',
            locked: false,
            reserved: false,
            manuallyAdded: false,
            restoredFromFinalCheck: true,
            addSource: 'review-checklist',
          }
          updateReviewMeetings((meetingsList) => [...meetingsList, restoredMeeting])
          appendLog('review', meeting.name, `检查清单补进方案 ${date} ${startTime}-${endTime}`)
        }}
      />
    )
  }

  function renderReserveNoticeBoard() {
    const noticeTaskOptions = buildScheduledTaskOptions()
    const selectedNoticeTask =
      planningTasks.find((task) => task.id === selectedNoticeTaskId) ??
      planningTasks.find((task) => task.id === noticeTaskOptions[0]?.id)
    const noticeSchemeOptions = buildOutlookSchemeOptions(selectedNoticeTask).map((scheme) => ({
      ...scheme,
      reserveNoticeStatus:
        scheme.source === 'review'
          ? selectedNoticeTask?.reviewState?.reserveNoticeStatus ?? {}
          : reserveNoticeSchemeStatus[scheme.id] ?? {},
    }))

    return (
      <ReserveNoticeBoard
        meetings={meetings}
        schemeOptions={noticeSchemeOptions}
        noticeTaskOptions={noticeTaskOptions}
        selectedTaskId={selectedNoticeTask?.id ?? ''}
        onTaskChange={setSelectedNoticeTaskId}
        noticeTemplates={noticeTemplates}
        disabledNoticeTemplateKeys={disabledNoticeTemplateKeys}
        onUpdateMeeting={(meetingId, patch) => {
          setMeetings((current) =>
            current.map((meeting) =>
              meeting.id === meetingId
                ? {
                    ...meeting,
                    ...patch,
                    notificationConfig: patch.notificationConfig ?? meeting.notificationConfig ?? {},
                  }
                : meeting,
            ),
          )
          const target = meetings.find((meeting) => meeting.id === meetingId)
          if (target) {
            appendLog('update', target.name, '更新通知设置')
          }
        }}
        onSaveTemplates={({ templates, disabledBuiltInKeys }) => {
          setNoticeTemplates(templates)
          setDisabledNoticeTemplateKeys(disabledBuiltInKeys)
          appendLog(
            'update',
            '通知模板库',
            `保存 ${templates.length} 个自定义通知模板，隐藏 ${disabledBuiltInKeys.length} 个内置模板`,
          )
        }}
        onToggleSent={(scheduledMeetingId, selectedScheme) => {
          const activeScheduledMeetings = selectedScheme?.scheduledMeetings ?? []
          const activeReserveNoticeStatus = selectedScheme?.reserveNoticeStatus ?? {}
          const [scope, scopedId] = String(scheduledMeetingId).split(':')
          const target =
            scope === 'meeting'
              ? meetings.find((meeting) => meeting.id === scopedId)
              : activeScheduledMeetings.find((meeting) => meeting.id === scopedId)
          const nextSent = !activeReserveNoticeStatus?.[scheduledMeetingId]

          if (selectedNoticeTask && selectedScheme?.source === 'review') {
            const nextTaskReview = toggleReserveNoticeLinkage(selectedNoticeTask.reviewState, scheduledMeetingId)
            setPlanningTasks((current) =>
              current.map((task) =>
                task.id === selectedNoticeTask.id
                  ? normalizePlanningTask({ ...task, reviewState: nextTaskReview, updatedAt: new Date().toISOString() })
                  : task,
              ),
            )
            if (selectedNoticeTask.id === currentPlanningTaskId) setReviewState(nextTaskReview)
          } else {
            const schemeId = selectedScheme?.id ?? 'unknown'
            setReserveNoticeSchemeStatus((current) => ({
              ...current,
              [schemeId]: {
                ...(current[schemeId] ?? {}),
                [scheduledMeetingId]: nextSent,
              },
            }))
          }

          if (target) {
            appendLog(
              'review',
              target.name,
              nextSent ? '预留通知已发送，审核排程自动标记预留' : '取消预留通知已发送，审核排程自动取消预留',
            )
          }
        }}
      />
    )
  }

  function isUsableOutlookInviteJob(job) {
    return (
      job?.planningTaskId &&
      job.status === 'completed' &&
      job.result &&
      job.inputMeetings &&
      job.exportBatch
    )
  }

  function buildScheduledTaskOptions() {
    const taskIdsWithSchemes = new Set(
      outlookInviteJobs
        .filter(isUsableOutlookInviteJob)
        .map((job) => job.planningTaskId),
    )
    const scheduledPlanningTasks = planningTasks.filter(
      (task) => task.reviewState?.scheduledMeetings?.length > 0 || taskIdsWithSchemes.has(task.id),
    )

    return scheduledPlanningTasks.map((task) => ({
        id: task.id,
        name: task.name,
        status: task.status === 'scheduled' ? '已排程' : task.status,
        scheduledCount: task.scheduledCount,
        updatedAt: task.updatedAt,
      }))
  }

  function getOutlookSchemeProviderLabel(job) {
    const labels = {
      imported: '导入方案',
      gemini: 'Gemini',
      openai: 'OpenAI',
      deepseek: 'DeepSeek',
    }

    return labels[job?.provider] ?? job?.provider ?? 'AI 方案'
  }

  function formatOutlookSchemeTime(value) {
    const date = value ? new Date(value) : null
    if (!date || Number.isNaN(date.getTime())) return ''

    const pad = (number) => String(number).padStart(2, '0')
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  function buildOutlookSchemeOptions(task) {
    if (!task) return []

    const adoptedMeetings = task.reviewState?.scheduledMeetings ?? []
    const adoptedOption =
      adoptedMeetings.length > 0
        ? [{
            id: `${task.id}:review`,
            label: `已采用方案（${adoptedMeetings.length} 会）`,
            source: 'review',
            scheduledMeetings: adoptedMeetings,
          }]
        : []

    const jobOptions = outlookInviteJobs
      .filter((job) => isUsableOutlookInviteJob(job) && job.planningTaskId === task.id)
      .map((job) => {
        let reviewFromJob = DEFAULT_REVIEW_STATE

        try {
          reviewFromJob = importAiScheduleToReview({
            inputMeetings: job.inputMeetings,
            exportBatch: job.exportBatch,
            scheduledMeetings: job.result,
          })
        } catch {
          return null
        }

        const scheduledFromJob = reviewFromJob.scheduledMeetings ?? []
        if (scheduledFromJob.length === 0) return null

        const providerLabel = getOutlookSchemeProviderLabel(job)
        const modelLabel = job.model && job.model !== providerLabel ? ` · ${job.model}` : ''
        const timeLabel = formatOutlookSchemeTime(job.completedAt ?? job.updatedAt ?? job.createdAt)

        return {
          id: `${task.id}:job:${job.id}`,
          label: `${providerLabel}${modelLabel}${timeLabel ? ` · ${timeLabel}` : ''}（${scheduledFromJob.length} 会）`,
          source: 'job',
          jobId: job.id,
          scheduledMeetings: scheduledFromJob,
        }
      })
      .filter(Boolean)

    return [...adoptedOption, ...jobOptions]
  }

  function renderOutlookInviteBoard() {
    const taskOptions = buildScheduledTaskOptions()
    const selectedOutlookTask =
      planningTasks.find((task) => task.id === selectedOutlookTaskId) ??
      planningTasks.find((task) => task.id === taskOptions[0]?.id)
    const outlookSchemeOptions = buildOutlookSchemeOptions(selectedOutlookTask)

    return (
      <OutlookInviteBoard
        meetings={meetings}
        schemeOptions={outlookSchemeOptions}
        taskOptions={taskOptions}
        selectedTaskId={selectedOutlookTask?.id ?? ''}
        onTaskChange={setSelectedOutlookTaskId}
        onExportDrafts={(count, format = 'vba') => {
          appendLog(
            'outlook_invite_export',
            'Outlook 会邀生成',
            `生成 ${count} 个会议草稿${format === 'vbs' ? '一键 VBS' : ' VBA'}`,
          )
        }}
      />
    )
  }

  return (
    <main className={[
      'app-shell app-frame',
      `app-frame-${activeTab}`,
      sidebarCollapsed ? 'app-frame-sidebar-collapsed' : '',
    ].filter(Boolean).join(' ')}>
      <AppSidebar
        activeTab={activeTab}
        collapsed={sidebarCollapsed}
        onTabChange={setActiveTab}
        onToggleCollapse={() => setSidebarCollapsed((current) => !current)}
        onImportData={handleImportData}
        onExport={handleExport}
      />
      <div className="app-main">
        <header className="app-page-header">
          <div className="app-page-header-main">
            <span className="app-page-kicker">会议管理系统</span>
            <div className="app-page-copy">
              <div className="app-page-title-row">
                <h1>{PAGE_META[activeTab].title}</h1>
                {pageTabs.length > 0 ? (
                  <div
                    className="app-page-tabs"
                    role="tablist"
                    aria-label={`${PAGE_META[activeTab].title}模块导航`}
                  >
                    {pageTabs.map(({ id, label }) => (
                      <button
                        key={id}
                        className={activePageTab === id ? 'tab-button tab-active' : 'tab-button'}
                        onClick={() => {
                          if (activeTab === 'meetings') setMeetingTab(id)
                          if (activeTab === 'planner') setPlanningTab(id)
                          if (activeTab === 'logs') setLogsTab(id)
                        }}
                        type="button"
                        role="tab"
                        aria-selected={activePageTab === id}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <p>{PAGE_META[activeTab].description}</p>
            </div>
          </div>
          <div className="app-page-status" aria-label="系统状态">
            <span>
              会议库
              <strong>{activeMeetings.length}</strong>
            </span>
            <span className={reviewConflicts.length > 0 ? 'app-page-status-warning' : ''}>
              冲突
              <strong>{reviewConflicts.length}</strong>
            </span>
            <span>
              Version
              <strong>2.5</strong>
            </span>
          </div>
        </header>

        <div className="app-page-content">
          {activeTab === 'meetings' ? (
            <MeetingsView
              contentTab={meetingTab}
              meetings={activeMeetings}
              deletedMeetings={deletedMeetings}
              filters={filters}
              setFilters={setFilters}
              defaultFilters={defaultFilters}
              showFilters={showFilters}
              setShowFilters={setShowFilters}
              onEditMeeting={openEditMeeting}
              onCreateMeeting={() => openEditMeeting(createEmptyMeeting())}
              onDeleteMeeting={handleDeleteMeeting}
              onSaveMeeting={handleSaveMeeting}
              contacts={contacts}
              onAddContact={handleAddContactFromName}
              onRestoreMeeting={(id) => {
                const target = meetings.find((meeting) => meeting.id === id)
                setMeetings((current) =>
                  current.map((meeting) =>
                    meeting.id === id ? { ...meeting, status: 'active' } : meeting,
                  ),
                )
                if (target) appendLog('restore', target.name, '从回收站恢复')
              }}
              onDeleteMeetingForever={(id) => {
                const target = meetings.find((meeting) => meeting.id === id)
                setMeetings((current) => current.filter((meeting) => meeting.id !== id))
                if (target) appendLog('hard_delete', target.name, '从回收站彻底删除')
              }}
              onBatchImport={() => setShowBatchImport(true)}
              onGoToPlanner={() => {
                setActiveTab('planner')
                setPlanningTab('planner')
              }}
              onReorderMeetings={(orderedIds) => {
                setMeetings((current) =>
                  current.map((meeting) => ({
                    ...meeting,
                    customOrder:
                      orderedIds.indexOf(meeting.id) >= 0
                        ? orderedIds.indexOf(meeting.id)
                        : meeting.customOrder ?? 0,
                  })),
                )
                appendLog('reorder', '会议列表', '调整自定义排序')
              }}
            />
          ) : activeTab === 'reserveNotice' ? (
            renderReserveNoticeBoard()
          ) : activeTab === 'outlookInvite' ? (
            renderOutlookInviteBoard()
          ) : activeTab === 'contacts' ? (
            <ContactsView
              contacts={contacts}
              onSaveContact={handleSaveContact}
              onDeleteContact={handleDeleteContact}
            />
          ) : activeTab === 'planner' ? (
            <PlanningWorkbench
              meetings={meetings}
              aiState={aiState}
              setAiState={setAiState}
              planningTasks={planningTasks}
              currentPlanningTaskId={currentPlanningTaskId}
              onCreatePlanningTask={createPlanningTaskFromAiState}
              onCreateDraftTask={createPlanningTaskFromAiState}
              onDeletePlanningTask={deletePlanningTask}
              onSelectPlanningTask={(taskId) => {
                const task = planningTasks.find((item) => item.id === taskId)
                setCurrentPlanningTaskId(taskId)
                if (task?.aiState) setAiState(normalizeAiState(task.aiState))
                else setAiState((current) => clearAiPlanningState(current))
                if (task?.reviewState) setReviewState(normalizeReviewState(task.reviewState))
                else setReviewState(DEFAULT_REVIEW_STATE)
              }}
              renderReviewBoard={renderReviewBoard}
              onApplyAiSchedule={(nextAiState, options) => {
                setAiState(nextAiState)
                appendLog(
                  'ai_schedule',
                  'AI 排程',
                  `接收 ${nextAiState.scheduledMeetings?.scheduledMeetings?.length ?? 0} 条后台结果`,
                )
                if (options?.importToReview) {
                  importAiStateToReview(nextAiState, { openReview: true })
                }
              }}
            />
          ) : (
            <LogsView
              activeSection={logsTab}
              logs={logs}
              onClear={() => setLogs([])}
              onDelete={(id) => setLogs((current) => current.filter((log) => log.id !== id))}
            />
          )}
        </div>
      </div>

      {editingMeeting ? (
        <EditModal
          meeting={editingMeeting}
          meetings={meetings}
          contacts={contacts}
          open={Boolean(editingMeeting) && !isEditModalClosing}
          isClosing={isEditModalClosing}
          onClose={closeEditMeeting}
          onSave={handleSaveMeeting}
          onAddContact={handleAddContactFromName}
        />
      ) : null}
      <BatchImportModal
        open={showBatchImport}
        meetings={meetings}
        onClose={() => setShowBatchImport(false)}
        onConfirm={(rows) => {
          const grouped = rows.reduce((accumulator, row) => {
            const meetingId = row.matchedMeeting.id
            const current = accumulator.get(meetingId) ?? []
            current.push(row.date)
            accumulator.set(meetingId, current)
            return accumulator
          }, new Map())

          setMeetings((current) =>
            current.map((meeting) => {
              const importedDates = grouped.get(meeting.id)
              if (!importedDates) return meeting

              const history = [...new Set([...(meeting.history ?? []), ...importedDates])].sort()
              const syncedMeeting = syncMeetingAnchorDate({
                ...meeting,
                history,
              })

              return {
                ...syncedMeeting,
                nextDate: calculateNextOccurrence(syncedMeeting) || meeting.nextDate || '',
              }
            }),
          )

          const duplicateCount = rows.filter((row) => row.isDuplicate).length
          appendLog(
            'batch_import',
            '会议历史记录',
            `批量导入 ${rows.length} 条历史记录${duplicateCount > 0 ? `，其中 ${duplicateCount} 条为重复日期` : ''}`,
          )
          setShowBatchImport(false)
        }}
      />
    </main>
  )
}

export default App
