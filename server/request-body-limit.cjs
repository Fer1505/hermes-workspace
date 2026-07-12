const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024

class RequestBodyTooLargeError extends Error {
  constructor(limit = MAX_REQUEST_BODY_BYTES) {
    super(`Request body exceeds the ${limit}-byte limit`)
    this.name = 'RequestBodyTooLargeError'
    this.limit = limit
  }
}

/**
 * Buffer a Node HTTP request with a hard upper bound. Runtime adapters must
 * enforce this before constructing a Fetch Request because application
 * middleware runs only after this buffering step.
 */
function readBoundedRequestBody(
  request,
  limit = MAX_REQUEST_BODY_BYTES,
) {
  const rawContentLength = request.headers?.['content-length']
  const contentLength = Array.isArray(rawContentLength)
    ? rawContentLength[0]
    : rawContentLength
  if (typeof contentLength === 'string' && /^\d+$/.test(contentLength)) {
    const declared = Number(contentLength)
    if (!Number.isSafeInteger(declared) || declared > limit) {
      request.resume?.()
      return Promise.reject(new RequestBodyTooLargeError(limit))
    }
  }

  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let settled = false

    const cleanup = () => {
      request.removeListener('data', onData)
      request.removeListener('end', onEnd)
      request.removeListener('error', onError)
      request.removeListener('aborted', onAborted)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      request.resume?.()
      reject(error)
    }
    const onData = (value) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      total += chunk.length
      if (total > limit) {
        fail(new RequestBodyTooLargeError(limit))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks, total))
    }
    const onError = (error) => fail(error)
    const onAborted = () => fail(new Error('Request body stream was aborted'))

    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onError)
    request.on('aborted', onAborted)
  })
}

module.exports = {
  MAX_REQUEST_BODY_BYTES,
  readBoundedRequestBody,
  RequestBodyTooLargeError,
}

