const CONFIG_STORAGE_KEY = 'meeting-manager-browser-ai-config'
const JOBS_STORAGE_KEY = 'meeting-manager-browser-ai-jobs'
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

function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value))
}

function normalizeProvider(provider) {
  if (provider === 'gemini' || provider === 'deepseek' || provider === 'openai' || provider === 'imported') {
    return provider
  }
  return 'gemini'
}

function getDefaultModel(provider) {
  if (provider === 'deepseek') return 'deepseek-v4-pro'
  if (provider === 'openai') return 'gpt-5.4'
  return 'gemini-3.1-pro-preview'
}

function createJobId(prefix = 'job') {
  const randomId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `${prefix}_${Date.now()}_${randomId}`
}

function toIsoNow() {
  return new Date().toISOString()
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
    events: [...events.slice(-7), { at: now, message }],
  }
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

function readConfig() {
  return readJson(CONFIG_STORAGE_KEY, {
    providers: {
      gemini: { apiKey: '' },
      deepseek: { apiKey: '' },
      openai: { apiKey: '' },
    },
  })
}

function getPublicConfig() {
  const config = readConfig()
  return {
    source: 'browser',
    providers: {
      gemini: { hasApiKey: Boolean(config.providers?.gemini?.apiKey) },
      deepseek: { hasApiKey: Boolean(config.providers?.deepseek?.apiKey) },
      openai: { hasApiKey: Boolean(config.providers?.openai?.apiKey) },
    },
  }
}

function readJobs() {
  return readJson(JOBS_STORAGE_KEY, [])
}

function writeJobs(jobs) {
  writeJson(JOBS_STORAGE_KEY, jobs)
}

function persistJob(nextJob) {
  const jobs = readJobs()
  const currentIndex = jobs.findIndex((job) => job.id === nextJob.id)
  const normalizedJob = {
    ...nextJob,
    updatedAt: toIsoNow(),
  }

  if (currentIndex >= 0) {
    jobs[currentIndex] = normalizedJob
  } else {
    jobs.unshift(normalizedJob)
  }

  writeJobs(jobs)
  return normalizedJob
}

function getRawJob(jobId) {
  return readJobs().find((job) => job.id === jobId) ?? null
}

function getApiKey(provider) {
  const config = readConfig()
  return config.providers?.[provider]?.apiKey || ''
}

async function parseJsonResponse(response, providerLabel) {
  if (!response.ok) {
    let errorMessage = `${providerLabel} 请求失败（${response.status}）`
    try {
      const parsed = await response.json()
      errorMessage = parsed.error?.message || parsed.message || errorMessage
    } catch {
      errorMessage = `${errorMessage} ${response.statusText}`.trim()
    }
    throw new Error(errorMessage)
  }

  return response.json()
}

function extractOpenAIResponseText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim()
  }

  const chunks = []
  ;(response.output ?? []).forEach((item) => {
    ;(item.content ?? []).forEach((contentItem) => {
      if (typeof contentItem.text === 'string') chunks.push(contentItem.text)
      if (typeof contentItem.output_text === 'string') chunks.push(contentItem.output_text)
    })
  })
  return chunks.join('\n').trim()
}

function extractGeminiResponseText(response) {
  return (
    response.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('\n')
      .trim() || ''
  )
}

function extractDeepSeekResponseText(response) {
  return response?.choices?.[0]?.message?.content?.trim() || ''
}

function parseResultText(responseText, providerLabel) {
  if (!responseText) {
    throw new Error(`${providerLabel} 未返回可解析的文本内容。`)
  }

  try {
    return JSON.parse(responseText)
  } catch (error) {
    throw new Error(`模型已返回结果，但解析 JSON 失败：${error.message}`)
  }
}

async function requestGemini({ apiKey, model, prompt }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: MEETING_SCHEDULE_SCHEMA,
        },
      }),
    },
  )
  const parsed = await parseJsonResponse(response, 'Gemini')
  return {
    rawResponse: parsed,
    resultText: extractGeminiResponseText(parsed),
  }
}

