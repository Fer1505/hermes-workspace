import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  copyApprovedPublicAssets,
  createStaticContainmentMiddleware,
  isGeneratedClientAssetPath,
  isViteDevelopmentModulePath,
} from '../vite.config'

type StaticPolicyForTest = {
  classifyStaticRequest: (
    rawUrl: string,
    method?: string,
  ) => {
    action: 'deny' | 'app' | 'static'
    status?: number
    headers?: Readonly<Record<string, string>>
  }
  isApprovedPublicAssetPath: (relativePath: string) => boolean
}

const loadCommonJsModule = createRequire(import.meta.url)
const { classifyStaticRequest, isApprovedPublicAssetPath } = loadCommonJsModule(
  '../server/static-file-policy.cjs',
) as StaticPolicyForTest

const temporaryDirectories: Array<string> = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function makeTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-static-'))
  temporaryDirectories.push(directory)
  return directory
}

function writeFixture(
  root: string,
  relativePath: string,
  value = relativePath,
) {
  const target = join(root, relativePath)
  mkdirSync(resolve(target, '..'), { recursive: true })
  writeFileSync(target, value)
}

function invokeMiddleware(
  rawUrl: string,
  { allowDevelopmentModules = false, method = 'GET' } = {},
) {
  const headers = new Map<string, unknown>()
  let ended: unknown = false
  let nextCalls = 0
  let destroyed = false
  const request = { method, url: rawUrl }
  const response = {
    statusCode: 0,
    setHeader(name: string, value: unknown) {
      headers.set(name.toLowerCase(), value)
    },
    end(body?: unknown) {
      ended = body ?? true
    },
    destroy() {
      destroyed = true
    },
  }

  createStaticContainmentMiddleware({ allowDevelopmentModules })(
    request as never,
    response as never,
    () => {
      nextCalls += 1
    },
  )

  return { destroyed, ended, headers, nextCalls, response }
}

describe('Vite static request containment', () => {
  it.each([
    '/.runtime/tool-artifacts/index.txt',
    '/.tanstack/tmp/route.txt',
    '/memory/private.txt',
    '/docs/screenshots/chat.png',
    '/screenshots/capture.png',
    '/coverage/report.txt',
    '/playwright-report/report.txt',
    '/test-results/result.txt',
    '/test-streaming.html',
    '/favicon.svg',
    '/sw.js',
    '/SW.js',
    '/%2e%2e/.runtime/private.txt',
    '/memory/%252e%252e/private.txt',
  ])('denies protected, executable, or malformed path %s', (rawUrl) => {
    const classification = classifyStaticRequest(rawUrl, 'GET')

    expect(classification.action).toBe('deny')
    expect(classification.status).toBe(404)
    expect(classification.headers).toMatchObject({
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    })
  })

  it('delegates application routes while preventing public files from shadowing APIs', () => {
    expect(classifyStaticRequest('/', 'GET').action).toBe('app')
    expect(classifyStaticRequest('/memory', 'GET').action).toBe('app')
    expect(classifyStaticRequest('/api/files.png', 'GET').action).toBe('app')
    expect(classifyStaticRequest('/API/files.png', 'GET').action).toBe('app')
    expect(classifyStaticRequest('/%41PI/files.png', 'GET').action).toBe('app')
    expect(isApprovedPublicAssetPath('api/files.png')).toBe(false)
    expect(isApprovedPublicAssetPath('API/files.png')).toBe(false)
  })

  it('separates trusted build output from reviewed inert public assets', () => {
    expect(isGeneratedClientAssetPath('assets/index-CW24ROA5.js')).toBe(true)
    expect(isGeneratedClientAssetPath('assets/index-CW24ROA5.css')).toBe(true)
    expect(isGeneratedClientAssetPath('assets/payload.js')).toBe(false)
    expect(isApprovedPublicAssetPath('assets/index-CW24ROA5.js')).toBe(false)
    expect(isApprovedPublicAssetPath('avatars/hermes.png')).toBe(true)
    expect(isApprovedPublicAssetPath('screenshots/chat.png')).toBe(false)
  })

  it('allows only Vite module namespaces in development mode', () => {
    expect(isViteDevelopmentModulePath('/@vite/client')).toBe(true)
    expect(isViteDevelopmentModulePath('/@id/virtual:route')).toBe(true)
    expect(
      isViteDevelopmentModulePath('/node_modules/.vite/deps/react.js'),
    ).toBe(true)
    expect(isViteDevelopmentModulePath('/src/router.tsx')).toBe(true)
    expect(isViteDevelopmentModulePath('/src/payload.html')).toBe(false)
    expect(isViteDevelopmentModulePath('/src/logo.svg')).toBe(false)
    expect(isViteDevelopmentModulePath('/@fs/private.txt')).toBe(false)

    expect(
      invokeMiddleware('/src/router.tsx', {
        allowDevelopmentModules: true,
      }).nextCalls,
    ).toBe(1)
    expect(
      invokeMiddleware('/src/router.tsx', {
        allowDevelopmentModules: false,
      }).nextCalls,
    ).toBe(0)
    expect(invokeMiddleware('/@fs/private.txt').nextCalls).toBe(0)
    expect(
      invokeMiddleware('/src/logo.svg', {
        allowDevelopmentModules: true,
      }).nextCalls,
    ).toBe(0)
  })

  it('passes application and hashed build requests but emits inert denials', () => {
    expect(invokeMiddleware('/api/files').nextCalls).toBe(1)
    expect(invokeMiddleware('/assets/index-CW24ROA5.js').nextCalls).toBe(1)

    const denied = invokeMiddleware('/test-streaming.html')
    expect(denied.nextCalls).toBe(0)
    expect(denied.response.statusCode).toBe(404)
    expect(denied.headers.get('content-security-policy')).toBe(
      "default-src 'none'; sandbox",
    )
    expect(denied.headers.get('cache-control')).toContain('no-store')
    expect(denied.ended).toBeTruthy()
  })

  it('serves an approved public asset with an exact inert MIME boundary', () => {
    const served = invokeMiddleware('/claude-avatar.webp', { method: 'HEAD' })

    expect(served.nextCalls).toBe(0)
    expect(served.response.statusCode).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/webp')
    expect(served.headers.get('cache-control')).toBe('no-store')
    expect(served.headers.get('x-content-type-options')).toBe('nosniff')
    expect(served.ended).toBeTruthy()
  })
})

