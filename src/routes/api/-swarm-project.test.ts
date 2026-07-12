import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  profilesDir: '',
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: unknown) => options,
}))

vi.mock('node:child_process', () => {
  return {
    execFileSync: mocks.execFileSync,
  }
})

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

vi.mock('../../server/claude-paths', () => ({
  getProfilesDir: () => mocks.profilesDir,
}))

let tempRoot = ''

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-project-route-'))
  mocks.profilesDir = path.join(tempRoot, 'profiles')
  mocks.execFileSync.mockReset()
  mocks.execFileSync.mockImplementation((_command, args) =>
    Array.isArray(args) && args.includes('rev-parse') ? 'main\n' : '',
  )
  vi.stubGlobal('fetch', vi.fn())
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

async function getHandler() {
  const mod = await import('./swarm-project')
  return (mod as any).Route.server.handlers.GET as (input: {
    request: Request
  }) => Promise<Response>
}

describe('GET /api/swarm-project preview containment', () => {
  it('ignores runtime URLs and ports without fetch or lsof discovery', async () => {
    const projectDir = path.join(tempRoot, 'generated-app')
    const profileDir = path.join(mocks.profilesDir, 'builder')
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true })
    fs.mkdirSync(profileDir, { recursive: true })
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'vite --port 5173', test: 'vitest' } }),
    )
    fs.writeFileSync(
      path.join(projectDir, 'vite.config.ts'),
      'export default {}',
    )
    fs.writeFileSync(
      path.join(profileDir, 'runtime.json'),
      JSON.stringify({
        cwd: projectDir,
        previewUrls: [
          'javascript:alert(1)',
          'data:text/html,<script>alert(1)</script>',
          'blob:http://localhost:5173/private-id',
          './relative-preview',
          'http://localhost:5173/private',
          'http://127.0.0.1:5173/private',
          'https://example.test/preview',
        ],
        previewPort: 5173,
      }),
    )

    const handler = await getHandler()
    const response = await handler({
      request: new Request(
        'http://localhost/api/swarm-project?workerId=builder',
      ),
    })
    const body = (await response.json()) as {
      previewUrls: Array<string>
      previewSource: string
      packageScripts: Array<string>
    }

    expect(response.status).toBe(200)
    expect(body.previewUrls).toEqual([])
    expect(body.previewSource).toBe('none')
    expect(body.packageScripts).toEqual(['dev', 'test'])
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.execFileSync).toHaveBeenCalledTimes(2)
    expect(
      mocks.execFileSync.mock.calls.every(([command]) => command === 'git'),
    ).toBe(true)
  })

  it('contains no preview probing or port-ownership implementation', () => {
    const source = fs.readFileSync(
      new URL('./swarm-project.ts', import.meta.url),
      'utf8',
    )

    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).not.toMatch(/\blsof\b/)
    expect(source).not.toMatch(/\bpreviewPort\b/)
    expect(source).not.toMatch(/\bprobePort\b/)
    expect(source).not.toMatch(/\bdetectPreviewUrls\b/)
    expect(source).toContain('previewUrls: []')
    expect(source).toContain("previewSource: 'none'")
  })
})
