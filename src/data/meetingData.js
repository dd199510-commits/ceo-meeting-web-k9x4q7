export const STORAGE_KEY = 'meeting-manager:optimized-demo:v1'
export const AI_STORAGE_KEY = 'meeting-manager:ai-scheduler:v1'
export const REVIEW_STORAGE_KEY = 'meeting-manager:review:v1'
export const LOG_STORAGE_KEY = 'meeting-manager:logs:v1'
export const DEFAULT_MEETING_PREFIX = '【常规会议】'

export const INITIAL_CONTACTS = [
  {
    id: 'c-robin',
    name: 'Robin',
    email: 'robin@example.com',
    aliases: ['罗宾'],
    secretaries: [
      {
        id: 'sec-robin-1',
        name: 'Robin 秘书',
        email: 'robin.assistant@example.com',
      },
    ],
    department: 'CEO Office',
    title: '',
    notes: '',
    status: 'active',
  },
  {
    id: 'c-alice',
    name: 'Alice',
    email: 'alice@example.com',
    aliases: ['Alice Zhang'],
    secretaries: [],
    department: '',
    title: '',
    notes: '',
    status: 'active',
  },
  {
    id: 'c-bob',
    name: 'Bob',
    email: '',
    aliases: [],
    secretaries: [],
    department: '',
    title: '',
    notes: '',
    status: 'active',
  },
]

export const FREQUENCY_LABELS = {
  weekly: '周会',
  monthly: '月会',
  yearly: '年会',
  adhoc: '不定期',
}

export const FREQUENCY_COLORS = {
  weekly: 'pill pill-blue',
  monthly: 'pill pill-green',
  yearly: 'pill pill-orange',
  adhoc: 'pill pill-gray',
}

export const WEEKDAYS = [
  { val: 1, label: '周一' },
  { val: 2, label: '周二' },
  { val: 3, label: '周三' },
  { val: 4, label: '周四' },
  { val: 5, label: '周五' },
  { val: 6, label: '周六' },
  { val: 0, label: '周日' },
]

export const MONTHS = [
  { val: 1, label: '1月' },
  { val: 2, label: '2月' },
  { val: 3, label: '3月' },
  { val: 4, label: '4月' },
  { val: 5, label: '5月' },
  { val: 6, label: '6月' },
  { val: 7, label: '7月' },
  { val: 8, label: '8月' },
  { val: 9, label: '9月' },
  { val: 10, label: '10月' },
  { val: 11, label: '11月' },
  { val: 12, label: '12月' },
]

export const INITIAL_MEETINGS = [
  {
    id: 'm1',
    name: 'CEO Office 周会',
    attendees: 'Robin\nAlice\nBob',
    duration: 60,
    frequency: {
      type: 'weekly',
      interval: 1,
      monthSpec: 1,
      daySpec: 1,
      anchorDate: '2026-03-05',
    },
    notes: '同步重点事项',
    attendeeRefs: [],
    extraInvitees: '',
    extraInviteeRefs: [],
    secretaryInviteContactIds: [],
    nextDate: '2026-03-12',
    history: ['2026-03-05'],
    status: 'active',
    customOrder: 0,
  },
  {
    id: 'm2',
    name: '产品月度复盘',
    attendees: '产品团队',
    duration: 90,
    frequency: {
      type: 'monthly',
      interval: 1,
      monthSpec: 1,
      daySpec: 20,
      anchorDate: '2026-02-20',
    },
    notes: '回顾关键指标与路线图',
    attendeeRefs: [],
    extraInvitees: '',
    extraInviteeRefs: [],
    secretaryInviteContactIds: [],
    nextDate: '2026-03-20',
    history: ['2026-02-20'],
    status: 'active',
    customOrder: 1,
  },
  {
    id: 'm3',
    name: '季度经营评审',
    attendees: '经营管理层',
    duration: 120,
    frequency: {
      type: 'yearly',
      interval: 1,
      monthSpec: [1, 4, 7, 10],
      daySpec: 10,
      anchorDate: '2026-01-10',
    },
    notes: '季度复盘与资源决策',
    attendeeRefs: [],
    extraInvitees: '',
    extraInviteeRefs: [],
    secretaryInviteContactIds: [],
    nextDate: '2026-04-10',
    history: ['2026-01-10'],
    status: 'active',
    customOrder: 2,
  },
]

export const INITIAL_SCHEDULED = [
  {
    id: 's1',
    meetingId: 'm1',
    name: 'CEO Office 周会',
    date: '2026-03-12',
    startTime: '09:00',
    endTime: '10:00',
    duration: 60,
    frequency: 'weekly',
  },
  {
    id: 's2',
    meetingId: 'm2',
    name: '产品月度复盘',
    date: '2026-03-20',
    startTime: '09:30',
    endTime: '11:00',
    duration: 90,
    frequency: 'monthly',
  },
  {
    id: 's3',
    meetingId: 'm3',
    name: '季度经营评审',
    date: '2026-03-20',
    startTime: '10:30',
    endTime: '12:30',
    duration: 120,
    frequency: 'yearly',
  },
]

