import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const responseHeaderPolicy = createRequire(import.meta.url)(
  '../../server/response-header-policy.cjs',
) as {
  API_CACHE_HEADERS: Record<string, string>
  mergeResponseSecurityHeaders: (
    responseHeaders: Record<string, string>,
    defaultHeaders: Record<string, string>,
    options: { isApi: boolean },
  ) => Record<string, string>
}

const { API_CACHE_HEADERS, mergeResponseSecurityHeaders } = responseHeaderPolicy

const DEFAULT_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
}

describe('production response header policy', () => {
  it('preserves exact inert CSP and referrer headers on API responses', () => {
    const headers = mergeResponseSecurityHeaders(
      {
        'content-security-policy': "default-src 'none'; sandbox",
        'referrer-policy': 'no-referrer',
        'content-type': 'text/plain; charset=utf-8',
      },
      DEFAULT_HEADERS,
      { isApi: true },
    )

    expect(headers).toMatchObject({
      'content-security-policy': "default-src 'none'; sandbox",
      'referrer-policy': 'no-referrer',
      'content-type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    })
  })

  it('replaces weaker API security headers with the adapter defaults', () => {
    const headers = mergeResponseSecurityHeaders(
      {
        'Content-Security-Policy': "default-src 'none'",
        'Referrer-Policy': 'origin',
      },
      DEFAULT_HEADERS,
      { isApi: true },
    )

    expect(headers['Content-Security-Policy']).toBe(
      DEFAULT_HEADERS['Content-Security-Policy'],
    )
    expect(headers['Referrer-Policy']).toBe(DEFAULT_HEADERS['Referrer-Policy'])
  })

  it('uses the normal application policy for non-API responses', () => {
    const headers = mergeResponseSecurityHeaders(
      {
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Referrer-Policy': 'no-referrer',
      },
      DEFAULT_HEADERS,
      { isApi: false },
    )

    expect(headers['Content-Security-Policy']).toBe(
      DEFAULT_HEADERS['Content-Security-Policy'],
    )
    expect(headers['Referrer-Policy']).toBe(DEFAULT_HEADERS['Referrer-Policy'])
  })

  it('deduplicates names case-insensitively and retains content headers', () => {
    const headers = mergeResponseSecurityHeaders(
      {
        'CONTENT-SECURITY-POLICY': "default-src 'none'; sandbox",
        'content-security-policy': "default-src 'none'; sandbox",
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="artifact.svg"',
        'x-content-type-options': 'unsafe-value',
      },
      DEFAULT_HEADERS,
      { isApi: true },
    )

    const names = Object.keys(headers).map((name) => name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
    expect(headers['Content-Type']).toBe('application/octet-stream')
    expect(headers['Content-Disposition']).toBe(
      'attachment; filename="artifact.svg"',
    )
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
  })

  it('replaces API cache fields case-insensitively without duplicates', () => {
    const headers = mergeResponseSecurityHeaders(
      {
        'cache-control': 'public, max-age=3600',
        pragma: 'cache',
        expires: 'tomorrow',
        'Content-Type': 'application/json; charset=utf-8',
      },
      DEFAULT_HEADERS,
      { isApi: true },
    )

    const foldedNames = Object.keys(headers).map((name) => name.toLowerCase())
    expect(new Set(foldedNames).size).toBe(foldedNames.length)
    expect(headers['Cache-Control']).toBe(API_CACHE_HEADERS['Cache-Control'])
    expect(headers.Pragma).toBe(API_CACHE_HEADERS.Pragma)
    expect(headers.Expires).toBe(API_CACHE_HEADERS.Expires)
    expect(foldedNames.filter((name) => name === 'cache-control')).toHaveLength(
      1,
    )
    expect(foldedNames.filter((name) => name === 'pragma')).toHaveLength(1)
    expect(foldedNames.filter((name) => name === 'expires')).toHaveLength(1)
  })

  it('ships the helper with the production server adapter', () => {
    const serverEntry = readFileSync(
      new URL('../../server-entry.js', import.meta.url),
      'utf8',
    )
    expect(serverEntry).toContain("'./server/response-header-policy.cjs'")
    expect(serverEntry).toContain('mergeResponseSecurityHeaders(')

    const dockerfile = readFileSync(
      new URL('../../Dockerfile', import.meta.url),
      'utf8',
    )
    expect(dockerfile).toContain(
      '/app/server/response-header-policy.cjs ./server/response-header-policy.cjs',
    )

    const nixPackage = readFileSync(
      new URL('../../nix/package.nix', import.meta.url),
      'utf8',
    )
    expect(nixPackage).toContain('mkdir -p "$appDir/server"')
    expect(nixPackage).toContain(
      'cp server/request-body-limit.cjs server/response-header-policy.cjs "$appDir/server/"',
    )
  })
})
