const OPENAI_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 60 * 1000

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

function normalizeErrorMessage(error, fallback = 'OpenAI 请求失败') {
  if (!error) return fallback
  if (typeof error === 'string') return error
  const networkDetail = describeNetworkError(error)
  if (error.message && networkDetail) return `${error.message}（${networkDetail}）`
  if (error.message) return error.message
  return fallback
}

class OpenAIClient {
  constructor({ apiKey, baseUrl = OPENAI_BASE_URL }) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl
  }

  async request(path, options = {}) {
    if (!this.apiKey) {
      throw new Error('未检测到 OPENAI_API_KEY，无法提交 AI 排程任务。')
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
      let errorMessage = `OpenAI 请求失败（${response.status}）`
      try {
        const parsed = await response.json()
        errorMessage = parsed.error?.message || errorMessage
      } catch {
        errorMessage = `${errorMessage} ${response.statusText}`.trim()
      }
      throw new Error(errorMessage)
    }

    return response.json()
  }

  async createBackgroundResponse(payload) {
    return this.request('/responses', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async retrieveResponse(responseId) {
    return this.request(`/responses/${responseId}`, {
      method: 'GET',
    })
  }
}

module.exports = {
  OpenAIClient,
  normalizeErrorMessage,
}