describe('Vite public output containment', () => {
  it('copies only approved inert public assets', () => {
    const sourceRoot = makeTemporaryDirectory()
    const destinationRoot = makeTemporaryDirectory()

    writeFixture(sourceRoot, 'avatars/hermes.png', 'png')
    writeFixture(sourceRoot, 'ascii-portraits/hermes.txt', 'portrait')
    writeFixture(sourceRoot, 'manifest.json', '{"name":"Hermes"}')
    writeFixture(sourceRoot, 'screenshots/private.png', 'screenshot')
    writeFixture(sourceRoot, 'favicon.svg', '<svg/>')
    writeFixture(sourceRoot, 'sw.js', 'self.addEventListener("fetch",()=>{})')
    writeFixture(
      sourceRoot,
      'test-streaming.html',
      '<script>fetch("/api")</script>',
    )

    const copied = copyApprovedPublicAssets(sourceRoot, destinationRoot)

    expect(copied.sort()).toEqual([
      'ascii-portraits/hermes.txt',
      'avatars/hermes.png',
      'manifest.json',
    ])
    expect(
      readFileSync(join(destinationRoot, 'avatars/hermes.png'), 'utf8'),
    ).toBe('png')
    expect(existsSync(join(destinationRoot, 'screenshots/private.png'))).toBe(
      false,
    )
    expect(existsSync(join(destinationRoot, 'favicon.svg'))).toBe(false)
    expect(existsSync(join(destinationRoot, 'sw.js'))).toBe(false)
    expect(existsSync(join(destinationRoot, 'test-streaming.html'))).toBe(false)
  })

  it('wires pre-dev/pre-preview containment, finite hosts, and client-only copying', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'vite.config.ts'),
      'utf8',
    )

    expect(source).toContain("name: 'static-content-containment'")
    expect(source).toContain("enforce: 'pre'")
    expect(source).toContain('configureServer(server)')
    expect(source).toContain('configurePreviewServer(server)')
    expect(source).toContain('publicDir: false')
    expect(source.match(/allowedHosts,/g)).toHaveLength(2)
    expect(source).not.toContain('allowedHosts: true')
    expect(source).toContain("this.environment?.name !== 'client'")
    expect(source).toContain('copyApprovedPublicAssets(PUBLIC_ASSET_ROOT')
    expect(source).not.toContain('/api/workspace/daemon/restart')
    expect(source).not.toContain('restartWorkspaceDaemon')
  })

  it('keeps runtime source references on raster assets', () => {
    const runtimeSources = [
      'src/routes/early-access.tsx',
      'src/screens/playground/hermes-world-embed.tsx',
      'src/screens/playground/hermes-world-landing.tsx',
      'src/screens/playground/playground-screen.tsx',
    ].map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'))

    for (const source of runtimeSources) {
      expect(source).not.toMatch(/(?:src|href)=["'][^"']+\.svg["']/)
    }
    expect(runtimeSources.join('\n')).toContain('hermesworld-app-icon.png')
    expect(runtimeSources.join('\n')).toContain(
      'hermesworld-logo-horizontal.png',
    )
  })
})
