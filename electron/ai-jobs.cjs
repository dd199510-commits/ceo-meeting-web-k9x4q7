const { ipcMain } = require('electron')
const crypto = require('crypto')
const { JobStore } = require('./job-store.cjs')
const { OpenAIClient, normalizeErrorMessage } = require('./openai-client.cjs')
const { GeminiClient, normalizeProviderError } = require('./gemini-client.cjs')
const { DeepSeekClient, normalizeDeepSeekError } = require('./deepseek-client.cjs')

const ACTIVE_STATUSES = new Set(['queued', 'submitting', 'submitted', 'polling', 'in_progress', 'retry_wait'])
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'expired', 'deleted'])

const MEETING_SCHEDULE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scheduledMeetings', 'unscheduledMeetings', 'summary'],
  properties: {
    scheduledMeetings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['taskId', 'date', 'startTime', 'endTime', 'duration', 'frequency', 'aiReason'],
        properties: {
          taskId: { type: 'string' },
          date: { type: 'string' },
          startTime: { type: 'string' },
          endTime: { type: 'string' },
          duration: { type: 'number' },
          frequency: { type: 'string' },
          notes: { type: 'string' },
          aiReason: { type: 'string' },
        },
      },
    },
    unscheduledMeetings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['taskId', 'reason'],
        properties: {
          taskId: { type: 'string' },
          reason: { type: 'string' },
          type: { type: 'string' },
        },
      },
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['unscheduledMeetings'],
      properties: {
        unscheduledMeetings: { type: 'number' },
      },
    },
  },
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

function redactSensitiveForExternalModel(value) {
  return String(value || '').replace(EMAIL_PATTERN, '[已脱敏邮箱]')
}

function redactSensitivePayload(value) {
  if (typeof value === 'string') {
    return redactSensitiveForExternalModel(value)
  }
  if (Array.isArray(value)) {
    return value.map(redactSensitivePayload)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['contacts', 'attendeeRefs', 'extraInviteeRefs'].includes(key))
        .map(([key, item]) => [key, redactSensitivePayload(item)]),
    )
  }
  return value
}

function toIsoNow() {
  return new Date().toISOString()
}

function createJobId() {
  return `job_${Date.now()}_${crypto.randomUUID()}`
}

function createImportedJobId() {
  return `imported_${Date.now()}_${crypto.randomUUID()}`
}

function sanitizeJob(job) {
  if (!job) return null

  return {
    id: job.id,
    batchId: job.batchId,
    planningTaskId: job.planningTaskId ?? job.requestSnapshot?.planningTaskId ?? '',
    provider: job.provider ?? 'openai',
    model: job.model,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    responseId: job.responseId ?? '',
    lastError: job.lastError ?? '',
    attemptCount: job.attemptCount ?? 0,
    promptVersion: job.promptVersion ?? 'v1',
    result: job.result ?? null,
    resultSummary: job.result?.summary ?? null,
    inputMeetings: job.requestSnapshot?.inputMeetings ?? null,
    exportBatch: job.requestSnapshot?.exportBatch ?? null,
    progress: job.progress ?? null,
  }
}

function getPollDelayMs(job) {
  const startedAt = new Date(job.createdAt || 0).getTime()
  const elapsedMs = Date.now() - startedAt

  if (elapsedMs < 60_000) return 5_000
  if (elapsedMs < 5 * 60_000) return 10_000
  return 20_000
}

function extractResponseText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text
  }

  if (!Array.isArray(response.output)) {
    return ''
  }

  const chunks = []

  response.output.forEach((item) => {
    if (!Array.isArray(item.content)) return
    item.content.forEach((contentItem) => {
      if (typeof contentItem.text === 'string') {
        chunks.push(contentItem.text)
      }
      if (typeof contentItem.output_text === 'string') {
        chunks.push(contentItem.output_text)
      }
    })
  })

  return chunks.join('\n').trim()
}

function extractDeepSeekResponseText(response) {
  return response?.choices?.[0]?.message?.content?.trim() || ''
}

