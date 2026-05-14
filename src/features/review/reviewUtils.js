export const DEFAULT_REVIEW_STATE = {
  scheduledMeetings: [],
  source: '',
  importedAt: '',
  sourceInputMeetings: null,
  aiConflicts: [],
  aiSummary: null,
  finalCheckStatus: {},
  reserveNoticeStatus: {},
}

function replaceTaskIdsWithMeetingNames(text, taskNameMap) {
  if (!text) return ''

  return text.replace(/\bM-\d{3}\b/g, (taskId) => taskNameMap.get(taskId) ?? taskId)
}

export function readReviewState(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? normalizeReviewState(JSON.parse(raw)) : DEFAULT_REVIEW_STATE
  } catch {
    return DEFAULT_REVIEW_STATE
  }
}

export function persistReviewState(storageKey, data) {
  window.localStorage.setItem(storageKey, JSON.stringify(data))
}

export function normalizeReviewState(input) {
  if (!input || typeof input !== 'object') {
    return DEFAULT_REVIEW_STATE
  }

  const meetings = Array.isArray(input.scheduledMeetings) ? input.scheduledMeetings : []

  return {
    scheduledMeetings: meetings.map((meeting) => ({
      ...meeting,
      locked: Boolean(meeting.locked),
      reserved: Boolean(meeting.reserved),
      sourceFrequency: meeting.sourceFrequency ?? null,
      sourceAnchorDate: meeting.sourceAnchorDate ?? '',
      meetingId: meeting.meetingId ?? '',
    })),
    source: input.source ?? '',
    importedAt: input.importedAt ?? new Date().toISOString(),
    sourceInputMeetings: input.sourceInputMeetings ?? null,
    aiConflicts: Array.isArray(input.aiConflicts) ? input.aiConflicts : [],
    aiSummary: input.aiSummary ?? null,
    finalCheckStatus:
      input.finalCheckStatus && typeof input.finalCheckStatus === 'object'
        ? input.finalCheckStatus
        : {},
    reserveNoticeStatus:
      input.reserveNoticeStatus && typeof input.reserveNoticeStatus === 'object'
        ? input.reserveNoticeStatus
        : {},
  }
}

function hydrateAiScheduledMeetings(aiState) {
  const scheduledMeetings = aiState.scheduledMeetings.scheduledMeetings
  const taskToInstance = new Map(
    Array.isArray(aiState.exportBatch?.taskMap)
      ? aiState.exportBatch.taskMap.map((item) => [item.taskId, item.instanceId])
      : [],
  )
  const inputMeetingMap = new Map(
    Array.isArray(aiState.inputMeetings?.meetings)
      ? aiState.inputMeetings.meetings.map((meeting) => [meeting.id, meeting])
      : [],
  )

  return scheduledMeetings.map((meeting, index) => {
    const instanceId = taskToInstance.get(meeting.taskId)
    const sourceMeeting = instanceId ? inputMeetingMap.get(instanceId) : null

    return {
      ...sourceMeeting,
      ...meeting,
      id: meeting.id ?? sourceMeeting?.id ?? `scheduled-${index + 1}`,
      taskId: meeting.taskId ?? '',
      meetingId: sourceMeeting?.meetingId ?? sourceMeeting?.sourceMeetingId ?? meeting.meetingId ?? '',
      name: sourceMeeting?.name ?? meeting.name ?? `任务 ${meeting.taskId || index + 1}`,
      attendees: sourceMeeting?.attendees ?? meeting.attendees ?? '',
      notes: sourceMeeting?.notes ?? meeting.notes ?? '',
      noteMentions: sourceMeeting?.noteMentions ?? meeting.noteMentions ?? [],
      sourceFrequency: sourceMeeting?.sourceFrequency ?? meeting.sourceFrequency ?? null,
      sourceAnchorDate: sourceMeeting?.sourceAnchorDate ?? meeting.sourceAnchorDate ?? '',
    }
  })
}

