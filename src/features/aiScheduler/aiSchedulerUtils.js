import { getMeetingFrequencyType } from '../../data/meetingData'
import { generateOccurrencesInRange } from '../../lib/meetingFrequency'

const SIMPLIFIED_DEFAULT_RULES = [
  '周会优先安排在周一上午',
  '月会优先安排在每月第一周',
  '同一天不超过3个会议',
  '会议之间至少间隔15分钟',
]

const LEGACY_DEFAULT_RULES = [
  [
    '基础出勤规则（含法定节假日）',
    '仅限工作日：严格遵循中国法定节假日安排。',
    '动态调整：遇“法定假”不排会；遇“调休补班日”视同正常工作日排程。',
    '时间槽与优先级管理：常规窗口 10:00 – 17:30；若常规时段全满，可提前至 08:30 开始。',
    '特殊日限制：周一默认 11:00 开始，极端情况 08:30 开始；周四除非当周其他时段完全无法覆盖，否则不排会；周五原则上在 16:00 前结束，实在排不开可安排到 16:30。',
    '会议负荷与灵活性：每日会议总数不超过 6 个；周会可在当周内前后平移 1 天，两周一次的会议可在周内前后平移 2 天；月会可在当月内前后平移 3 天。',
    '间隙与缓冲规则：一般会议无须留隙，直接连续安排；45 分钟会议结束后强制预留 15 分钟缓冲。',
    '要注意一周的会议安排均衡，比如不能一天有 1 小时、一天有 6 小时，尽量保证安排会的那天能有 4 小时会议。',
    '不用每个工作日都安排会，优先周二周三，然后周一、周五，最后周四。若周二周三已覆盖当周会议，就不用额外安排周一和周五。',
    '下午会议需在 13:00 开始。12:00–13:00 的午餐时间已经包含休息时间，不要再额外预留休息时间。',
  ].join(' '),
]

export const DEFAULT_AI_STATE = {
  inputMeetings: null,
  exportBatch: null,
  settings: {
    provider: 'gemini',
    model: 'gemini-3.1-pro-preview',
    autoImportResult: true,
    autoImportToReview: false,
    lastImportedJobId: '',
  },
  preferences: {
    avoidTimeSlots: [{ start: '12:00', end: '13:00', reason: '午饭时间' }],
    rules: LEGACY_DEFAULT_RULES,
  },
  scheduledMeetings: null,
}

function isSimplifiedDefaultPreferences(preferences = {}) {
  const rules = Array.isArray(preferences.rules) ? preferences.rules : []
  const slots = Array.isArray(preferences.avoidTimeSlots) ? preferences.avoidTimeSlots : []

  return (
    rules.length === SIMPLIFIED_DEFAULT_RULES.length &&
    rules.every((rule, index) => rule === SIMPLIFIED_DEFAULT_RULES[index]) &&
    slots.length === 1 &&
    slots[0]?.start === '12:00' &&
    slots[0]?.end === '13:30'
  )
}

function formatReferenceReplacement(mappedTaskIds) {
  if (Array.isArray(mappedTaskIds)) {
    const normalizedTaskIds = mappedTaskIds.filter(Boolean)
    if (normalizedTaskIds.length === 0) return '@关联会议'
    if (normalizedTaskIds.length === 1) return `@${normalizedTaskIds[0]}`
    return normalizedTaskIds.map((taskId) => `@${taskId}`).join('、')
  }

  return mappedTaskIds ? `@${mappedTaskIds}` : '@关联会议'
}

function buildReferenceMeetingMap(inputMeetings, exportBatch = null, sourceMeetings = []) {
  const scheduledMeetingIds = new Set(
    Array.isArray(exportBatch?.taskMap)
      ? exportBatch.taskMap.map((item) => item.meetingId).filter(Boolean)
      : [],
  )
  const sourceMeetingMap = new Map(
    (Array.isArray(sourceMeetings) ? sourceMeetings : []).map((meeting) => [meeting.id, meeting]),
  )
  const referenceMeetings = new Map()

  ;(Array.isArray(inputMeetings?.meetings) ? inputMeetings.meetings : []).forEach((meeting) => {
    ;(Array.isArray(meeting.noteMentions) ? meeting.noteMentions : []).forEach((mention) => {
      if (!mention?.meetingId || scheduledMeetingIds.has(mention.meetingId)) {
        return
      }

      if (!referenceMeetings.has(mention.meetingId)) {
        const referencedMeeting = sourceMeetingMap.get(mention.meetingId)
        const occurrenceDates =
          referencedMeeting && inputMeetings?.timeRange
            ? generateOccurrencesInRange(
                referencedMeeting,
                inputMeetings.timeRange.start,
                inputMeetings.timeRange.end,
              )
            : []

        referenceMeetings.set(mention.meetingId, {
          meetingId: mention.meetingId,
          label: mention.label || mention.meetingId,
          frequency: referencedMeeting ? getMeetingFrequencyType(referencedMeeting) : 'linked',
          occurrenceDates,
        })
      }
    })
  })

  return referenceMeetings
}