function createProgressSnapshot(message, patch = {}) {
  const now = toIsoNow()
  return {
    phase: patch.phase ?? 'running',
    lastMessage: message,
    lastActivityAt: now,
    chunkCount: Number(patch.chunkCount ?? 0),
    contentChunkCount: Number(patch.contentChunkCount ?? 0),
    reasoningChunkCount: Number(patch.reasoningChunkCount ?? 0),
    byteCount: Number(patch.byteCount ?? 0),
    events: [{ at: now, message }],
  }
}

function appendProgressEvent(progress, message, patch = {}) {
  const now = toIsoNow()
  const previous = progress ?? createProgressSnapshot(message)
  const events = Array.isArray(previous.events) ? previous.events : []

  return {
    ...previous,
    ...patch,
    lastMessage: message,
    lastActivityAt: now,
    events: [
      ...events.slice(-7),
      {
        at: now,
        message,
      },
    ],
  }
}

function createAiJobService(app, configStore) {
  const store = new JobStore(app)
  const timers = new Map()

  function getClient(provider = 'openai') {
    if (provider === 'gemini') {
      return new GeminiClient({
        apiKey: configStore.readApiKey('gemini') || process.env.GEMINI_API_KEY || '',
      })
    }

    if (provider === 'deepseek') {
      return new DeepSeekClient({
        apiKey: configStore.readApiKey('deepseek') || process.env.DEEPSEEK_API_KEY || '',
      })
    }

    return new OpenAIClient({
      apiKey: configStore.readApiKey('openai') || process.env.OPENAI_API_KEY || '',
    })
  }

  function persistJob(job) {
    const currentJob = store.getRawJob(job.id)
    if (currentJob?.status === 'deleted') {
      return currentJob
    }

    const nextJob = {
      ...job,
      updatedAt: toIsoNow(),
    }
    store.upsertJob(nextJob)
    return nextJob
  }

  function createJobProgressReporter(jobId, providerLabel) {
    let chunkCount = 0
    let contentChunkCount = 0
    let reasoningChunkCount = 0
    let byteCount = 0
    let lastPersistedAt = 0

    return (chunk = {}) => {
      const text = String(chunk.text || '')
      chunkCount += 1
      byteCount += Buffer.byteLength(text, 'utf8')
      if (chunk.kind === 'reasoning') {
        reasoningChunkCount += 1
      } else {
        contentChunkCount += 1
      }

      const now = Date.now()
      if (now - lastPersistedAt < 1500 && chunkCount % 12 !== 0) {
        return
      }

      lastPersistedAt = now
      const currentJob = store.getJob(jobId)
      if (!currentJob || TERMINAL_STATUSES.has(currentJob.status)) return

      const message =
        chunk.kind === 'reasoning'
          ? `${providerLabel} 正在推理，已收到 ${reasoningChunkCount} 个推理片段。`
          : `${providerLabel} 正在生成结果，已收到 ${contentChunkCount} 个结果片段。`

      persistJob({
        ...currentJob,
        progress: appendProgressEvent(currentJob.progress, message, {
          phase: chunk.kind === 'reasoning' ? 'reasoning_streaming' : 'content_streaming',
          chunkCount,
          contentChunkCount,
          reasoningChunkCount,
          byteCount,
        }),
      })
    }
  }

  function schedulePoll(jobId, delayMs) {
    if (timers.has(jobId)) {
      clearTimeout(timers.get(jobId))
    }

    const timer = setTimeout(() => {
      timers.delete(jobId)
      pollJob(jobId).catch(() => {})
    }, delayMs)

    timers.set(jobId, timer)
  }

  async function submitJob(payload) {
    const createdAt = toIsoNow()
    const provider = payload.provider === 'gemini' ? 'gemini' : payload.provider === 'deepseek' ? 'deepseek' : 'openai'
    const safePrompt = redactSensitiveForExternalModel(payload.prompt)
    const safeInputMeetings = redactSensitivePayload(payload.inputMeetings)
    const safePreferences = redactSensitivePayload(payload.preferences)
    const draftJob = persistJob({
      id: createJobId(),
      batchId: payload.batchId,
      planningTaskId: payload.planningTaskId || '',
      provider,
      model:
        payload.model ||
        (provider === 'gemini'
          ? 'gemini-3-pro-preview'
          : provider === 'deepseek'
            ? 'deepseek-v4-pro'
            : 'gpt-5.4'),
      status: 'submitting',
      createdAt,
      updatedAt: createdAt,
      attemptCount: 1,
      promptVersion: payload.promptVersion || 'v1',
      requestSnapshot: {
        prompt: safePrompt,
        inputMeetings: safeInputMeetings,
        preferences: safePreferences,
        exportBatch: payload.exportBatch,
        planningTaskId: payload.planningTaskId || '',
      },
      responseId: '',
      lastError: '',
      progress: createProgressSnapshot('已写入本地方案队列，准备提交模型。', { phase: 'queued' }),
      result: null,
    })

    try {
      if (provider === 'gemini') {
        const submittedJob = persistJob({
          ...draftJob,
          status: 'in_progress',
          responseId: `gemini-local-${draftJob.id}`,
          progress: appendProgressEvent(draftJob.progress, 'Gemini 请求已发出，等待流式响应。', { phase: 'request_sent' }),
        })

        processGeminiJob(submittedJob.id).catch(() => {})
        return sanitizeJob(submittedJob)
      }

      if (provider === 'deepseek') {
        const submittedJob = persistJob({
          ...draftJob,
          status: 'in_progress',
          responseId: `deepseek-local-${draftJob.id}`,
          progress: appendProgressEvent(draftJob.progress, 'DeepSeek 请求已发出，等待流式响应。', { phase: 'request_sent' }),
        })

        processDeepSeekJob(submittedJob.id).catch(() => {})
        return sanitizeJob(submittedJob)
      }

      const response = await getClient(provider).createBackgroundResponse({
        model: draftJob.model,
        background: true,
        store: true,
        input: draftJob.requestSnapshot.prompt,
        text: {
          format: {
            type: 'json_schema',
            name: 'meeting_schedule_result',
            strict: true,
            schema: MEETING_SCHEDULE_SCHEMA,
          },
        },
        metadata: {
          app: 'meeting-manager',
          batchId: draftJob.batchId,
          jobId: draftJob.id,
        },
      })

      const submittedJob = persistJob({
        ...draftJob,
        responseId: response.id,
        status: response.status || 'submitted',
      })

      schedulePoll(submittedJob.id, getPollDelayMs(submittedJob))
      return sanitizeJob(submittedJob)
    } catch (error) {
      const failedJob = persistJob({
        ...draftJob,
        status: 'failed',
        lastError:
          provider === 'gemini'
            ? normalizeProviderError(error)
            : provider === 'deepseek'
              ? normalizeDeepSeekError(error)
            : normalizeErrorMessage(error),
      })
      return sanitizeJob(failedJob)
    }
  }

  async function processGeminiJob(jobId) {
    const currentJob = store.getJob(jobId)
    if (!currentJob || currentJob.provider !== 'gemini' || TERMINAL_STATUSES.has(currentJob.status)) {
      return sanitizeJob(currentJob)
    }

    try {
      persistJob({
        ...currentJob,
        progress: appendProgressEvent(currentJob.progress, 'Gemini 已开始处理请求。', { phase: 'started' }),
      })

      const geminiClient = getClient('gemini')
      let response

      try {
        response = await geminiClient.streamStructuredContent({
          model: currentJob.model,
          prompt: currentJob.requestSnapshot.prompt,
          schema: MEETING_SCHEDULE_SCHEMA,
          onChunk: createJobProgressReporter(jobId, 'Gemini'),
        })
      } catch (streamError) {
        if (![400, 404].includes(streamError?.status)) {
          throw streamError
        }
        const latestJob = store.getJob(jobId) ?? currentJob
        persistJob({
          ...latestJob,
          progress: appendProgressEvent(latestJob.progress, 'Gemini 流式响应不可用，已切换为普通等待模式。', {
            phase: 'non_streaming_fallback',
          }),
        })
        response = await geminiClient.generateStructuredContent({
          model: currentJob.model,
          prompt: currentJob.requestSnapshot.prompt,
          schema: MEETING_SCHEDULE_SCHEMA,
        })
      }

      const responseText =
        response.candidates?.[0]?.content?.parts
          ?.map((part) => part.text || '')
          .join('\n')
          .trim() || ''

      if (!responseText) {
        const candidate = response.candidates?.[0] ?? null
        const finishReason = candidate?.finishReason ? `finishReason=${candidate.finishReason}` : ''
        const promptFeedback = response.promptFeedback
          ? `promptFeedback=${JSON.stringify(response.promptFeedback)}`
          : ''
        throw new Error(
          ['Gemini 未返回可解析的文本内容。', finishReason, promptFeedback]
            .filter(Boolean)
            .join(' '),
        )
      }

      const parsedResult = JSON.parse(responseText)
      const latestJob = store.getJob(jobId) ?? currentJob
      const completedJob = persistJob({
        ...latestJob,
        status: 'completed',
        responseStatus: 'completed',
        rawResponse: response,
        resultText: responseText,
        result: parsedResult,
        progress: appendProgressEvent(latestJob.progress, 'Gemini 已返回完整结果，解析完成。', { phase: 'completed' }),
      })
      return sanitizeJob(completedJob)
    } catch (error) {
      const latestJob = store.getJob(jobId) ?? currentJob
      const failedJob = persistJob({
        ...latestJob,
        status: 'failed',
        lastError: normalizeProviderError(error),
        progress: appendProgressEvent(latestJob.progress, `Gemini 失败：${normalizeProviderError(error)}`, { phase: 'failed' }),
      })
      return sanitizeJob(failedJob)
    }
  }

  async function processDeepSeekJob(jobId) {
    const currentJob = store.getJob(jobId)
    if (!currentJob || currentJob.provider !== 'deepseek' || TERMINAL_STATUSES.has(currentJob.status)) {
      return sanitizeJob(currentJob)
    }

    try {
      persistJob({
        ...currentJob,
        progress: appendProgressEvent(currentJob.progress, 'DeepSeek 已开始处理请求。', { phase: 'started' }),
      })

      const deepSeekClient = getClient('deepseek')
      let response

      try {
        response = await deepSeekClient.createJsonCompletionStream({
          model: currentJob.model,
          prompt: currentJob.requestSnapshot.prompt,
          onChunk: createJobProgressReporter(jobId, 'DeepSeek'),
        })
      } catch (streamError) {
        if (![400, 404].includes(streamError?.status)) {
          throw streamError
        }
        const latestJob = store.getJob(jobId) ?? currentJob
        persistJob({
          ...latestJob,
          progress: appendProgressEvent(latestJob.progress, 'DeepSeek 流式响应不可用，已切换为普通等待模式。', {
            phase: 'non_streaming_fallback',
          }),
        })
        response = await deepSeekClient.createJsonCompletion({
          model: currentJob.model,
          prompt: currentJob.requestSnapshot.prompt,
        })
      }

      const responseText = extractDeepSeekResponseText(response)
      const parsedResult = JSON.parse(responseText)
      const latestJob = store.getJob(jobId) ?? currentJob
      const completedJob = persistJob({
        ...latestJob,
        status: 'completed',
        responseStatus: 'completed',
        rawResponse: response,
        resultText: responseText,
        result: parsedResult,
        progress: appendProgressEvent(latestJob.progress, 'DeepSeek 已返回完整结果，解析完成。', { phase: 'completed' }),
      })
      return sanitizeJob(completedJob)
    } catch (error) {
      const latestJob = store.getJob(jobId) ?? currentJob
      const failedJob = persistJob({
        ...latestJob,
        status: 'failed',
        lastError: normalizeDeepSeekError(error),
        progress: appendProgressEvent(latestJob.progress, `DeepSeek 失败：${normalizeDeepSeekError(error)}`, { phase: 'failed' }),
      })
      return sanitizeJob(failedJob)
    }
  }

  async function pollJob(jobId) {
    const currentJob = store.getJob(jobId)
    if (!currentJob || !currentJob.responseId || TERMINAL_STATUSES.has(currentJob.status)) {
      return sanitizeJob(currentJob)
    }

    const pollingJob = persistJob({
      ...currentJob,
      status: 'polling',
      lastError: '',
    })

    try {
      const response = await getClient('openai').retrieveResponse(pollingJob.responseId)
      const nextStatus = response.status || 'submitted'

      if (nextStatus === 'completed') {
        try {
          const responseText = extractResponseText(response)
          const parsedResult = JSON.parse(responseText)
          const completedJob = persistJob({
            ...pollingJob,
            status: 'completed',
            responseStatus: nextStatus,
            rawResponse: response,
            resultText: responseText,
            result: parsedResult,
          })
          return sanitizeJob(completedJob)
        } catch (error) {
          const failedJob = persistJob({
            ...pollingJob,
            status: 'failed',
            responseStatus: nextStatus,
            rawResponse: response,
            lastError: `模型已返回结果，但解析 JSON 失败：${normalizeErrorMessage(error, '无可用错误信息')}`,
          })
          return sanitizeJob(failedJob)
        }
      }

      if (TERMINAL_STATUSES.has(nextStatus)) {
        const failedJob = persistJob({
          ...pollingJob,
          status: nextStatus,
          responseStatus: nextStatus,
          rawResponse: response,
          lastError: nextStatus === 'cancelled' ? '任务已取消。' : pollingJob.lastError,
        })
        return sanitizeJob(failedJob)
      }

      const nextJob = persistJob({
        ...pollingJob,
        status: nextStatus,
        responseStatus: nextStatus,
      })
      schedulePoll(nextJob.id, getPollDelayMs(nextJob))
      return sanitizeJob(nextJob)
    } catch (error) {
      const retryJob = persistJob({
        ...pollingJob,
        status: 'retry_wait',
        lastError: normalizeErrorMessage(error),
      })
      schedulePoll(retryJob.id, getPollDelayMs(retryJob))
      return sanitizeJob(retryJob)
    }
  }

  async function retryJob(jobId) {
    const currentJob = store.getJob(jobId)
    if (!currentJob?.requestSnapshot) {
      throw new Error('没有找到可重试的任务。')
    }

    const retryingJob = persistJob({
      ...currentJob,
      status: 'submitting',
      attemptCount: (currentJob.attemptCount ?? 0) + 1,
      lastError: '',
      responseId: '',
      progress: appendProgressEvent(currentJob.progress, '准备重试模型请求。', { phase: 'retrying' }),
      result: null,
      resultText: '',
      rawResponse: null,
    })

    try {
      if (retryingJob.provider === 'gemini') {
        const submittedJob = persistJob({
          ...retryingJob,
          status: 'in_progress',
          responseId: `gemini-local-${retryingJob.id}-${retryingJob.attemptCount}`,
          progress: appendProgressEvent(retryingJob.progress, 'Gemini 重试请求已发出，等待流式响应。', { phase: 'request_sent' }),
        })
        processGeminiJob(submittedJob.id).catch(() => {})
        return sanitizeJob(submittedJob)
      }

      if (retryingJob.provider === 'deepseek') {
        const submittedJob = persistJob({
          ...retryingJob,
          status: 'in_progress',
          responseId: `deepseek-local-${retryingJob.id}-${retryingJob.attemptCount}`,
          progress: appendProgressEvent(retryingJob.progress, 'DeepSeek 重试请求已发出，等待流式响应。', { phase: 'request_sent' }),
        })
        processDeepSeekJob(submittedJob.id).catch(() => {})
        return sanitizeJob(submittedJob)
      }

      const response = await getClient().createBackgroundResponse({
        model: retryingJob.model,
        background: true,
        store: true,
        input: redactSensitiveForExternalModel(retryingJob.requestSnapshot.prompt),
        text: {
          format: {
            type: 'json_schema',
            name: 'meeting_schedule_result',
            strict: true,
            schema: MEETING_SCHEDULE_SCHEMA,
          },
        },
        metadata: {
          app: 'meeting-manager',
          batchId: retryingJob.batchId,
          jobId: retryingJob.id,
          retryAttempt: retryingJob.attemptCount,
        },
      })

      const submittedJob = persistJob({
        ...retryingJob,
        responseId: response.id,
        status: response.status || 'submitted',
      })
      schedulePoll(submittedJob.id, getPollDelayMs(submittedJob))
      return sanitizeJob(submittedJob)
    } catch (error) {
      const failedJob = persistJob({
        ...retryingJob,
        status: 'failed',
        lastError:
          retryingJob.provider === 'gemini'
            ? normalizeProviderError(error)
            : retryingJob.provider === 'deepseek'
              ? normalizeDeepSeekError(error)
            : normalizeErrorMessage(error),
      })
      return sanitizeJob(failedJob)
    }
  }

  function listJobs() {
    return store.listJobs().filter((job) => job.status !== 'deleted').map(sanitizeJob)
  }

  function getJob(jobId) {
    const job = store.getJob(jobId)
    return job?.status === 'deleted' ? null : sanitizeJob(job)
  }

  function deleteJob(jobId) {
    const currentJob = store.getJob(jobId)
    if (!currentJob) {
      return { deleted: false }
    }

    if (timers.has(jobId)) {
      clearTimeout(timers.get(jobId))
      timers.delete(jobId)
    }

    persistJob({
      ...currentJob,
      status: 'deleted',
      lastError: '',
      progress: appendProgressEvent(currentJob.progress, '方案已从本地队列删除。', { phase: 'deleted' }),
    })

    return { deleted: true }
  }

  function registerImportedJob(payload = {}) {
    const createdAt = toIsoNow()
    const provider =
      payload.provider === 'gemini'
        ? 'gemini'
        : payload.provider === 'deepseek'
          ? 'deepseek'
          : payload.provider === 'imported'
            ? 'imported'
            : 'openai'
    const nextJob = persistJob({
      id: payload.id || createImportedJobId(),
      batchId: payload.batchId || `imported-batch-${Date.now()}`,
      planningTaskId: payload.planningTaskId || '',
      provider,
      model: payload.model || '导入方案',
      status: 'completed',
      createdAt,
      updatedAt: createdAt,
      attemptCount: 1,
      promptVersion: payload.promptVersion || 'imported',
      requestSnapshot: {
        prompt: '',
        inputMeetings: payload.inputMeetings ?? null,
        preferences: payload.preferences ?? null,
        exportBatch: payload.exportBatch ?? null,
        planningTaskId: payload.planningTaskId || '',
      },
      responseId: `imported-local-${Date.now()}`,
      responseStatus: 'completed',
      lastError: '',
      result: payload.result ?? null,
      resultText: payload.result ? JSON.stringify(payload.result) : '',
      rawResponse: null,
    })

    return sanitizeJob(nextJob)
  }

  function initialize() {
    store.listJobs().forEach((job) => {
      if (ACTIVE_STATUSES.has(job.status) && job.responseId) {
        if (job.provider === 'gemini') {
          processGeminiJob(job.id).catch(() => {})
        } else if (job.provider === 'deepseek') {
          processDeepSeekJob(job.id).catch(() => {})
        } else {
          schedulePoll(job.id, 2_000)
        }
      }
    })

    ipcMain.handle('ai-jobs:list', async () => listJobs())
    ipcMain.handle('ai-jobs:get', async (_, jobId) => getJob(jobId))
    ipcMain.handle('ai-jobs:submit', async (_, payload) => submitJob(payload))
    ipcMain.handle('ai-jobs:retry', async (_, jobId) => retryJob(jobId))
    ipcMain.handle('ai-jobs:delete', async (_, jobId) => deleteJob(jobId))
    ipcMain.handle('ai-jobs:register-imported', async (_, payload) => registerImportedJob(payload))
  }

  return {
    initialize,
  }
}

module.exports = {
  createAiJobService,
}