async function requestDeepSeek({ apiKey, model, prompt }) {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: '你是会议排程助手。必须只输出可解析的 JSON 对象，不要输出 Markdown、解释文字或代码块。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 32768,
      reasoning_effort: 'high',
      thinking: { type: 'enabled' },
    }),
  })
  const parsed = await parseJsonResponse(response, 'DeepSeek')
  return {
    rawResponse: parsed,
    resultText: extractDeepSeekResponseText(parsed),
  }
}

async function requestOpenAI({ apiKey, model, prompt, batchId, jobId }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: prompt,
      text: {
        format: {
          type: 'json_schema',
          name: 'meeting_schedule_result',
          strict: true,
          schema: MEETING_SCHEDULE_SCHEMA,
        },
      },
      metadata: {
        app: 'meeting-manager-browser',
        batchId,
        jobId,
      },
    }),
  })
  const parsed = await parseJsonResponse(response, 'OpenAI')
  return {
    rawResponse: parsed,
    resultText: extractOpenAIResponseText(parsed),
  }
}

async function processJob(jobId) {
  const currentJob = getRawJob(jobId)
  if (!currentJob || TERMINAL_STATUSES.has(currentJob.status)) return sanitizeJob(currentJob)

  const provider = normalizeProvider(currentJob.provider)
  const providerLabel = provider === 'deepseek' ? 'DeepSeek' : provider === 'openai' ? 'OpenAI' : 'Gemini'
  const apiKey = getApiKey(provider)

  if (!apiKey) {
    const failedJob = persistJob({
      ...currentJob,
      status: 'failed',
      lastError: `未保存 ${providerLabel} API Key，无法提交 AI 排程任务。`,
      progress: appendProgressEvent(currentJob.progress, `${providerLabel} 失败：缺少 API Key。`, { phase: 'failed' }),
    })
    return sanitizeJob(failedJob)
  }

  try {
    persistJob({
      ...currentJob,
      status: 'in_progress',
      progress: appendProgressEvent(currentJob.progress, `${providerLabel} 请求已发出，等待模型返回。`, {
        phase: 'request_sent',
      }),
    })

    const requestPayload = {
      apiKey,
      model: currentJob.model || getDefaultModel(provider),
      prompt: currentJob.requestSnapshot?.prompt || '',
      batchId: currentJob.batchId,
      jobId: currentJob.id,
    }
    const response =
      provider === 'deepseek'
        ? await requestDeepSeek(requestPayload)
        : provider === 'openai'
          ? await requestOpenAI(requestPayload)
          : await requestGemini(requestPayload)
    const result = parseResultText(response.resultText, providerLabel)
    const latestJob = getRawJob(jobId) ?? currentJob
    const completedJob = persistJob({
      ...latestJob,
      status: 'completed',
      responseStatus: 'completed',
      rawResponse: response.rawResponse,
      resultText: response.resultText,
      result,
      progress: appendProgressEvent(latestJob.progress, `${providerLabel} 已返回完整结果，解析完成。`, {
        phase: 'completed',
      }),
    })
    return sanitizeJob(completedJob)
  } catch (error) {
    const latestJob = getRawJob(jobId) ?? currentJob
    const message =
      error?.name === 'TypeError' && String(error?.message || '').includes('Failed to fetch')
        ? `${providerLabel} 请求失败：浏览器无法直接连接该模型接口，可能是网络或接口 CORS 限制。`
        : error?.message || `${providerLabel} 请求失败。`
    const failedJob = persistJob({
      ...latestJob,
      status: 'failed',
      lastError: message,
      progress: appendProgressEvent(latestJob.progress, `${providerLabel} 失败：${message}`, { phase: 'failed' }),
    })
    return sanitizeJob(failedJob)
  }
}