function buildReferenceIdMap(referenceMeetings = new Map()) {
  const sortedMeetings = Array.from(referenceMeetings.values()).sort((left, right) =>
    left.label.localeCompare(right.label, 'zh-CN'),
  )
  return new Map(
    sortedMeetings.map((meeting, index) => [
      meeting.meetingId,
      `R-${String(index + 1).padStart(3, '0')}`,
    ]),
  )
}

function replaceMeetingReferences(
  notes,
  noteMentions = [],
  referenceMap = new Map(),
  referenceMeetingIdMap = new Map(),
) {
  if (!notes) return ''

  let sanitizedNotes = notes
  const mentions = Array.isArray(noteMentions) ? noteMentions.filter(Boolean) : []

  mentions
    .filter((mention) => mention?.label && mention?.meetingId)
    .sort((left, right) => right.label.length - left.label.length)
    .forEach((mention) => {
      const mappedTaskId = referenceMap.get(mention.meetingId)
      const mappedReferenceId = referenceMeetingIdMap.get(mention.meetingId)
      const replacement = mappedReferenceId
        ? `@${mappedReferenceId}`
        : formatReferenceReplacement(mappedTaskId)
      sanitizedNotes = sanitizedNotes.replaceAll(`@${mention.label}`, replacement)
    })

  return sanitizedNotes.replace(/@([A-Za-z0-9_\-\u4e00-\u9fa5]+)/g, (match, label) => {
    const normalized = label.trim()
    if (/^(M|R)-\d{3}$/.test(normalized)) {
      return match
    }
    const mappedTaskId = referenceMap.get(normalized)
    return formatReferenceReplacement(mappedTaskId)
  })
}

export function buildExportBatch(inputMeetings, previousBatch = null) {
  const meetings = Array.isArray(inputMeetings?.meetings) ? inputMeetings.meetings : []
  const previousEntries = new Map(
    Array.isArray(previousBatch?.taskMap)
      ? previousBatch.taskMap.map((item) => [item.instanceId, item])
      : [],
  )
  const usedTaskIds = new Set()

  const taskMap = meetings.map((meeting, index) => {
    const existing = previousEntries.get(meeting.id)
    const fallbackTaskId = `M-${String(index + 1).padStart(3, '0')}`
    let taskId = existing?.taskId ?? fallbackTaskId

    if (usedTaskIds.has(taskId)) {
      let sequence = index + 1
      while (usedTaskIds.has(`M-${String(sequence).padStart(3, '0')}`)) {
        sequence += 1
      }
      taskId = `M-${String(sequence).padStart(3, '0')}`
    }

    usedTaskIds.add(taskId)

    return {
      taskId,
      instanceId: meeting.id,
      meetingId: meeting.meetingId ?? meeting.sourceMeetingId ?? '',
      date: meeting.date,
    }
  })

  return {
    batchId: previousBatch?.batchId ?? `batch_${Date.now()}`,
    createdAt: previousBatch?.createdAt ?? new Date().toISOString(),
    taskMap,
  }
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

export function redactSensitiveForAI(value) {
  return String(value || '').replace(EMAIL_PATTERN, '[已脱敏邮箱]')
}

export function sanitizeAiInputMeetings(inputMeetings) {
  if (!inputMeetings || typeof inputMeetings !== 'object') return inputMeetings

  return {
    ...inputMeetings,
    meetings: Array.isArray(inputMeetings.meetings)
      ? inputMeetings.meetings.map((meeting) => ({
          id: meeting.id,
          meetingId: meeting.meetingId,
          name: redactSensitiveForAI(meeting.name),
          date: meeting.date,
          duration: meeting.duration,
          attendees: redactSensitiveForAI(meeting.attendees),
          notes: redactSensitiveForAI(meeting.notes),
          noteMentions: meeting.noteMentions ?? [],
          frequency: meeting.frequency,
          sourceMeetingId: meeting.sourceMeetingId,
          sourceFrequency: meeting.sourceFrequency,
          sourceAnchorDate: meeting.sourceAnchorDate,
        }))
      : [],
    metadata: inputMeetings.metadata,
  }
}

export function readAiState(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return DEFAULT_AI_STATE

    return normalizeAiState(JSON.parse(raw))
  } catch {
    return DEFAULT_AI_STATE
  }
}

