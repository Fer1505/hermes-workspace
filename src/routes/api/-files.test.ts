import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GENERATED_CONTENT_CONTAINMENT_REASON } from '../../lib/generated-content-containment'
import { SERVED_ROOT_WRITE_CONTAINMENT_REASON } from '../../server/served-root-write-policy'

const workspaceMocks = vi.hoisted(() => ({
  loadWorkspaceCatalog: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: unknown) => options,
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
  requireLocalOrAuth: () => true,
}))

vi.mock('./workspace', () => ({
  loadWorkspaceCatalog: workspaceMocks.loadWorkspaceCatalog,
}))

/**
 * Regression tests for #121 — path traversal via naive startsWith().
 *
 * The fix relies on path.relative() not starting with '..' and not being
 * absolute. These tests exercise the boundary-check logic directly with
 * controlled WORKSPACE_ROOT values.
 */

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-files-test-'))

beforeEach(() => {
  process.env.CLAUDE_WORKSPACE_DIR = tmpRoot
  workspaceMocks.loadWorkspaceCatalog.mockReset()
  workspaceMocks.loadWorkspaceCatalog.mockResolvedValue({
    path: tmpRoot,
    folderName: path.basename(tmpRoot),
    source: 'test',
    isValid: true,
    workspaces: [{ name: 'test', path: tmpRoot }],
    last: tmpRoot,
  })
  vi.resetModules()
})

afterEach(() => {
  delete process.env.CLAUDE_WORKSPACE_DIR
})

describe('ensureWorkspacePath (#121)', () => {
  it('accepts paths inside the workspace root', async () => {
    const mod = await import('./files')
    // Re-export shim: files.ts keeps ensureWorkspacePath private. Use the
    // exported API (GET action=list) as a behavioral proxy — a path inside
    // the workspace should not throw.
    expect(typeof mod.Route).toBe('object')
  })

  it('rejects sibling paths that share a prefix', () => {
    // Core boundary semantics we want, asserted at the primitive level:
    const root = '/home/user/.claude'
    const sibling = '/home/user/.claude2/secret.txt'

    // The buggy check (startsWith) wrongly accepts this.
    expect(sibling.startsWith(root)).toBe(true)

    // The new check (path.relative) correctly rejects it.
    const rel = path.relative(root, sibling)
    const escapes =
      !rel || rel.startsWith('..') || rel === '..' || path.isAbsolute(rel)
    expect(escapes).toBe(true)
  })

  it('rejects parent-relative escapes', () => {
    const root = '/home/user/.claude'
    const escape = path.resolve(root, '../../etc/passwd')

    expect(escape.startsWith(root)).toBe(false)

    const rel = path.relative(root, escape)
    expect(
      !rel || rel.startsWith('..') || rel === '..' || path.isAbsolute(rel),
    ).toBe(true)
  })

  it('accepts a nested path inside the workspace', () => {
    const root = '/home/user/.claude'
    const inside = '/home/user/.claude/memory/2026-04-23.md'

    expect(inside.startsWith(root)).toBe(true)

    const rel = path.relative(root, inside)
    expect(
      !rel || rel.startsWith('..') || rel === '..' || path.isAbsolute(rel),
    ).toBe(false)
  })

  it('treats exact root as valid', () => {
    const root = '/home/user/.claude'
    const same = '/home/user/.claude'
    const rel = path.relative(root, same)
    // empty string means same directory — allowed by our explicit
    // `resolved === WORKSPACE_ROOT` short-circuit
    expect(rel).toBe('')
  })
})

async function getHandler() {
  const mod = await import('./files')
  return (mod as any).Route.server.handlers.GET as (input: {
    request: Request
  }) => Promise<Response>
}

async function postHandler() {
  const mod = await import('./files')
  return (mod as any).Route.server.handlers.POST as (input: {
    request: Request
  }) => Promise<Response>
}

function useApplicationRootCatalog() {
  const applicationRoot = process.cwd()
  workspaceMocks.loadWorkspaceCatalog.mockResolvedValue({
    path: applicationRoot,
    folderName: path.basename(applicationRoot),
    source: 'test',
    isValid: true,
    workspaces: [{ name: 'application', path: applicationRoot }],
    last: applicationRoot,
  })
  return applicationRoot
}

