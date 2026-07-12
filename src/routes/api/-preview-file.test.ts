import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GENERATED_CONTENT_CONTAINMENT_REASON } from '../../lib/generated-content-containment'

const authMocks = vi.hoisted(() => ({
  authenticated: true,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: unknown) => options,
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: () => authMocks.authenticated,
}))

beforeEach(() => {
  authMocks.authenticated = true
})

describe('GET /api/preview-file containment', () => {
  it('authenticates before returning the containment response', async () => {
    authMocks.authenticated = false
    const { previewFileGetHandler } = await import('./preview-file')
    const response = await previewFileGetHandler({
      request: new Request(
        'http://localhost/api/preview-file?path=/tmp/x.html',
      ),
    })

    expect(response.status).toBe(401)
  })

  it('returns an inert 410 without reading the request URL or a path', async () => {
    const { previewFileGetHandler } = await import('./preview-file')
    const request = {
      get url(): string {
        throw new Error('request URL must not be parsed')
      },
    } as Request
    const response = await previewFileGetHandler({ request })

    expect(response.status).toBe(410)
    expect(await response.text()).toBe(GENERATED_CONTENT_CONTAINMENT_REASON)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; sandbox",
    )
    expect(response.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8',
    )
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })
})
