const STRICT_API_RESPONSE_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'none'; sandbox",
  'referrer-policy': 'no-referrer',
})

const API_CACHE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Pragma: 'no-cache',
  Expires: '0',
})

function entriesOf(headers) {
  if (!headers) return []
  if (typeof headers.entries === 'function') {
    return Array.from(headers.entries())
  }
  if (typeof headers[Symbol.iterator] === 'function') {
    return Array.from(headers)
  }
  return Object.entries(headers)
}

function setCaseInsensitive(target, name, value) {
  if (typeof name !== 'string' || typeof value !== 'string') return
  target.set(name.toLowerCase(), { name, value })
}

/**
 * Apply the production adapter's default response headers without weakening
 * the deliberately inert headers emitted by generated-content API routes.
 * Header names are folded case-insensitively so Node never receives duplicate
 * security fields with different casing.
 */
function mergeResponseSecurityHeaders(
  responseHeaders,
  defaultHeaders,
  { isApi = false } = {},
) {
  const merged = new Map()

  for (const [name, value] of entriesOf(responseHeaders)) {
    setCaseInsensitive(merged, name, value)
  }

  for (const [name, value] of entriesOf(defaultHeaders)) {
    if (typeof value !== 'string') continue
    const key = name.toLowerCase()
    const existing = merged.get(key)
    const strictApiValue = STRICT_API_RESPONSE_HEADERS[key]
    const preserveStrictApiHeader =
      isApi &&
      strictApiValue !== undefined &&
      existing?.value === strictApiValue

    if (!preserveStrictApiHeader) {
      setCaseInsensitive(merged, name, value)
    }
  }

  if (isApi) {
    for (const [name, value] of Object.entries(API_CACHE_HEADERS)) {
      setCaseInsensitive(merged, name, value)
    }
  }

  return Object.fromEntries(
    Array.from(merged.values(), ({ name, value }) => [name, value]),
  )
}

module.exports = {
  API_CACHE_HEADERS,
  STRICT_API_RESPONSE_HEADERS,
  mergeResponseSecurityHeaders,
}