export function createEmptyMeeting() {
  const today = new Date().toISOString().split('T')[0]

  return {
    id: '',
    meetingPrefix: DEFAULT_MEETING_PREFIX,
    name: '',
    attendees: '',
    duration: 60,
    frequency: {
      type: 'weekly',
      interval: 1,
      monthSpec: 1,
      daySpec: 1,
      anchorDate: today,
    },
    notes: '',
    noteMentions: [],
    attendeeRefs: [],
    extraInvitees: '',
    extraInviteeRefs: [],
    secretaryInviteContactIds: [],
    notificationTemplateKey: '',
    notificationConfig: {},
    nextDate: '',
    history: [],
    status: 'active',
    customOrder: 0,
  }
}

export function getMeetingFrequencyType(meeting) {
  return typeof meeting.frequency === 'string' ? meeting.frequency : meeting.frequency?.type || 'weekly'
}

export function getMeetingInterval(meeting) {
  if (typeof meeting.frequency === 'string') {
    return meeting.interval ?? 1
  }
  return meeting.frequency?.interval ?? 1
}

export function getMeetingYearlyMonthCount(meeting) {
  if (typeof meeting.frequency === 'string') {
    return meeting.yearlyMonthCount ?? 1
  }

  const monthSpec = meeting.frequency?.monthSpec
  if (Array.isArray(monthSpec)) return monthSpec.length
  return monthSpec ? 1 : 1
}

export function groupMeetingHistory(meeting) {
  const history = [...(meeting.history ?? [])].sort().reverse()
  const frequencyType = getMeetingFrequencyType(meeting)
  const useYearGrouping = frequencyType === 'monthly' || frequencyType === 'yearly'
  const groups = new Map()

  history.forEach((date) => {
    const [year, month, day] = date.split('-')
    const key = useYearGrouping ? year : `${year}-${month}`
    const label = useYearGrouping ? `${year}年` : `${year}年${month}月`
    const itemLabel = useYearGrouping ? `${month}-${day}` : `${day}日`

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label,
        items: [],
      })
    }

    groups.get(key).items.push({
      value: date,
      label: itemLabel,
    })
  })

  return Array.from(groups.values())
}

export function updateMeetingFrequency(meeting, patch) {
  const current =
    typeof meeting.frequency === 'string'
      ? {
          type: meeting.frequency,
          interval: meeting.interval ?? 1,
          monthSpec: meeting.yearlyMonthCount === 4 ? [1, 4, 7, 10] : 1,
          daySpec: 1,
          anchorDate: meeting.nextDate ?? '',
        }
      : meeting.frequency

  return {
    ...meeting,
    frequency: {
      ...current,
      ...patch,
    },
  }
}

export function normalizeMeeting(meeting) {
  const baseMeeting = {
    ...meeting,
    meetingPrefix: meeting.meetingPrefix ?? DEFAULT_MEETING_PREFIX,
    attendees: meeting.attendees ?? '',
    attendeeRefs: Array.isArray(meeting.attendeeRefs) ? meeting.attendeeRefs : [],
    extraInvitees: meeting.extraInvitees ?? '',
    extraInviteeRefs: Array.isArray(meeting.extraInviteeRefs) ? meeting.extraInviteeRefs : [],
    secretaryInviteContactIds: Array.isArray(meeting.secretaryInviteContactIds) ? meeting.secretaryInviteContactIds : [],
    noteMentions: Array.isArray(meeting.noteMentions) ? meeting.noteMentions : [],
    notificationTemplateKey: meeting.notificationTemplateKey ?? '',
    notificationConfig:
      meeting.notificationConfig && typeof meeting.notificationConfig === 'object'
        ? meeting.notificationConfig
        : {},
  }

  if (typeof meeting.frequency !== 'string') {
    return {
      ...baseMeeting,
      frequency: {
        interval: 1,
        monthSpec: 1,
        daySpec: 1,
        anchorDate: '',
        ...meeting.frequency,
      },
    }
  }

  return {
    ...baseMeeting,
    frequency: {
      type: meeting.frequency,
      interval: meeting.interval ?? 1,
      monthSpec:
        meeting.frequency === 'yearly'
          ? meeting.yearlyMonthCount === 4
            ? [1, 4, 7, 10]
            : meeting.yearlyMonthCount === 2
              ? [1, 7]
              : 1
          : 1,
      daySpec: 1,
      anchorDate: meeting.nextDate ?? '',
    },
  }
}
