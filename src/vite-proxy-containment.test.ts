import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Vite generated-content proxy containment', () => {
  it('keeps document-capable HTTP proxy mounts disabled', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'vite.config.ts'),
      'utf8',
    )

    expect(source).not.toContain("'/ws-claude':")
    expect(source).not.toContain("'/api/claude-proxy':")
    expect(source).not.toContain("'/claude-ui':")
    expect(source).not.toContain("'/workspace-api':")
    expect(source).not.toContain("headers['x-frame-options']")
    expect(source).not.toContain("headers['content-security-policy']")
    expect(source).not.toMatch(/^\s+proxy:\s*\{/m)
  })
})
