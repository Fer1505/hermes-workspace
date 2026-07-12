import { URL, fileURLToPath } from 'node:url'
import { execSync, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import {
  copyFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
} from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import net from 'node:net'
import { resolve, dirname, sep } from 'node:path'
import os from 'node:os'

// devtools removed
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// nitro plugin removed (tanstackStart handles server runtime)
import { defineConfig, loadEnv } from 'vite'
import viteTsConfigPaths from 'vite-tsconfig-paths'

type StaticRequestClassification = {
  action: 'deny' | 'app' | 'static'
  pathname?: string
  relativePath?: string
  status?: number
  headers?: Readonly<Record<string, string>>
  reason?: string
  contentType?: string
  immutable?: boolean
}

type StaticFilePolicy = {
  STATIC_CONTENT_CONTAINMENT_REASON: string
  INERT_STATIC_HEADERS: Readonly<Record<string, string>>
  classifyStaticRequest: (
    rawUrl: string,
    method?: string,
  ) => StaticRequestClassification
  isApprovedPublicAssetPath: (relativePath: string) => boolean
  resolveContainedStaticPath: (root: string, pathname: string) => string | null
}

const loadCommonJsModule = createRequire(import.meta.url)
const {
  STATIC_CONTENT_CONTAINMENT_REASON,
  INERT_STATIC_HEADERS,
  classifyStaticRequest,
  isApprovedPublicAssetPath,
  resolveContainedStaticPath,
} = loadCommonJsModule('./server/static-file-policy.cjs') as StaticFilePolicy

const PUBLIC_ASSET_ROOT = fileURLToPath(new URL('./public/', import.meta.url))
const GENERATED_CLIENT_ASSET_PATTERN = new RegExp(
  '^assets/(?:[^/]+/)*[^/]+[-._][A-Za-z0-9_-]{8,}\\.(?:css|js)$',
  'i',
)

type ContainmentMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => void

function isContainedPath(candidate: string, root: string): boolean {
  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(candidate)
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
  )
}

export function isGeneratedClientAssetPath(relativePath: string): boolean {
  return GENERATED_CLIENT_ASSET_PATTERN.test(relativePath)
}

export function isViteDevelopmentModulePath(
  pathname: string | undefined,
): boolean {
  if (!pathname) return false
  const isCompiledDependency =
    pathname.startsWith('/node_modules/.vite/') &&
    /\.(?:css|js)$/i.test(pathname)
  const isWorkspaceSourceModule =
    pathname.startsWith('/src/') && /\.(?:css|js|jsx|ts|tsx)$/i.test(pathname)
  return (
    pathname === '/@react-refresh' ||
    pathname.startsWith('/@vite/') ||
    pathname.startsWith('/@id/') ||
    isCompiledDependency ||
    isWorkspaceSourceModule
  )
}

function applyResponseHeaders(
  response: ServerResponse,
  headers: Readonly<Record<string, string>>,
): void {
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value)
  }
}

function rejectStaticRequest(
  request: IncomingMessage,
  response: ServerResponse,
  classification: StaticRequestClassification,
): void {
  const body = STATIC_CONTENT_CONTAINMENT_REASON
  response.statusCode = classification.status ?? 404
  applyResponseHeaders(response, INERT_STATIC_HEADERS)
  if (classification.headers) {
    applyResponseHeaders(response, classification.headers)
  }
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(request.method === 'HEAD' ? undefined : body)
}

function serveApprovedPublicAsset(
  request: IncomingMessage,
  response: ServerResponse,
  classification: StaticRequestClassification,
): boolean {
  const relativePath = classification.relativePath
  if (!relativePath || !isApprovedPublicAssetPath(relativePath)) return false

  const filePath = resolveContainedStaticPath(
    PUBLIC_ASSET_ROOT,
    classification.pathname || `/${relativePath}`,
  )
  if (!filePath) return false

  try {
    const fileStat = lstatSync(filePath)
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) return false

    const contentType = classification.contentType
    if (!contentType) return false

    applyResponseHeaders(response, INERT_STATIC_HEADERS)
    if (classification.headers) {
      applyResponseHeaders(response, classification.headers)
    }
    response.statusCode = 200
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', contentType)
    response.setHeader('Content-Length', fileStat.size)

    if (request.method === 'HEAD') {
      response.end()
      return true
    }

    const stream = createReadStream(filePath)
    stream.once('error', () => response.destroy())
    stream.pipe(response)
    return true
  } catch {
    return false
  }
}