export function normalizeAiState(input) {
  if (!input || typeof input !== 'object') {
    return DEFAULT_AI_STATE
  }

  const shouldRestoreLegacyDefaults = isSimplifiedDefaultPreferences(input.preferences)

  return {
    ...DEFAULT_AI_STATE,
    ...input,
    settings: {
      ...DEFAULT_AI_STATE.settings,
      ...(input.settings ?? {}),
    },
    exportBatch:
      input.exportBatch && typeof input.exportBatch === 'object'
        ? {
            batchId: input.exportBatch.batchId ?? '',
            createdAt: input.exportBatch.createdAt ?? '',
            taskMap: Array.isArray(input.exportBatch.taskMap) ? input.exportBatch.taskMap : [],
          }
        : null,
    preferences: {
      ...DEFAULT_AI_STATE.preferences,
      ...(shouldRestoreLegacyDefaults ? {} : (input.preferences ?? {})),
      avoidTimeSlots: shouldRestoreLegacyDefaults
        ? DEFAULT_AI_STATE.preferences.avoidTimeSlots
        : Array.isArray(input.preferences?.avoidTimeSlots)
        ? input.preferences.avoidTimeSlots
        : DEFAULT_AI_STATE.preferences.avoidTimeSlots,
      rules: shouldRestoreLegacyDefaults
        ? DEFAULT_AI_STATE.preferences.rules
        : Array.isArray(input.preferences?.rules)
        ? input.preferences.rules
        : DEFAULT_AI_STATE.preferences.rules,
    },
  }
}

export function persistAiState(storageKey, data) {
  window.localStorage.setItem(storageKey, JSON.stringify(data))
}

export function optimizeInputForAI(inputMeetings, exportBatch = null, sourceMeetings = []) {
  const safeInputMeetings = sanitizeAiInputMeetings(inputMeetings)
  const instanceTaskMap = new Map(
    Array.isArray(exportBatch?.taskMap)
      ? exportBatch.taskMap.map((item) => [item.instanceId, item.taskId])
      : [],
  )
  const meetingTaskMap = new Map()
  if (Array.isArray(exportBatch?.taskMap)) {
    exportBatch.taskMap
      .filter((item) => item.meetingId && item.taskId)
      .forEach((item) => {
        const existingTaskIds = meetingTaskMap.get(item.meetingId) ?? []
        meetingTaskMap.set(item.meetingId, [...existingTaskIds, item.taskId])
      })
  }
  const referenceMeetingsMap = buildReferenceMeetingMap(safeInputMeetings, exportBatch, sourceMeetings)
  const referenceIdMap = buildReferenceIdMap(referenceMeetingsMap)

  return {
    timeRange: safeInputMeetings.timeRange,
    meetings: safeInputMeetings.meetings.map((meeting) => ({
      taskId: instanceTaskMap.get(meeting.id) ?? meeting.id,
      date: meeting.date,
      duration: meeting.duration,
      frequency: meeting.frequency,
      sourceFrequency: meeting.sourceFrequency ?? null,
      sourceAnchorDate: meeting.sourceAnchorDate ?? '',
      notes: replaceMeetingReferences(
        meeting.notes ? redactSensitiveForAI(meeting.notes).slice(0, 100) : '',
        meeting.noteMentions,
        meetingTaskMap,
        referenceIdMap,
      ),
    })),
    referenceMeetings: Array.from(referenceMeetingsMap.values()).map((meeting) => ({
      referenceId: referenceIdMap.get(meeting.meetingId),
      frequency: meeting.frequency ?? 'linked',
      occurrenceDates: Array.isArray(meeting.occurrenceDates) ? meeting.occurrenceDates : [],
      note:
        Array.isArray(meeting.occurrenceDates) && meeting.occurrenceDates.length > 0
          ? '该引用会议未纳入本次待排程清单，但在当前排程范围内仍有发生日期，备注约束需结合 occurrenceDates 判断。'
          : '该引用会议未纳入本次待排程清单，且当前排程范围内未检测到发生日期；只有在规则明确要求时才应据此取消其他会议。',
    })),
  }
}

