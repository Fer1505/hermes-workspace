import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GENERATED_CONTENT_CONTAINMENT_REASON } from '../../lib/generated-content-containment'

const mocks = vi.hoisted(() => ({
  authenticated: true,
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: unknown) => options,
}))

vi.mock('node:fs', () => {
  return {
    readFileSync: mocks.readFileSync,
    statSync: mocks.statSync,
  }
})

vi.mock('../../server/auth-middleware', () => ({
  requireLocalOrAuth: () => mocks.authenticated,
}))

beforeEach(() => {
  mocks.authenticated = true
  mocks.readFileSync.mockReset()
  mocks.statSync.mockReset()
})

async function getHandler() {
  const mod = await import('./media')
  return (mod as any).Route.server.handlers.GET as (input: {
    request: Request
  }) => Promise<Response>
}

describe('GET /api/media generated-content containment', () => {
  it('authenticates before applying generated-content policy', async () => {
    mocks.authenticated = false
    const handler = await getHandler()
    const response = await handler({
      request: new Request(
        'http://localhost/api/media?path=/tmp/generated.svg',
      ),
    })

    expect(response.status).toBe(401)
  })

  it.each([
    ['HTML', '/tmp/generated.HTML'],
    ['HTM', '/tmp/generated.HtM'],
    ['XHTML', '/tmp/generated.XHTML'],
    ['JS', '/tmp/generated.Js'],
    ['MJS', '/tmp/generated.MjS'],
    ['percent-encoded SVG', '/tmp/generated%2ESvG'],
    ['fragmented PDF', '/tmp/generated.PDF#page=1'],
  ])('rejects %s before stat or read', async (_label, rawPath) => {
    const handler = await getHandler()
    const response = await handler({
      request: new Request(
        `http://localhost/api/media?path=${encodeURIComponent(rawPath)}`,
      ),
    })

    expect(response.status).toBe(415)
    expect(await response.text()).toBe(GENERATED_CONTENT_CONTAINMENT_REASON)
    expect(mocks.statSync).not.toHaveBeenCalled()
    expect(mocks.readFileSync).not.toHaveBeenCalled()
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

  it.each([
    ['PNG', '/tmp/generated.PNG', 'image/png'],
    ['AVIF', '/tmp/generated.AvIf', 'image/avif'],
  ])(
    'serves explicitly safe %s raster content with defense headers',
    async (_label, rawPath, expectedMime) => {
      const bytes = Buffer.from([0, 1, 2])
      mocks.statSync.mockReturnValue({ isFile: () => true, size: bytes.length })
      mocks.readFileSync.mockReturnValue(bytes)
      const handler = await getHandler()
      const response = await handler({
        request: new Request(
          `http://localhost/api/media?path=${encodeURIComponent(rawPath)}`,
        ),
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe(expectedMime)
      expect(response.headers.get('cache-control')).toBe('private, max-age=60')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(mocks.statSync).toHaveBeenCalledOnce()
      expect(mocks.readFileSync).toHaveBeenCalledOnce()
    },
  )
})