export function createStaticContainmentMiddleware({
  allowDevelopmentModules,
}: {
  allowDevelopmentModules: boolean
}): ContainmentMiddleware {
  return (request, response, next) => {
    const rawUrl = request.url || '/'
    const classification = classifyStaticRequest(rawUrl, request.method)

    if (
      allowDevelopmentModules &&
      isViteDevelopmentModulePath(classification.pathname)
    ) {
      next()
      return
    }

    if (classification.action === 'app') {
      next()
      return
    }

    if (
      classification.action === 'static' &&
      classification.relativePath &&
      isGeneratedClientAssetPath(classification.relativePath)
    ) {
      next()
      return
    }

    if (
      classification.action === 'static' &&
      serveApprovedPublicAsset(request, response, classification)
    ) {
      return
    }

    rejectStaticRequest(request, response, classification)
  }
}

export function copyApprovedPublicAssets(
  sourceRoot: string,
  destinationRoot: string,
): Array<string> {
  const resolvedSourceRoot = resolve(sourceRoot)
  const resolvedDestinationRoot = resolve(destinationRoot)
  const copied: Array<string> = []

  if (!existsSync(resolvedSourceRoot)) return copied

  const visit = (directory: string, relativeDirectory = ''): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name
      const sourcePath = resolve(directory, entry.name)

      if (entry.isDirectory()) {
        visit(sourcePath, relativePath)
        continue
      }

      if (!entry.isFile() || !isApprovedPublicAssetPath(relativePath)) continue

      const destinationPath = resolve(resolvedDestinationRoot, relativePath)
      if (!isContainedPath(destinationPath, resolvedDestinationRoot)) continue

      mkdirSync(dirname(destinationPath), { recursive: true })
      copyFileSync(sourcePath, destinationPath)
      copied.push(relativePath)
    }
  }

  visit(resolvedSourceRoot)
  return copied
}

// ---------------------------------------------------------------------------
// Hermes Agent auto-start helpers
// ---------------------------------------------------------------------------

/** Resolve the hermes-agent directory using a priority-ordered fallback chain:
 *  1. HERMES_AGENT_PATH env var (explicit override)
 *  2. CLAUDE_AGENT_PATH env var (legacy override)
 *  3. ../hermes-agent  — sibling clone (standard README setup)
 *  4. ../../hermes-agent — one level up (monorepo / nested workspace)
 *  Returns null if none found.
 */
function resolveClaudeAgentDir(env: Record<string, string>): string | null {
  const candidates: string[] = []

  const explicitAgentPath =
    env.HERMES_AGENT_PATH?.trim() || env.CLAUDE_AGENT_PATH?.trim()
  if (explicitAgentPath) {
    candidates.push(explicitAgentPath)
  }

  // Resolve relative to the workspace root (parent of hermes-workspace/)
  const workspaceRoot = dirname(resolve('.'))
  candidates.push(
    resolve(workspaceRoot, 'hermes-agent'), // sibling (old README)
    resolve(workspaceRoot, '..', 'hermes-agent'), // one level up
    resolve(os.homedir(), '.hermes', 'hermes-agent'), // Nous installer default
    resolve(os.homedir(), '.claude', 'hermes-agent'), // Nous installer default
    resolve(os.homedir(), 'hermes-agent'), // ~/hermes-agent
  )

  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, 'webapi'))) return candidate
  }
  return null
}