export function importAiScheduleToReview(aiState) {
  if (!aiState?.scheduledMeetings?.scheduledMeetings) {
    return DEFAULT_REVIEW_STATE
  }

  const hydratedMeetings = hydrateAiScheduledMeetings(aiState).map((meeting) => ({
    ...meeting,
    locked: false,
    reserved: false,
    sourceFrequency: meeting.sourceFrequency ?? null,
    sourceAnchorDate: meeting.sourceAnchorDate ?? '',
    meetingId: meeting.meetingId ?? '',
  }))
  const taskNameMap = new Map(
    hydratedMeetings
      .filter((meeting) => meeting.taskId && meeting.name)
      .map((meeting) => [meeting.taskId, meeting.name]),
  )
  const normalizedAiConflicts = Array.isArray(aiState.scheduledMeetings.conflicts)
    ? aiState.scheduledMeetings.conflicts.map((item) => {
        const affectedMeetings = Array.isArray(item.affectedMeetings) ? item.affectedMeetings : []
        const affectedMeetingNames = affectedMeetings.map(
          (taskId) => taskNameMap.get(taskId) ?? taskId,
        )

        return {
          ...item,
          affectedMeetings,
          affectedMeetingNames,
          description: replaceTaskIdsWithMeetingNames(item.description ?? '', taskNameMap),
        }
      })
    : []

  const exportedMeetingsByInstanceId = new Map(
    Array.isArray(aiState.inputMeetings?.meetings)
      ? aiState.inputMeetings.meetings.map((meeting) => [meeting.id, meeting])
      : [],
  )
  const scheduledTaskIds = new Set(
    hydratedMeetings.map((meeting) => meeting.taskId).filter(Boolean),
  )
  const unscheduledMeetings = Array.isArray(aiState.exportBatch?.taskMap)
    ? aiState.exportBatch.taskMap
        .filter((item) => item.taskId && !scheduledTaskIds.has(item.taskId))
        .map((item) => {
          const sourceMeeting = exportedMeetingsByInstanceId.get(item.instanceId)
          return {
            taskId: item.taskId,
            instanceId: item.instanceId,
            meetingId: item.meetingId,
            name: sourceMeeting?.name ?? item.taskId,
            date: sourceMeeting?.date ?? '',
          }
        })
    : []

  const importedSummary = aiState.scheduledMeetings.summary ?? null
  const importedUnscheduled = Array.isArray(aiState.scheduledMeetings.unscheduledMeetings)
    ? aiState.scheduledMeetings.unscheduledMeetings
    : []
  const importedUnscheduledReasonMap = new Map(
    importedUnscheduled
      .filter((item) => item?.taskId)
      .map((item) => [
        item.taskId,
        {
          reason: replaceTaskIdsWithMeetingNames(item.reason ?? '', taskNameMap) || '无',
          type: item.type ?? '',
        },
      ]),
  )
  const normalizedUnscheduledMeetings = unscheduledMeetings.map((meeting) => {
    const imported = importedUnscheduledReasonMap.get(meeting.taskId)
    return {
      ...meeting,
      reason: imported?.reason || '无',
      type: imported?.type || '',
    }
  })

  return {
    scheduledMeetings: hydratedMeetings,
    source: 'ai-scheduler',
    importedAt: new Date().toISOString(),
    sourceInputMeetings: aiState.inputMeetings ?? null,
    aiConflicts: normalizedAiConflicts,
    aiSummary: {
      ...(importedSummary ?? {}),
      unscheduledMeetings:
        importedSummary?.unscheduledMeetings ?? normalizedUnscheduledMeetings.length,
      unscheduledMeetingNames: normalizedUnscheduledMeetings.map((meeting) => meeting.name),
      unscheduledMeetingDetails: normalizedUnscheduledMeetings,
    },
    finalCheckStatus: {},
    reserveNoticeStatus: {},
  }
}
