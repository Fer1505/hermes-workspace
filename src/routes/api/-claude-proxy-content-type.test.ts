import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: unknown) => options,
}))

vi.mock('../../server/gateway-capabilities', () => ({
  BEARER_TOKEN: '',
  CLAUDE_API: 'http://gateway.invalid',
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

beforeEach(() => {
  mocks.fetch.mockReset()
  vi.stubGlobal('fetch', mocks.fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function proxyWith(contentType: string | null, body = 'payload') {
  const headers = new Headers()
  if (contentType !== null) headers.set('content-type', contentType)
  mocks.fetch.mockResolvedValue(
    new Response(contentType === null ? new TextEncoder().encode(body) : body, {
      status: 200,
      headers,
    }),
  )
  const { proxyRequest } = await import('./claude-proxy/$')
  return proxyRequest(
    new Request('http://workspace.invalid/api/claude-proxy/health'),
    'health',
  )
}

describe('claude proxy response-content containment', () => {
  it.each([204, 205])(
    'preserves the bodyless API status %s with inert headers',
    async (status) => {
      mocks.fetch.mockResolvedValue(new Response(null, { status }))
      const { proxyRequest } = await import('./claude-proxy/$')
      const response = await proxyRequest(
        new Request('http://workspace.invalid/api/claude-proxy/config', {
          method: 'DELETE',
        }),
        'config',
      )

      expect(response.status).toBe(status)
      expect(await response.text()).toBe('')
      expect(response.headers.get('content-type')).toBe(
        'text/plain; charset=utf-8',
      )
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    },
  )

  it.each([
    'application/json',
    'application/problem+json; charset=utf-8',
    'application/vnd.api+json',
    'application/x-ndjson',
    'application/json-seq',
    'text/plain; charset=utf-8',
    'text/event-stream',
  ])('retains the inert API response MIME %s', async (contentType) => {
    const response = await proxyWith(contentType, '{"ok":true}')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(contentType)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; sandbox",
    )
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it.each([
    null,
    'text/html',
    'application/xhtml+xml',
    'application/javascript',
    'text/javascript',
    'image/svg+xml',
    'application/pdf',
    'application/xml',
    'text/css',
    'image/png',
    'video/mp4',
    'application/octet-stream',
  ])(
    'replaces unsupported upstream MIME %s with an inert error',
    async (contentType) => {
      const response = await proxyWith(
        contentType,
        '<script>globalThis.compromised = true</script>',
      )
      const body = (await response.json()) as { ok: boolean; error: string }

      expect(response.status).toBe(502)
      expect(body.ok).toBe(false)
      expect(body.error).toMatch(/preview origin/i)
      expect(response.headers.get('content-type')).toBe(
        'application/json; charset=utf-8',
      )
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('content-security-policy')).toBe(
        "default-src 'none'; sandbox",
      )
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    },
  )

  it('gates and reserializes the available-models JSON fallback with inert headers', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        new Response('missing', {
          status: 404,
          headers: { 'content-type': 'text/plain' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: 'openai/gpt-contained', owned_by: 'openai' },
              { id: 'other/model', owned_by: 'other' },
            ],
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      )

    const { proxyRequest } = await import('./claude-proxy/$')
    const response = await proxyRequest(
      new Request(
        'http://workspace.invalid/api/claude-proxy/api/available-models?provider=openai',
      ),
      'api/available-models',
    )

    await expect(response.json()).resolves.toEqual({
      models: [{ id: 'openai/gpt-contained' }],
    })
    expect(response.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; sandbox",
    )
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('rejects a non-JSON available-models fallback before body parsing', async () => {
    const json = vi.fn()
    mocks.fetch
      .mockResolvedValueOnce(
        new Response('missing', {
          status: 404,
          headers: { 'content-type': 'text/plain' },
        }),
      )
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
        json,
      } as unknown as Response)

    const { proxyRequest } = await import('./claude-proxy/$')
    const response = await proxyRequest(
      new Request(
        'http://workspace.invalid/api/claude-proxy/api/available-models',
      ),
      'api/available-models',
    )

    await expect(response.json()).resolves.toEqual({ models: [] })
    expect(json).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; sandbox",
    )
  })
})
