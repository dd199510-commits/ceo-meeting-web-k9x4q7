const https = require('node:https')
const { execFileSync } = require('node:child_process')
const { HttpsProxyAgent } = require('https-proxy-agent')

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_ALPHA_BASE_URL = 'https://generativelanguage.googleapis.com/v1alpha'
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_RETRY_COUNT = 2
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])
let cachedSystemProxyUrl = null
let hasReadSystemProxy = false

async function parseSseStream(stream, onEvent) {
  const decoder = new TextDecoder()
  let buffer = ''

  async function parseChunk(value) {
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = events.pop() ?? ''

    for (const event of events) {
      const dataLines = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())

      for (const data of dataLines) {
        if (data) {
          onEvent(JSON.parse(data))
        }
      }
    }
  }

  if (typeof stream?.getReader === 'function') {
    const reader = stream.getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      await parseChunk(value)
    }
  } else {
    for await (const chunk of stream) {
      await parseChunk(chunk)
    }
  }

  const tail = decoder.decode()
  if (tail) {
    await parseChunk(new TextEncoder().encode(tail))
  }

  if (buffer.trim()) {
    await parseChunk(new TextEncoder().encode('\n\n'))
  }
}

function readSystemHttpsProxyUrl() {
  if (hasReadSystemProxy) {
    return cachedSystemProxyUrl
  }

  hasReadSystemProxy = true

  if (process.platform !== 'darwin') {
    return cachedSystemProxyUrl
  }

  try {
    const output = execFileSync('scutil', ['--proxy'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const enabled = output.match(/HTTPSEnable\s*:\s*1/)
    const host = output.match(/HTTPSProxy\s*:\s*(.+)/)?.[1]?.trim()
    const port = output.match(/HTTPSPort\s*:\s*(\d+)/)?.[1]?.trim()

    if (enabled && host && port) {
      cachedSystemProxyUrl = `http://${host}:${port}`
    }
  } catch {
    cachedSystemProxyUrl = null
  }

  return cachedSystemProxyUrl
}

function getProxyUrl() {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    readSystemHttpsProxyUrl()
  )
}

function createResponse(statusCode, statusMessage, body) {
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    statusText: statusMessage || '',
    body,
    async text() {
      const chunks = []
      for await (const chunk of body) {
        chunks.push(Buffer.from(chunk))
      }
      return Buffer.concat(chunks).toString('utf8')
    },
    async json() {
      return JSON.parse(await this.text())
    },
  }
}

function proxyFetch(url, options = {}) {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return fetch(url, options)
  }

  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const agent = new HttpsProxyAgent(proxyUrl)
    const request = https.request(
      target,
      {
        method: options.method || 'GET',
        headers: options.headers,
        agent,
        signal: options.signal,
      },
      (response) => {
        resolve(createResponse(response.statusCode || 0, response.statusMessage || '', response))
      },
    )

    request.on('error', reject)

    if (options.body) {
      request.write(options.body)
    }

    request.end()
  })
}

async function parseErrorMessage(response, fallback) {
  let errorMessage = fallback
  try {
    const parsed = await response.json()
    errorMessage = parsed.error?.message || errorMessage
  } catch {
    try {
      errorMessage = `${errorMessage} ${response.statusText}`.trim()
    } catch {
      // Keep the original fallback message.
    }
  }
  return errorMessage
}

function createGeminiResponseError(response) {
  const error = new Error(`Gemini 请求失败（${response.status}）`)
  error.status = response.status
  return error
}

async function throwGeminiResponseError(response) {
  const error = createGeminiResponseError(response)
  error.message = await parseErrorMessage(response, error.message)
  throw error
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

function normalizeProviderError(error, fallback = 'Gemini 请求失败') {
  if (!error) return fallback
  if (typeof error === 'string') return error
  const networkDetail = describeNetworkError(error)
  if (error.message && networkDetail) return `${error.message}（${networkDetail}）`
  if (error.message) return error.message
  return fallback
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isNetworkError(error) {
  return (
    error?.name === 'TypeError' ||
    error?.name === 'TimeoutError' ||
    error?.name === 'AbortError' ||
    Boolean(error?.cause?.code)
  )
}

function isRetryableError(error) {
  return isNetworkError(error) || RETRYABLE_STATUS_CODES.has(error?.status)
}

function getGeminiBaseUrls(model, preferredBaseUrl) {
  const normalizedModel = String(model || '')
  const candidates = normalizedModel.startsWith('gemini-3.1')
    ? [GEMINI_ALPHA_BASE_URL, GEMINI_BASE_URL]
    : [preferredBaseUrl, GEMINI_ALPHA_BASE_URL]

  return Array.from(new Set(candidates.filter(Boolean)))
}

function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return undefined

  if (Array.isArray(schema.type)) {
    const nextSchema = { ...schema, type: schema.type[0] }
    return toGeminiSchema(nextSchema)
  }

  const normalized = {}

  if (typeof schema.type === 'string') {
    normalized.type = schema.type.toUpperCase()
  }

  if (schema.description) normalized.description = schema.description
  if (schema.required) normalized.required = schema.required

  if (schema.properties && typeof schema.properties === 'object') {
    normalized.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)]),
    )
  }

  if (schema.items) {
    normalized.items = toGeminiSchema(schema.items)
  }

  if (Array.isArray(schema.enum)) {
    normalized.enum = schema.enum
  }

  return normalized
}