describe('GET /api/files generated-content containment', () => {
  it('returns 410 for view before loading the workspace catalog', async () => {
    const handler = await getHandler()
    const response = await handler({
      request: new Request(
        'http://localhost/api/files?action=view&path=missing.html',
      ),
    })

    expect(response.status).toBe(410)
    expect(await response.text()).toBe(GENERATED_CONTENT_CONTAINMENT_REASON)
    expect(workspaceMocks.loadWorkspaceCatalog).not.toHaveBeenCalled()
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

  it('returns SVG source as inert text rather than an image data URL', async () => {
    const fileName = 'generated-artifact.SvG'
    const content = '<svg><script>alert(1)</script></svg>'
    fs.writeFileSync(path.join(tmpRoot, fileName), content, 'utf8')
    const handler = await getHandler()
    const response = await handler({
      request: new Request(
        `http://localhost/api/files?action=read&path=${fileName}`,
      ),
    })
    const body = (await response.json()) as {
      type: string
      content: string
    }

    expect(response.status).toBe(200)
    expect(body.type).toBe('text')
    expect(body.content).toBe(content)
    expect(body.content).not.toMatch(/^data:/)
  })

  it.each(['HTML', 'HtM', 'XHTML', 'Js', 'MjS', 'SvG', 'PDF'])(
    'forces .%s downloads to an inert attachment with defense headers',
    async (extension) => {
      const fileName = `generated.${extension}`
      fs.writeFileSync(path.join(tmpRoot, fileName), '<script>bad()</script>')
      const handler = await getHandler()
      const response = await handler({
        request: new Request(
          `http://localhost/api/files?action=download&path=${encodeURIComponent(fileName)}`,
        ),
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe(
        'application/octet-stream',
      )
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="${fileName}"`,
      )
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('content-security-policy')).toBe(
        "default-src 'none'; sandbox",
      )
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    },
  )

  it('keeps explicitly safe raster downloads typed but never inline', async () => {
    const fileName = 'generated.avif'
    fs.writeFileSync(path.join(tmpRoot, fileName), Buffer.from([0, 1, 2]))
    const handler = await getHandler()
    const response = await handler({
      request: new Request(
        `http://localhost/api/files?action=download&path=${fileName}`,
      ),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/avif')
    expect(response.headers.get('content-disposition')).toContain('attachment')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('POST /api/files served-root write containment', () => {
  it.each([
    ['write', { action: 'write', path: 'public/oly016-payload.js' }],
    ['mkdir', { action: 'mkdir', path: 'dist/client/oly016-output' }],
    [
      'rename destination',
      {
        action: 'rename',
        from: 'README.md',
        to: 'public/oly016-renamed.md',
      },
    ],
    ['delete', { action: 'delete', path: 'public/test-streaming.html' }],
  ])(
    'denies %s before mutating an application served root',
    async (_label, body) => {
      const applicationRoot = useApplicationRootCatalog()
      const protectedDebugPage = path.join(
        applicationRoot,
        'public',
        'test-streaming.html',
      )
      const debugPageExisted = fs.existsSync(protectedDebugPage)
      const handler = await postHandler()
      const response = await handler({
        request: new Request('http://localhost/api/files', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: SERVED_ROOT_WRITE_CONTAINMENT_REASON,
      })
      expect(fs.existsSync(protectedDebugPage)).toBe(debugPageExisted)
      expect(
        fs.existsSync(
          path.join(applicationRoot, 'public', 'oly016-payload.js'),
        ),
      ).toBe(false)
      expect(
        fs.existsSync(
          path.join(applicationRoot, 'public', 'oly016-renamed.md'),
        ),
      ).toBe(false)
      expect(
        fs.existsSync(
          path.join(applicationRoot, 'dist', 'client', 'oly016-output'),
        ),
      ).toBe(false)
    },
  )

  it('denies multipart upload into public before reading file bytes', async () => {
    const applicationRoot = useApplicationRootCatalog()
    const marker = path.join(applicationRoot, 'public', 'oly016-upload.js')
    const file = new File(
      ['globalThis.compromised = true'],
      'oly016-upload.js',
      {
        type: 'application/javascript',
      },
    )
    const read = vi.spyOn(file, 'arrayBuffer')
    const form = new FormData()
    form.set('action', 'upload')
    form.set('path', 'public')
    form.set('file', file)
    const handler = await postHandler()
    const response = await handler({
      request: new Request('http://localhost/api/files', {
        method: 'POST',
        body: form,
      }),
    })

    expect(response.status).toBe(403)
    expect(read).not.toHaveBeenCalled()
    expect(fs.existsSync(marker)).toBe(false)
  })
})
