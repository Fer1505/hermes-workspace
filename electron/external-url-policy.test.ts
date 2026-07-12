import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
// electron/main.cjs is CommonJS, so the shared policy module stays CommonJS too.
// eslint-disable-next-line import/no-commonjs
const { isAllowedExternalUrl } = require('./external-url-policy.cjs') as {
  isAllowedExternalUrl: (
    rawUrl: string,
    options?: { allowedHosts?: Array<string>; env?: Record<string, string> },
  ) => boolean
}

describe('Electron external URL policy', () => {
  it('allows https URLs for approved hosts and subdomains', () => {
    expect(isAllowedExternalUrl('https://github.com/outsourc-e/hermes-workspace')).toBe(true)
    expect(isAllowedExternalUrl('https://portal.nousresearch.com/oauth')).toBe(true)
  })

  it('allows http only for loopback development URLs', () => {
    expect(isAllowedExternalUrl('http://127.0.0.1:3002/preview')).toBe(true)
    expect(isAllowedExternalUrl('http://localhost:9119/kanban')).toBe(true)
    expect(isAllowedExternalUrl('http://[::1]:3000')).toBe(true)
    expect(isAllowedExternalUrl('http://100.113.68.47:9119/kanban')).toBe(false)
  })

  it('rejects malformed, credentialed, and non-web URLs', () => {
    expect(isAllowedExternalUrl('not a url')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedExternalUrl('https://user:pass@github.com/repo')).toBe(false)
  })

  it('does not accept hostname prefix spoofing', () => {
    expect(isAllowedExternalUrl('https://github.com.evil.test')).toBe(false)
    expect(isAllowedExternalUrl('https://evilgithub.com')).toBe(false)
    expect(isAllowedExternalUrl('http://localhost.evil.test')).toBe(false)
  })

  it('supports explicit operator host extensions', () => {
    expect(
      isAllowedExternalUrl('https://docs.internal.example/path', {
        env: { HERMES_EXTERNAL_URL_ALLOWLIST: 'docs.internal.example' },
      }),
    ).toBe(true)
  })
})