/** Find the Hermes CLI binary used to start the local gateway. */
function resolveCommandPath(command: string): string | null {
  try {
    const resolved = execSync(`command -v ${command}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return resolved || null
  } catch {
    return null
  }
}

function resolveClaudeBinary(): string | null {
  const candidates = [
    process.env.HERMES_CLI_BIN || '',
    resolveCommandPath('hermes') || '',
    resolve(os.homedir(), '.hermes', 'bin', 'hermes'),
    resolve(os.homedir(), '.local', 'bin', 'hermes'),
    process.env.CLAUDE_CLI_BIN || '',
    resolveCommandPath('claude') || '',
    resolve(os.homedir(), '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes'),
    resolve(os.homedir(), '.claude', 'bin', 'claude'),
    resolve(os.homedir(), '.local', 'bin', 'claude'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return ''
}

function isEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function resolveGatewayBindHost(env: Record<string, string>): string {
  return (
    firstNonEmpty(
      env.API_SERVER_HOST,
      process.env.API_SERVER_HOST,
      env.HERMES_GATEWAY_BIND_HOST,
      process.env.HERMES_GATEWAY_BIND_HOST,
    ) || '127.0.0.1'
  )
}

function parseAllowedHosts(value: string | undefined): string[] {
  return value?.trim()
    ? value
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean)
    : []
}

/** Resolve the Python executable to use for Hermes backend startup.
 *  Prefers .venv/bin/python inside agentDir, falls back to system python3.
 */
function resolveClaudePython(agentDir: string): string {
  const venvPython = resolve(agentDir, '.venv', 'bin', 'python')
  if (existsSync(venvPython)) return venvPython
  // uv creates 'venv' not '.venv' sometimes
  const uvVenv = resolve(agentDir, 'venv', 'bin', 'python')
  if (existsSync(uvVenv)) return uvVenv
  return 'python3'
}

/** Check if hermes-agent health endpoint is responding */
async function isClaudeAgentHealthy(port = 8642): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return r.ok
  } catch {
    return false
  }
}

const config = defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Bridge loadEnv into process.env for server-side SSR runtime code that
  // reads env vars directly from process.env (e.g. getBearerToken() in
  // openai-compat-api.ts reads process.env.HERMES_API_TOKEN). Without this,
  // Vite's loadEnv only populates the local `env` object — not process.env.
  for (const key of Object.keys(env)) {
    if (!(key in process.env)) {
      process.env[key] = env[key]
    }
  }
  const claudeApiUrl =
    env.HERMES_API_URL?.trim() ||
    env.CLAUDE_API_URL?.trim() ||
    'http://127.0.0.1:8642'
  // /api/connection-status is handled by the real route file at
  // src/routes/api/connection-status.ts; the dev server no longer
  // intercepts that path with a slim shortcut. See #285.

  // Hermes Agent auto-start state
  let claudeAgentChild: ChildProcess | null = null
  let claudeAgentStarted = false

  const startClaudeAgent = async () => {
    if (claudeAgentStarted) return
    // Skip auto-start when HERMES_API_URL/CLAUDE_API_URL points at an
    // external backend.
    const explicitUrl =
      env.HERMES_API_URL ||
      process.env.HERMES_API_URL ||
      env.CLAUDE_API_URL ||
      process.env.CLAUDE_API_URL ||
      claudeApiUrl ||
      ''
    if (
      explicitUrl &&
      explicitUrl !== 'http://127.0.0.1:8642' &&
      explicitUrl !== 'http://localhost:8642'
    ) {
      console.log(
        `[hermes-agent] Skipping auto-start — using external API: ${explicitUrl}`,
      )
      claudeAgentStarted = true
      return
    }
    if (await isClaudeAgentHealthy()) {
      console.log('[hermes-agent] Already running — reusing existing process')
      claudeAgentStarted = true
      return
    }

    const claudeBin = resolveClaudeBinary()
    const agentDir = resolveClaudeAgentDir(env)
    const gatewayBindHost = resolveGatewayBindHost(env)

    // Prefer the `hermes gateway run` binary path (Nous installer's canonical
    // entrypoint). Fall back to launching uvicorn against the source tree if
    // only a directory is present (dev / cloned-in-place setups).
    let launchCmd: string
    let commandArgs: string[]
    let launchCwd: string | undefined

    if (claudeBin) {
      launchCmd = claudeBin
      commandArgs = ['gateway', 'run']
      launchCwd = agentDir ?? undefined
      console.log(`[hermes-agent] Starting ${claudeBin} gateway run`)
    } else if (agentDir) {
      launchCmd = resolveClaudePython(agentDir)
      const useGatewayRun = existsSync(resolve(agentDir, 'gateway', 'run.py'))
      commandArgs = useGatewayRun
        ? ['-m', 'gateway.run']
        : [
            '-m',
            'uvicorn',
            'webapi.app:app',
            '--host',
            gatewayBindHost,
            '--port',
            '8642',
          ]
      launchCwd = agentDir
      console.log(
        `[hermes-agent] Starting from ${agentDir} using ${launchCmd} (${useGatewayRun ? 'gateway.run' : 'uvicorn'})`,
      )
    } else {
      console.warn(
        '[hermes-agent] Could not find hermes-agent installation.\n' +
          '  Run the installer:\n' +
          '    curl -fsSL https://hermes-workspace.com/install.sh | bash\n' +
          '  Or set HERMES_AGENT_PATH (or legacy CLAUDE_AGENT_PATH) in .env to point at your hermes-agent clone.',
      )
      return
    }

    const child = spawn(launchCmd, commandArgs, {
      cwd: launchCwd,
      detached: false, // keep tied to vite process — stops when dev server stops
      stdio: 'pipe',
      env: {
        ...process.env,
        API_SERVER_HOST: gatewayBindHost,
        PATH: [
          resolve(os.homedir(), '.claude', 'bin'),
          resolve(os.homedir(), '.hermes', 'bin'),
          resolve(os.homedir(), '.local', 'bin'),
          agentDir ? resolve(agentDir, '.venv', 'bin') : '',
          agentDir ? resolve(agentDir, 'venv', 'bin') : '',
          process.env.PATH || '',
        ]
          .filter(Boolean)
          .join(':'),
      },
    })

    claudeAgentChild = child
    claudeAgentStarted = true

    child.stdout?.on('data', (d: Buffer) => {
      const line = d.toString().trim()
      if (line) console.log(`[hermes-agent] ${line}`)
    })
    child.stderr?.on('data', (d: Buffer) => {
      const line = d.toString().trim()
      if (line) console.log(`[hermes-agent] ${line}`)
    })

    child.on('exit', (code) => {
      claudeAgentChild = null
      claudeAgentStarted = false
      if (code !== 0 && code !== null) {
        console.warn(`[hermes-agent] Exited with code ${code}`)
      }
    })

    // Wait for healthy
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      if (await isClaudeAgentHealthy()) {
        console.log('[hermes-agent] ✓ Ready on http://127.0.0.1:8642')
        return
      }
    }
    console.warn(
      '[hermes-agent] Started but health check timed out — may still be loading',
    )
  }

  let workspaceDaemonStarted = false
  let workspaceDaemonStarting = false
  let workspaceDaemonShuttingDown = false
  let workspaceDaemonChild: ChildProcess | null = null
  let workspaceDaemonRetryCount = 0
  const workspaceDaemonPort = '3099'
  const daemonCwd = resolve('workspace-daemon')
  const daemonSrcEntry = resolve('workspace-daemon/src/server.ts')
  const daemonDistEntry = resolve('workspace-daemon/dist/server.js')
  const workspaceDaemonDbPath = resolve(
    'workspace-daemon/.workspaces/workspace.db',
  )

  const getWorkspaceDaemonDelayMs = (attempt: number) =>
    Math.min(1000 * 2 ** Math.max(attempt - 1, 0), 30000)

  const startWorkspaceDaemon = () => {
    if (workspaceDaemonShuttingDown) return
    if (workspaceDaemonStarted || workspaceDaemonStarting) return

    const spawnCommand = existsSync(daemonSrcEntry)
      ? {
          commandName: 'npx',
          args: ['tsx', 'watch', 'src/server.ts'],
          options: {
            cwd: daemonCwd,
            env: {
              ...process.env,
              PORT: workspaceDaemonPort,
              DB_PATH: workspaceDaemonDbPath,
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
            },
            stdio: 'inherit' as const,
          },
        }
      : existsSync(daemonDistEntry)
        ? {
            commandName: 'node',
            args: ['dist/server.js'],
            options: {
              cwd: daemonCwd,
              env: {
                ...process.env,
                PORT: workspaceDaemonPort,
                DB_PATH: workspaceDaemonDbPath,
                ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
              },
              stdio: 'inherit' as const,
            },
          }
        : null

    if (!spawnCommand) {
      workspaceDaemonStarting = false
      console.error('[workspace-daemon] no server entry found to spawn.')
      return
    }

    workspaceDaemonStarted = true
    workspaceDaemonStarting = false
    const child = spawn(
      spawnCommand.commandName,
      spawnCommand.args,
      spawnCommand.options,
    )
    workspaceDaemonChild = child

    child.on('exit', (code) => {
      if (workspaceDaemonChild === child) {
        workspaceDaemonChild = null
      }

      if (workspaceDaemonShuttingDown) {
        workspaceDaemonStarted = false
        workspaceDaemonStarting = false
        return
      }

      if (code === 0) {
        workspaceDaemonStarted = false
        workspaceDaemonStarting = false
        return
      }

      if (workspaceDaemonRetryCount >= 20) {
        workspaceDaemonStarted = false
        workspaceDaemonStarting = false
        console.error(
          `[workspace-daemon] crashed with code ${code ?? 'unknown'}; max restart attempts reached.`,
        )
        return
      }

      workspaceDaemonRetryCount += 1
      const delayMs = getWorkspaceDaemonDelayMs(workspaceDaemonRetryCount)
      console.error(
        `[workspace-daemon] crashed with code ${code ?? 'unknown'}; restarting in ${Math.round(
          delayMs / 1000,
        )}s (${workspaceDaemonRetryCount}/20).`,
      )

      workspaceDaemonStarting = true
      workspaceDaemonStarted = false
      setTimeout(() => {
        startWorkspaceDaemon()
      }, delayMs)
    })

    child.on('error', (error) => {
      console.error(`[workspace-daemon] failed to spawn: ${error.message}`)
    })
  }

  const isPortInUse = (port: number) =>
    new Promise<boolean>((resolvePortCheck) => {
      const socket = net.createConnection({ port, host: '127.0.0.1' })
      socket.once('connect', () => {
        socket.destroy()
        resolvePortCheck(true)
      })
      socket.once('error', () => resolvePortCheck(false))
    })

  const hasHealthyWorkspaceDaemon = async () => {
    try {
      const response = await fetch(
        `http://127.0.0.1:${workspaceDaemonPort}/api/workspace/version`,
        {
          signal: AbortSignal.timeout(2000),
        },
      )
      return response.ok
    } catch {
      return false
    }
  }

  const devServerHost =
    firstNonEmpty(
      env.HERMES_DEV_SERVER_HOST,
      process.env.HERMES_DEV_SERVER_HOST,
      env.HOST,
      process.env.HOST,
    ) || '127.0.0.1'
  const allowAnyDevHost = isEnabled(
    env.HERMES_DEV_ALLOW_ANY_HOST || process.env.HERMES_DEV_ALLOW_ANY_HOST,
  )
  // Default to Vite's safe host checks. Remote/Tailscale/LAN dev access must
  // opt in with HERMES_ALLOWED_HOSTS/CLAUDE_ALLOWED_HOSTS, or the explicit
  // HERMES_DEV_ALLOW_ANY_HOST=1 escape hatch for trusted throwaway sessions.
  const allowedHostsValue = firstNonEmpty(
    env.HERMES_ALLOWED_HOSTS,
    process.env.HERMES_ALLOWED_HOSTS,
    env.CLAUDE_ALLOWED_HOSTS,
    process.env.CLAUDE_ALLOWED_HOSTS,
  )
  const allowedHosts: Array<string> | true = allowAnyDevHost
    ? true
    : parseAllowedHosts(allowedHostsValue)
  if (allowAnyDevHost) {
    console.warn(
      '[workspace] HERMES_DEV_ALLOW_ANY_HOST=1 disables Vite host checks. Use only on trusted networks.',
    )
  }
  let proxyTarget = 'http://127.0.0.1:18789'

  try {
    const parsed = new URL(claudeApiUrl)
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:'
    parsed.pathname = ''
    proxyTarget = parsed.toString().replace(/\/$/, '')
  } catch {
    // fallback
  }

  return {
    // Vite's implicit public-directory handling copied every file verbatim and
    // served it ahead of application routing. The containment plugin below is
    // now the only path from reviewed public assets to dev, preview, or client
    // output.
    publicDir: false,
    test: {
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/e2e/**',
        '**/skills-bundle/**',
        '**/.{idea,git,cache,output,temp}/**',
      ],
      // Force vitest to run React through its own transform pipeline so ESM
      // `import` and CJS `require('react')` share a single module instance.
      // Without this, react-dom sets the dispatcher on its CJS React copy while
      // components call hooks on the ESM React copy → null dispatcher → crash.
      deps: {
        inline: [
          'react',
          'react-dom',
          '@testing-library/react',
          '@testing-library/dom',
        ],
      },
    },
    define: {
      // Note: Do NOT set 'process.env': {} here — TanStack Start uses environment-based
      // builds where isSsrBuild is unreliable. Blanket process.env replacement breaks
      // server-side code in Docker (kills runtime env var access).
      // Client-side process.env is handled per-environment below.
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    ssr: {
      external: [
        'playwright',
        'playwright-core',
        'playwright-extra',
        'puppeteer-extra-plugin-stealth',
      ],
    },
    optimizeDeps: {
      exclude: [
        'playwright',
        'playwright-core',
        'playwright-extra',
        'puppeteer-extra-plugin-stealth',
      ],
    },
    server: {
      // Cross-origin isolation so the embedded HermesWorld WebGL client keeps
      // SharedArrayBuffer multithreading (matches the standalone web client at
      // play.hermes-world.ai). Without these, the iframe silently drops to a
      // single thread → render+physics+netcode contend on one thread → inflated
      // ping / worse frame pacing even though network RTT is identical.
      // COEP 'credentialless' enables isolation WITHOUT requiring CORP headers
      // on every cross-origin asset (fonts/images); the web client already sends
      // cross-origin-resource-policy: cross-origin so the iframe still embeds.
      // Backend calls must use reviewed TanStack/server routes so response
      // content cannot bypass generated-content containment. Vite exposes no
      // same-origin backend proxy mount.
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
      // Force IPv4 — 'localhost' resolves to ::1 (IPv6) on Windows, breaking connectivity
      // Olympus posture: loopback by default. Remote/LAN/Tailscale dev serving
      // is an explicit opt-in via HOST or HERMES_DEV_SERVER_HOST; never bind
      // 0.0.0.0 by default on the production Mac.
      host: devServerHost,
      // Port precedence:
      //   1. --port CLI flag (wins, but we no longer hardcode it in package.json)
      //   2. $PORT env var (for containers, reverse proxies, WhatsApp bridge collisions, etc. — see #96)
      //   3. default 3000 (matches README/docs/docker-compose expectations)
      port: Number(env.PORT || process.env.PORT || 3000),
      // Managed Workspace launchers expect a stable port. Fail loudly instead
      // of silently hopping to 3001+ so launchctl/service health matches the
      // actual listening socket.
      strictPort: true,
      allowedHosts,
      watch: {
        ignored: [
          // NOTE: the generated TanStack route tree must NOT be added to this
          // ignore list — doing so causes route changes to require a full
          // dev-server restart. See src/router-route-resolution.test.ts.
          // Real fix for HMR thrash on the generated tree is to ensure only
          // ONE vite dev server runs against this source tree at a time.
          // Local portable session store, rewritten on every chat send.
          // Without this, the watcher fires on every message → spurious
          // server-side reload events / test churn during development.
          '**/.runtime/**',
          // Internal TanStack Start state cache.
          '**/.tanstack/**',
          // Local plan/notes/scratch state used by OMC tooling — never
          // imported by the module graph, but file events still spam logs.
          '**/.omc/**',
          '**/.omx/**',
          // Build artifacts.
          '**/dist/**',
          '**/.output/**',
          // Test/coverage outputs.
          '**/coverage/**',
          '**/playwright-report/**',
          '**/test-results/**',
          // Editor / agent metadata.
          '**/.vscode/**',
          '**/.claude/**',
          '**/.cursor/**',
          // Loose log files.
          '**/*.log',
        ],
      },
    },
    preview: {
      allowedHosts,
    },
    plugins: [
      {
        name: 'static-content-containment',
        enforce: 'pre',
        configureServer(server) {
          server.middlewares.use(
            createStaticContainmentMiddleware({
              allowDevelopmentModules: true,
            }),
          )
        },
        configurePreviewServer(server) {
          server.middlewares.use(
            createStaticContainmentMiddleware({
              allowDevelopmentModules: false,
            }),
          )
        },
        writeBundle(outputOptions) {
          if (this.environment?.name !== 'client') return
          if (!outputOptions.dir) {
            throw new Error(
              'Client asset containment requires a directory build output.',
            )
          }
          copyApprovedPublicAssets(PUBLIC_ASSET_ROOT, outputOptions.dir)
        },
      },
      // devtools(),
      // this is the plugin that enables path aliases
      viteTsConfigPaths({
        projects: ['./tsconfig.json'],
      }),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
      {
        name: 'workspace-daemon',
        buildStart() {
          if (command !== 'serve') return
        },
        configureServer(server) {
          // Cross-origin isolation headers on EVERY response so the embedded
          // HermesWorld WebGL client keeps SharedArrayBuffer multithreading
          // (matches play.hermes-world.ai). Injected via middleware because the
          // TanStack Start SSR handler owns the HTML response and overrides
          // vite's server.headers. COEP 'credentialless' avoids requiring CORP
          // on every cross-origin asset; same-origin agent API is unaffected.
          server.middlewares.use((_req, res, next) => {
            res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
            res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
            next()
          })
          // Content Security Policy as a real HTTP response header. Sending
          // it here (not as a `<meta>` tag) keeps the policy authoritative
          // when an edge proxy mutates the response body — e.g. Cloudflare's
          // JS Challenge injecting a per-request nonce into the served HTML
          // when a browser request trips the "impersonate browsers" WAF rule.
          // Without this, the inline-style source expression
          // `style-src ' 'nonce-...'; self` gets concatenated onto our meta
          // tag and chromium rejects every script and stylesheet with a
          // mangled-CSP error. See the parallel logic in server-entry.js
          // for production.
          server.middlewares.use((_req, res, next) => {
            // KEEP IN SYNC with src/lib/csp.ts and server-entry.js
            res.setHeader(
              'Content-Security-Policy',
              [
                "default-src 'self'",
                "base-uri 'self'",
                "object-src 'none'",
                "form-action 'self'",
                "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
                "img-src 'self' data: blob: https:",
                "font-src 'self' data: https://fonts.gstatic.com",
                "connect-src 'self' ws: wss: http: https:",
                "worker-src 'self' blob:",
                "media-src 'self' blob: data:",
                "frame-src 'self' http: https:",
              ].join('; '),
            )
            res.setHeader('X-Content-Type-Options', 'nosniff')
            res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
            next()
          })
          server.middlewares.use((req, res, next) => {
            const requestPath = req.url?.split('?')[0]
            if (req.method === 'GET' && requestPath === '/api/healthcheck') {
              res.statusCode = 200
              res.setHeader('content-type', 'application/json')
              res.end(JSON.stringify({ ok: true }))
              return
            }

            // /api/connection-status is handled by the real route file at
            // src/routes/api/connection-status.ts — it returns the full
            // ConnectionStatus payload including capabilities and chatMode
            // that downstream feature gates depend on. Earlier versions
            // had an inline shortcut handler here that returned a slim
            // body ({ok, mode, backend}) which silently broke things like
            // useFeatureCapability/useFeatureAvailable in dev mode. See #285.

            next()
          })

          // Dev-only: disable Node's default 5-minute request timeout so
          // long-running SSE streams (agent runs that go silent for minutes
          // during heavy reasoning / tool calls) don't get killed mid-stream
          // by the HTTP layer. Heartbeats handle keep-alive at the application
          // layer. Production servers should keep their default timeouts to
          // avoid slowloris exposure.
          if (command === 'serve' && server.httpServer) {
            const httpServer = server.httpServer as unknown as {
              requestTimeout?: number
              headersTimeout?: number
              timeout?: number
            }
            httpServer.requestTimeout = 0
            httpServer.headersTimeout = 0
            httpServer.timeout = 0
          }

          server.httpServer?.on('close', () => {
            workspaceDaemonShuttingDown = true
            workspaceDaemonStarted = false
            workspaceDaemonStarting = false
            if (workspaceDaemonChild) {
              workspaceDaemonChild.kill()
              workspaceDaemonChild = null
            }
          })

          // Auto-start hermes-agent when dev server launches.
          // Skip when launchd manages the gateway (HERMES_WORKSPACE_AUTO_START_AGENT=false)
          // to avoid SIGTERM cycle on close that nukes the launchd-managed process.
          const autoStartAgent =
            process.env.HERMES_WORKSPACE_AUTO_START_AGENT !== 'false'
          if (command === 'serve' && autoStartAgent) {
            void startClaudeAgent()
          }

          // Shutdown hermes-agent when dev server stops — only if we spawned it.
          server.httpServer?.on('close', () => {
            if (claudeAgentChild && autoStartAgent) {
              console.log('[hermes-agent] Stopping...')
              claudeAgentChild.kill('SIGTERM')
              claudeAgentChild = null
              claudeAgentStarted = false
            }
          })

          if (
            command !== 'serve' ||
            workspaceDaemonStarted ||
            workspaceDaemonStarting
          )
            return

          workspaceDaemonStarting = true
          void (async () => {
            const running = await isPortInUse(Number(workspaceDaemonPort))
            if (workspaceDaemonStarted) {
              workspaceDaemonStarting = false
              return
            }

            if (running) {
              const healthy = await hasHealthyWorkspaceDaemon()
              if (healthy) {
                workspaceDaemonStarting = false
                console.log('[workspace-daemon] Reusing existing daemon')
                return
              }

              try {
                execSync(
                  `lsof -ti:${workspaceDaemonPort} | xargs kill -9 2>/dev/null || true`,
                )
              } catch {
                // ignore stale cleanup failures and continue with a fresh spawn
              }
            }

            startWorkspaceDaemon()
          })()
        },
      },
      // Client-only: replace process.env references in client bundles
      // Server bundles must keep real process.env for Docker runtime env vars
      {
        name: 'client-process-env',
        enforce: 'pre',
        transform(code, _id) {
          const envName = this.environment?.name
          if (envName !== 'client') return null
          if (
            !code.includes('process.env') &&
            !code.includes('process.platform')
          )
            return null

          // Replace specific env vars first, then the generic fallback
          let result = code
          result = result.replace(
            /process\.env\.HERMES_API_URL/g,
            JSON.stringify(claudeApiUrl),
          )
          result = result.replace(
            /process\.env\.CLAUDE_API_URL/g,
            JSON.stringify(claudeApiUrl),
          )
          result = result.replace(
            /process\.env\.HERMES_DASHBOARD_URL/g,
            JSON.stringify(
              env.HERMES_DASHBOARD_URL || env.CLAUDE_DASHBOARD_URL || '',
            ),
          )
          result = result.replace(
            /process\.env\.CLAUDE_DASHBOARD_URL/g,
            JSON.stringify(
              env.HERMES_DASHBOARD_URL || env.CLAUDE_DASHBOARD_URL || '',
            ),
          )
          result = result.replace(
            /process\.env\.HERMES_API_TOKEN/g,
            JSON.stringify(env.HERMES_API_TOKEN || env.CLAUDE_API_TOKEN || ''),
          )
          result = result.replace(
            /process\.env\.CLAUDE_API_TOKEN/g,
            JSON.stringify(env.HERMES_API_TOKEN || env.CLAUDE_API_TOKEN || ''),
          )
          result = result.replace(
            /process\.env\.NODE_ENV/g,
            JSON.stringify(mode),
          )
          result = result.replace(/process\.env/g, '{}')
          result = result.replace(/process\.platform/g, '"browser"')
          return result
        },
      },
      // Copy pty-helper.py into the server assets directory after build
      {
        name: 'copy-pty-helper',
        closeBundle() {
          const src = resolve('src/server/pty-helper.py')
          const destDir = resolve('dist/server/assets')
          const dest = resolve(destDir, 'pty-helper.py')
          if (existsSync(src)) {
            mkdirSync(destDir, { recursive: true })
            copyFileSync(src, dest)
          }
        },
      },
    ],
  }
})

export default config