class GeminiClient {
  constructor({ apiKey, baseUrl = GEMINI_BASE_URL }) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl
  }

  async request(path, options = {}) {
    if (!this.apiKey) {
      throw new Error('未检测到 Gemini API Key，无法提交 AI 排程任务。')
    }

    const separator = path.includes('?') ? '&' : '?'
    const {
      baseUrl = this.baseUrl,
      retryCount = DEFAULT_RETRY_COUNT,
      timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
      ...fetchOptions
    } = options
    let lastError = null

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        const timeoutSignal =
          typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(timeoutMs)
            : undefined
        const response = await proxyFetch(`${baseUrl}${path}${separator}key=${encodeURIComponent(this.apiKey)}`, {
          ...fetchOptions,
          signal: fetchOptions.signal ?? timeoutSignal,
          headers: {
            'Content-Type': 'application/json',
            ...(fetchOptions.headers ?? {}),
          },
        })

        if (!response.ok) {
          await throwGeminiResponseError(response)
        }

        return response.json()
      } catch (error) {
        lastError = error
        if (attempt >= retryCount || !isRetryableError(error)) {
          throw error
        }
        await sleep(800 * 2 ** attempt)
      }
    }

    throw lastError
  }

  async generateStructuredContent({ model, prompt, schema }) {
    const body = JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(schema),
      },
    })
    let lastError = null

    for (const baseUrl of getGeminiBaseUrls(model, this.baseUrl)) {
      try {
        return await this.request(`/models/${model}:generateContent`, {
          baseUrl,
          method: 'POST',
          body,
        })
      } catch (error) {
        lastError = error
        if (![400, 403, 404].includes(error?.status)) {
          throw error
        }
      }
    }

    throw lastError
  }

  async streamStructuredContent({ model, prompt, schema, onChunk }) {
    const body = JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(schema),
      },
    })
    let lastError = null

    for (const baseUrl of getGeminiBaseUrls(model, this.baseUrl)) {
      for (let attempt = 0; attempt <= DEFAULT_RETRY_COUNT; attempt += 1) {
        let receivedContent = false

        try {
          const timeoutSignal =
            typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
              ? AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS)
              : undefined
          const response = await proxyFetch(
            `${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`,
            {
              method: 'POST',
              signal: timeoutSignal,
              headers: {
                'Content-Type': 'application/json',
              },
              body,
            },
          )

          if (!response.ok) {
            await throwGeminiResponseError(response)
          }

          let text = ''
          let finishReason = ''
          let promptFeedback = null

          await parseSseStream(response.body, (event) => {
            const chunkText =
              event.candidates?.[0]?.content?.parts
                ?.map((part) => part.text || '')
                .join('') || ''
            if (chunkText) {
              receivedContent = true
              text += chunkText
              onChunk?.({ kind: 'content', text: chunkText })
            }
            finishReason = event.candidates?.[0]?.finishReason || finishReason
            promptFeedback = event.promptFeedback || promptFeedback
          })

          return {
            candidates: [
              {
                content: {
                  parts: [{ text }],
                },
                ...(finishReason ? { finishReason } : {}),
              },
            ],
            ...(promptFeedback ? { promptFeedback } : {}),
          }
        } catch (error) {
          lastError = error

          if ([400, 403, 404].includes(error?.status)) {
            break
          }

          if (receivedContent || attempt >= DEFAULT_RETRY_COUNT || !isRetryableError(error)) {
            throw error
          }

          await sleep(800 * 2 ** attempt)
        }
      }
    }

    throw lastError
  }
}

module.exports = {
  GeminiClient,
  normalizeProviderError,
}
