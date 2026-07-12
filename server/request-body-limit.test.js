import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import requestBodyLimit from './request-body-limit.cjs'

const {
  readBoundedRequestBody,
  RequestBodyTooLargeError,
} = requestBodyLimit

function request(headers = {}) {
  const stream = new PassThrough()
  stream.headers = headers
  return stream
}

describe('production request body limit', () => {
  it('buffers a body within the limit', async () => {
    const stream = request({ 'content-length': '4' })
    const result = readBoundedRequestBody(stream, 4)
    stream.end('test')
    await expect(result).resolves.toEqual(Buffer.from('test'))
  })

  it('rejects an oversized declared content length before buffering', async () => {
    const stream = request({ 'content-length': '5' })
    await expect(readBoundedRequestBody(stream, 4)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    )
  })

  it('rejects a chunked body when accumulated bytes cross the limit', async () => {
    const stream = request()
    const result = readBoundedRequestBody(stream, 4)
    stream.write('abc')
    stream.end('def')
    await expect(result).rejects.toBeInstanceOf(RequestBodyTooLargeError)
  })

  it('ships the adapter helper in the production container', () => {
    const dockerfile = readFileSync(
      new URL('../Dockerfile', import.meta.url),
      'utf8',
    )
    expect(dockerfile).toContain(
      '/app/server/request-body-limit.cjs ./server/request-body-limit.cjs',
    )

    const electronBuilder = readFileSync(
      new URL('../electron-builder.config.cjs', import.meta.url),
      'utf8',
    )
    expect(electronBuilder).toContain("'server/request-body-limit.cjs'")
  })
})