function installBrowserAiScheduler() {
  if (typeof window === 'undefined' || window.aiScheduler) return

  window.aiScheduler = {
    listJobs: async () => readJobs().filter((job) => job.status !== 'deleted').map(sanitizeJob),
    getJob: async (jobId) => {
      const job = getRawJob(jobId)
      return job?.status === 'deleted' ? null : sanitizeJob(job)
    },
    submitJob: async (payload = {}) => {
      const createdAt = toIsoNow()
      const provider = normalizeProvider(payload.provider)
      const draftJob = persistJob({
        id: createJobId(),
        batchId: payload.batchId,
        planningTaskId: payload.planningTaskId || '',
        provider,
        model: payload.model || getDefaultModel(provider),
        status: 'in_progress',
        createdAt,
        updatedAt: createdAt,
        attemptCount: 1,
        promptVersion: payload.promptVersion || 'v1',
        requestSnapshot: {
          prompt: payload.prompt || '',
          inputMeetings: payload.inputMeetings ?? null,
          preferences: payload.preferences ?? null,
          exportBatch: payload.exportBatch ?? null,
          planningTaskId: payload.planningTaskId || '',
        },
        responseId: `browser-local-${createdAt}`,
        lastError: '',
        progress: createProgressSnapshot('已写入浏览器本地方案队列，准备提交模型。', { phase: 'queued' }),
        result: null,
      })

      processJob(draftJob.id).catch(() => {})
      return sanitizeJob(draftJob)
    },
    retryJob: async (jobId) => {
      const currentJob = getRawJob(jobId)
      if (!currentJob?.requestSnapshot) {
        throw new Error('没有找到可重试的任务。')
      }

      const retryingJob = persistJob({
        ...currentJob,
        status: 'in_progress',
        attemptCount: (currentJob.attemptCount ?? 0) + 1,
        lastError: '',
        responseId: `browser-local-retry-${Date.now()}`,
        progress: appendProgressEvent(currentJob.progress, '准备重试模型请求。', { phase: 'retrying' }),
        result: null,
        resultText: '',
        rawResponse: null,
      })
      processJob(retryingJob.id).catch(() => {})
      return sanitizeJob(retryingJob)
    },
    deleteJob: async (jobId) => {
      const currentJob = getRawJob(jobId)
      if (!currentJob) return { deleted: false }
      persistJob({
        ...currentJob,
        status: 'deleted',
        lastError: '',
        progress: appendProgressEvent(currentJob.progress, '方案已从浏览器本地队列删除。', { phase: 'deleted' }),
      })
      return { deleted: true }
    },
    registerImportedJob: async (payload = {}) => {
      const createdAt = toIsoNow()
      const provider = normalizeProvider(payload.provider)
      const job = persistJob({
        id: payload.id || createJobId('imported'),
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
        responseId: `imported-browser-${Date.now()}`,
        responseStatus: 'completed',
        lastError: '',
        result: payload.result ?? null,
        resultText: payload.result ? JSON.stringify(payload.result) : '',
        rawResponse: null,
      })
      return sanitizeJob(job)
    },
    getConfig: async () => getPublicConfig(),
    saveApiKey: async (payload = {}) => {
      const provider = normalizeProvider(payload.provider)
      const config = readConfig()
      writeJson(CONFIG_STORAGE_KEY, {
        ...config,
        providers: {
          ...(config.providers ?? {}),
          [provider]: { apiKey: String(payload.apiKey || '').trim() },
        },
      })
      return getPublicConfig()
    },
    clearApiKey: async (providerInput) => {
      const provider = normalizeProvider(providerInput)
      const config = readConfig()
      writeJson(CONFIG_STORAGE_KEY, {
        ...config,
        providers: {
          ...(config.providers ?? {}),
          [provider]: { apiKey: '' },
        },
      })
      return getPublicConfig()
    },
  }
}

export default installBrowserAiScheduler
