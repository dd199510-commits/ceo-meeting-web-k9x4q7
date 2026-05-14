const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 60 * 1000

async function parseSseStream(stream, onEvent) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = events.pop() ?? ''

    for (const event of events) {
      const dataLines = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())

      for (const data of dataLines) {
        if (data && data !== '[DONE]') {
          onEvent(JSON.parse(data))
        }
      }
    }
  }
}

function describeNetworkError(error) {
  const details = [
    error?.cause?.code,
    error?.cause?.errno,
    error?.cause?.syscall,
    error?.cause?.hostname,
    error?.cause?.address,
    error?.cause?.port,
  ].filter(Boolean)

  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return '请求超时'
  }

  if (details.length > 0) {
    return details.join(' ')
  }

  return ''
}

function normalizeDeepSeekError(error, fallback = 'DeepSeek 请求失败') {
  if (!error) return fallback
  if (typeof error === 'string') return error
  const networkDetail = describeNetworkError(error)
  if (error.message && networkDetail) return `${error.message}（${networkDetail}）`
  if (error.message) return error.message
  return fallback
}

class DeepSeekClient {
  constructor({ apiKey, baseUrl = DEEPSEEK_BASE_URL }) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async request(path, options = {}) {
    if (!this.apiKey) {
      throw new Error('未检测到 DEEPSEEK_API_KEY，无法提交 AI 排程任务。')
    }

    const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, ...fetchOptions } = options
    const timeoutSignal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : undefined
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...fetchOptions,
      signal: fetchOptions.signal ?? timeoutSignal,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(fetchOptions.headers ?? {}),
      },
    })

    if (!response.ok) {
      let errorMessage = `DeepSeek 请求失败（${response.status}）`
      try {
        const parsed = await response.json()
        errorMessage = parsed.error?.message || parsed.message || errorMessage
      } catch {
        errorMessage = `${errorMessage} ${response.statusText}`.trim()
      }
      const error = new Error(errorMessage)
      error.status = response.status
      throw error
    }

    return response.json()
  }

  async createJsonCompletion({ model, prompt }) {
    return this.request('/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              '你是会议排程助手。必须只输出可解析的 JSON 对象，不要输出 Markdown、解释文字或代码块。',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 32768,
        reasoning_effort: 'high',
        thinking: {
          type: 'enabled',
        },
      }),
    })
  }

  async createJsonCompletionStream({ model, prompt, onChunk }) {
    if (!this.apiKey) {
      throw new Error('未检测到 DEEPSEEK_API_KEY，无法提交 AI 排程任务。')
    }

    const timeoutSignal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS)
        : undefined
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: timeoutSignal,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              '你是会议排程助手。必须只输出可解析的 JSON 对象，不要输出 Markdown、解释文字或代码块。',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 32768,
        reasoning_effort: 'high',
        thinking: {
          type: 'enabled',
        },
        stream: true,
      }),
    })

    if (!response.ok) {
      let errorMessage = `DeepSeek 请求失败（${response.status}）`
      try {
        const parsed = await response.json()
        errorMessage = parsed.error?.message || parsed.message || errorMessage
      } catch {
        errorMessage = `${errorMessage} ${response.statusText}`.trim()
      }
      throw new Error(errorMessage)
    }

    let content = ''

    await parseSseStream(response.body, (event) => {
      const delta = event?.choices?.[0]?.delta ?? {}
      const reasoningText = delta.reasoning_content || delta.reasoning || ''
      const contentText = delta.content || ''

      if (reasoningText) {
        onChunk?.({ kind: 'reasoning', text: reasoningText })
      }
      if (contentText) {
        content += contentText
        onChunk?.({ kind: 'content', text: contentText })
      }
    })

    return {
      choices: [
        {
          message: {
            content,
          },
        },
      ],
    }
  }
}

module.exports = {
  DeepSeekClient,
  normalizeDeepSeekError,
}
