import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type StaticClassification = {
  action: 'app' | 'deny' | 'static'
  pathname?: string
  relativePath?: string
  status?: number
  headers?: Record<string, string>
  reason?: string
  immutable?: boolean
}

const staticFilePolicy = createRequire(import.meta.url)(
  '../../server/static-file-policy.cjs',
) as {
  INERT_STATIC_HEADERS: Record<string, string>
  STATIC_CONTENT_CONTAINMENT_REASON: string
  STATIC_FILE_CONTAINMENT_REASON: string
  STATIC_FILE_DENIAL_HEADERS: Record<string, string>
  classifyStaticRequest: (
    rawUrl: string,
    method?: string,
  ) => StaticClassification
  isApprovedPublicAssetPath: (rawUrl: string) => boolean
  resolveContainedStaticPath: (root: string, pathname: string) => string | null
}

const {
  INERT_STATIC_HEADERS,
  STATIC_CONTENT_CONTAINMENT_REASON,
  STATIC_FILE_CONTAINMENT_REASON,
  STATIC_FILE_DENIAL_HEADERS,
  classifyStaticRequest,
  isApprovedPublicAssetPath,
  resolveContainedStaticPath,
} = staticFilePolicy

describe('static file containment policy', () => {
  it('exports one stable denial reason and inert header contract', () => {
    expect(STATIC_CONTENT_CONTAINMENT_REASON).toBe(
      STATIC_FILE_CONTAINMENT_REASON,
    )
    expect(INERT_STATIC_HEADERS).toMatchObject({
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    })
  })

  it.each([
    '/',
    '/chat',
    '/memory',
    '/settings/profile?tab=security',
    '/api',
    '/api/files',
    '/api/anything.svg',
    '/API/files.png',
    '/%41PI/files.png',
  ])('delegates application request %s without a static path', (url) => {
    expect(classifyStaticRequest(url, 'GET')).toMatchObject({ action: 'app' })
    expect(classifyStaticRequest(url, 'GET')).not.toHaveProperty('relativePath')
  })

  it('never handles non-GET/HEAD requests as static files', () => {
    expect(classifyStaticRequest('/logo.png', 'POST')).toMatchObject({
      action: 'app',
      pathname: '/logo.png',
    })
    expect(classifyStaticRequest('/logo.png', 'HEAD')).toMatchObject({
      action: 'static',
      pathname: '/logo.png',
    })
  })

  it.each([
    '/sw.js',
    '/SW.js',
    '/%73w.js',
    '/test-streaming.html',
    '/page.xhtml',
    '/logo.svg',
    '/feed.xml',
    '/style.xsl',
    '/style.xslt',
    '/guide.pdf',
    '/worker.js',
    '/worker.mjs',
    '/module.wasm',
    '/assets/not-hashed.js',
    '/assets/styles.css',
    '/archive.zip',
    '/README.md',
    '/.env',
    '/data.json',
    '/memory/secret.txt',
    '/.runtime/session.txt',
    '/.tanstack/state.txt',
    '/docs/screenshots/chat.png',
    '/screenshots/chat.png',
    '/test-results/result.txt',
    '/COVERAGE/result.txt',
  ])('denies executable or unapproved dotted path %s', (url) => {
    expect(classifyStaticRequest(url, 'GET')).toMatchObject({
      action: 'deny',
      status: 404,
      headers: STATIC_FILE_DENIAL_HEADERS,
      reason: STATIC_FILE_CONTAINMENT_REASON,
    })
  })

  it.each([
    '/assets/app-DYPRf3FO.js',
    '/assets/chunks/app.DYPRf3FO.js',
    '/assets/styles-DYPRf3FO.css',
  ])('allows generated hashed build asset %s', (url) => {
    expect(classifyStaticRequest(url, 'GET')).toMatchObject({
      action: 'static',
      pathname: url,
      relativePath: url.slice(1),
      immutable: true,
    })
  })

  it.each([
    '/logo.png',
    '/portrait.avif',
    '/providers/openai.webp',
    '/font.woff2',
    '/assets/hermesworld/video/hero-720p.mp4',
    '/assets/hermesworld/characters/player.glb',
    '/ascii-portraits/hermes.txt',
    '/robots.txt',
    '/manifest.json',
    '/assets/hermesworld/MANIFEST.json',
  ])('allows approved inert public asset %s', (url) => {
    expect(classifyStaticRequest(url, 'GET')).toMatchObject({
      action: 'static',
      pathname: url,
      relativePath: url.slice(1),
      immutable: false,
    })
    expect(isApprovedPublicAssetPath(url)).toBe(true)
  })

  it('does not approve executable-looking public files even when hash-shaped', () => {
    expect(classifyStaticRequest('/assets/app-DYPRf3FO.js', 'GET').action).toBe(
      'static',
    )
    expect(isApprovedPublicAssetPath('/assets/app-DYPRf3FO.js')).toBe(false)
    expect(isApprovedPublicAssetPath('/assets/styles-DYPRf3FO.css')).toBe(false)
    expect(isApprovedPublicAssetPath('/assets/module-DYPRf3FO.wasm')).toBe(
      false,
    )
    expect(isApprovedPublicAssetPath('/API/files.png')).toBe(false)
    expect(isApprovedPublicAssetPath('/%41PI/files.png')).toBe(false)
    expect(isApprovedPublicAssetPath('/SW.js')).toBe(false)
    expect(isApprovedPublicAssetPath('providers/openai.png')).toBe(true)
    expect(isApprovedPublicAssetPath('../secret.png')).toBe(false)
  })

  it.each([
    '/../secret.png',
    '/.%2e/secret.png',
    '/%2e%2e/secret.png',
    '/%252e%252e/secret.png',
    '/assets%2fsecret.png',
    '/assets\\secret.png',
    '/assets/%5csecret.png',
    '/assets/%00secret.png',
    '/assets/%E0%A4%A.png',
    '//other-host/logo.png',
    '/assets//logo.png',
    '/assets/./logo.png',
  ])('denies malformed or ambiguous request target %s', (url) => {
    expect(classifyStaticRequest(url, 'GET')).toMatchObject({
      action: 'deny',
      reason: STATIC_FILE_CONTAINMENT_REASON,
    })
    expect(isApprovedPublicAssetPath(url)).toBe(false)
  })

  it('resolves only validated paths under the configured root', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'static-root-policy-'))
    const root = join(fixture, 'client')
    const outside = join(fixture, 'outside')
    mkdirSync(join(root, 'assets'), { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(root, 'assets', 'logo.png'), 'safe')
    writeFileSync(join(outside, 'secret.png'), 'secret')
    symlinkSync(outside, join(root, 'linked-outside'))

    try {
      expect(resolveContainedStaticPath(root, '/assets/logo.png')).toBe(
        realpathSync(resolve(root, 'assets/logo.png')),
      )
      expect(resolveContainedStaticPath(root, '/../secret.png')).toBeNull()
      expect(resolveContainedStaticPath(root, '/%2e%2e/secret.png')).toBeNull()
      expect(resolveContainedStaticPath(root, '/')).toBeNull()
      expect(resolveContainedStaticPath(root, '/missing.png')).toBeNull()
      expect(
        resolveContainedStaticPath(root, '/linked-outside/secret.png'),
      ).toBeNull()
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('ships the helper with every production adapter', () => {
    const serverEntry = readFileSync(
      new URL('../../server-entry.js', import.meta.url),
      'utf8',
    )
    expect(serverEntry).toContain("'./server/static-file-policy.cjs'")
    expect(serverEntry).toContain('classifyStaticRequest(')
    expect(serverEntry).toContain('resolveContainedStaticPath(')
    const nodeStaticAdapter = serverEntry.slice(
      serverEntry.indexOf('async function tryServeStatic'),
      serverEntry.indexOf('async function requestHandler'),
    )
    expect(nodeStaticAdapter.indexOf('classifyStaticRequest(')).toBeLessThan(
      nodeStaticAdapter.indexOf('await stat(filePath)'),
    )
    expect(nodeStaticAdapter.indexOf('classifyStaticRequest(')).toBeLessThan(
      nodeStaticAdapter.indexOf('await readFile(filePath)'),
    )

    const desktopAdapter = readFileSync(
      new URL('../../electron/prod-server.cjs', import.meta.url),
      'utf8',
    )
    expect(desktopAdapter).toContain("'../server/static-file-policy.cjs'")
    expect(desktopAdapter).toContain('classifyStaticRequest(')
    expect(desktopAdapter).toContain('resolveContainedStaticPath(')
    const electronStaticAdapter = desktopAdapter.slice(
      desktopAdapter.indexOf('const server = http.createServer'),
      desktopAdapter.indexOf('try {\n      const headers = new Headers()'),
    )
    expect(
      electronStaticAdapter.indexOf('classifyStaticRequest('),
    ).toBeLessThan(electronStaticAdapter.indexOf('fs.statSync(filePath)'))
    expect(
      electronStaticAdapter.indexOf('classifyStaticRequest('),
    ).toBeLessThan(electronStaticAdapter.indexOf('fs.readFileSync(filePath)'))

    const dockerfile = readFileSync(
      new URL('../../Dockerfile', import.meta.url),
      'utf8',
    )
    expect(dockerfile).toContain(
      '/app/server/static-file-policy.cjs ./server/static-file-policy.cjs',
    )

    const nixPackage = readFileSync(
      new URL('../../nix/package.nix', import.meta.url),
      'utf8',
    )
    expect(nixPackage).toContain('server/static-file-policy.cjs')

    const electronBuilder = readFileSync(
      new URL('../../electron-builder.config.cjs', import.meta.url),
      'utf8',
    )
    expect(electronBuilder).toContain("'server/static-file-policy.cjs'")
    expect(electronBuilder).not.toContain("'public/**/*'")
  })
})