export function buildAIPrompt(inputMeetings, preferences, exportBatch = null, sourceMeetings = []) {
  const optimizedInput = optimizeInputForAI(inputMeetings, exportBatch, sourceMeetings)
  const safePreferences = {
    ...preferences,
    avoidTimeSlots: (preferences.avoidTimeSlots ?? []).map((slot) => ({
      ...slot,
      reason: redactSensitiveForAI(slot.reason),
    })),
    rules: (preferences.rules ?? []).map(redactSensitiveForAI),
  }

  return redactSensitiveForAI(`你是一个专业的会议排程助手。请根据输入的会议列表和约束，输出严格可解析的 JSON。

输入会议:
${JSON.stringify(optimizedInput, null, 2)}

避免时段:
${safePreferences.avoidTimeSlots.map((slot) => `- ${slot.start}-${slot.end} (${slot.reason || '无'})`).join('\n')}

排程规则:
${safePreferences.rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}

输出格式:
{
  "scheduledMeetings": [
    {
      "taskId": "保持原任务 ID",
      "date": "YYYY-MM-DD",
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "duration": 60,
      "frequency": "weekly/monthly/yearly/adhoc",
      "notes": "原备注",
      "aiReason": "排程理由"
    }
  ],
  "unscheduledMeetings": [
    {
      "taskId": "未能成功排程的任务 ID",
      "reason": "未排原因，必须写明具体原因；如果确实无法判断，填写“无”",
      "type": "可选：note_constraint/time_conflict/rule_conflict/manual_skip/unknown"
    }
  ],
  "summary": {
    "unscheduledMeetings": 0
  }
}

要求:
1. 任何未成功排程的会议，都必须同时写入 "unscheduledMeetings"。
2. "unscheduledMeetings" 里的每一项都必须填写 "reason"，不能省略；如果无法判断，也要写 "无"。
3. 如果未排原因涉及其他任务，请直接在 reason 中引用对应 taskId；如果涉及未纳入本批次但在备注中被引用的会议，请引用对应的 referenceId（R-xxx）。
4. "summary.unscheduledMeetings" 必须与 "unscheduledMeetings" 数组长度一致。
5. 输入中如果存在 "referenceMeetings"，表示这些会议虽然不在本次待排程清单里，但它们代表备注里提到的关联会议约束，排程时必须考虑。
6. 对于 referenceMeetings，必须结合 occurrenceDates 判断它在当前排程范围内是否实际发生；如果 occurrenceDates 为空，不能默认视为“当月已发生”或“本周已发生”。

不要输出 markdown，不要解释，只返回 JSON。`)
}

export function validateImportedInput(text) {
  const parsed = JSON.parse(text)

  if (!parsed.timeRange || !parsed.meetings || !Array.isArray(parsed.meetings)) {
    throw new Error('JSON 缺少 timeRange 或 meetings 字段')
  }

  parsed.meetings = parsed.meetings.map((meeting) => ({
    ...meeting,
    sourceFrequency: meeting.sourceFrequency ?? null,
    sourceAnchorDate: meeting.sourceAnchorDate ?? '',
    attendees: meeting.attendees ?? '',
  }))

  return parsed
}

export function validateImportedSchedule(text) {
  const parsed = JSON.parse(text)

  if (!parsed.scheduledMeetings || !Array.isArray(parsed.scheduledMeetings)) {
    throw new Error('JSON 缺少 scheduledMeetings 字段')
  }

  parsed.scheduledMeetings = parsed.scheduledMeetings.map((meeting) => ({
    ...meeting,
    taskId: meeting.taskId ?? meeting.id ?? '',
    meetingId: meeting.meetingId ?? '',
    sourceFrequency: meeting.sourceFrequency ?? null,
    sourceAnchorDate: meeting.sourceAnchorDate ?? '',
    attendees: meeting.attendees ?? '',
  }))

  parsed.unscheduledMeetings = Array.isArray(parsed.unscheduledMeetings)
    ? parsed.unscheduledMeetings.map((item) => ({
        ...item,
        taskId: item.taskId ?? item.id ?? '',
        reason: item.reason ?? '无',
        type: item.type ?? '',
      }))
    : []

  parsed.summary =
    parsed.summary && typeof parsed.summary === 'object'
      ? {
          ...parsed.summary,
          unscheduledMeetings:
            parsed.summary.unscheduledMeetings ?? parsed.unscheduledMeetings.length,
        }
      : {
          unscheduledMeetings: parsed.unscheduledMeetings.length,
        }

  return parsed
}

export function detectAIScheduleConflicts(scheduledMeetings) {
  const conflicts = []
  const byDate = new Map()

  scheduledMeetings.forEach((meeting) => {
    const current = byDate.get(meeting.date) ?? []
    current.push(meeting)
    byDate.set(meeting.date, current)
  })

  for (const [date, list] of byDate.entries()) {
    const sorted = [...list].sort((a, b) => a.startTime.localeCompare(b.startTime))
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const current = sorted[index]
      const next = sorted[index + 1]
      if (current.endTime > next.startTime) {
        conflicts.push({
          id: `${current.id}-${next.id}`,
          date,
          description: `${current.name} 与 ${next.name} 时间重叠`,
          meetingIds: [current.id, next.id],
        })
      }
    }
  }

  return conflicts
}
