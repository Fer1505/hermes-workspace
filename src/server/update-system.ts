import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

type ProductId = 'workspace' | 'agent'
type InstallKind = 'git' | 'desktop' | 'docker' | 'unknown'
type UpdateState = 'current' | 'available' | 'blocked' | 'unsupported' | 'error'

type ReleaseNoteSection = {
  product: ProductId
  label: string
  from: string | null
  to: string | null
  commits: Array<string>
}

export type ProductUpdateStatus = {
  id: ProductId
  label: string
  installKind: InstallKind
  version: string
  path: string | null
  repoPath: string | null
  branch: string | null
  currentHead: string | null
  latestHead: string | null
  updateAvailable: boolean
  canUpdate: boolean
  state: UpdateState
  reason: string | null
  /**
   * When state is 'blocked' due to a dirty checkout, this lists up to a few
   * paths that are causing the block (modified, staged, or untracked files).
   * Surfaced in the UI so the user can see which files to deal with. See #293.
   */
  blockingFiles?: Array<string>
  updateMode:
    | 'git-ff'
    | 'hermes-update'
    | 'desktop-auto-updater'
    | 'docker-manual'
    | 'manual'
}

export type UpdateStatus = {
  ok: true
  checkedAt: number
  products: {
    workspace: ProductUpdateStatus
    agent: ProductUpdateStatus
  }
  updateAvailable: boolean
  pendingReleaseNotes: Array<ReleaseNoteSection>
}

export type ApplyUpdateResult = {
  ok: boolean
  product: ProductId
  output: string
  restartRequired: boolean
  status: ProductUpdateStatus
  releaseNotes: Array<ReleaseNoteSection>
  error?: string
}

export const SOURCE_UPDATE_CONTAINMENT_REASON =
  'One-click source updates are disabled until the reviewed staged-release workflow provides immutable artifacts, frozen dependencies, atomic activation, health/readback, and rollback.'

function pendingNotesPath(): string {
  return join(process.cwd(), '.runtime', 'pending-update-release-notes.json')
}

function readPendingReleaseNotes(): Array<ReleaseNoteSection> {
  try {
    const raw = JSON.parse(readFileSync(pendingNotesPath(), 'utf8')) as {
      sections?: Array<ReleaseNoteSection>
    }
    return Array.isArray(raw.sections) ? raw.sections : []
  } catch {
    return []
  }
}

function exec(
  command: string,
  args: Array<string>,
  options: { cwd?: string; timeout?: number; stdio?: 'pipe' | 'ignore' } = {},
): string | null {
  try {
    if (options.stdio === 'ignore') {
      execFileSync(command, args, {
        cwd: options.cwd ?? process.cwd(),
        timeout: options.timeout ?? 8_000,
        stdio: 'ignore',
      })
      return 'ok'
    }
    return (
      execFileSync(command, args, {
        cwd: options.cwd ?? process.cwd(),
        encoding: 'utf8',
        timeout: options.timeout ?? 8_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || null
    )
  } catch {
    return null
  }
}

function git(args: Array<string>, cwd: string, timeout = 8_000): string | null {
  return exec('git', args, { cwd, timeout })
}

function realGitRepoPath(path: string | null | undefined): string | null {
  if (!path) return null
  try {
    const resolved = realpathSync(path)
    return existsSync(join(resolved, '.git')) ? resolved : null
  } catch {
    return null
  }
}

function pkgVersion(repoPath: string): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(repoPath, 'package.json'), 'utf8'),
    ) as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export function remoteUrlMatches(
  url: string | null,
  expected: Array<string>,
): boolean {
  if (!url) return false
  const normalized = url
    .toLowerCase()
    .replace(/^git@github\.com:/, 'github.com/')
    .replace(/^https?:\/\//, '')
    .replace(/\.git$/, '')
  return expected.some((alias) =>
    normalized.includes(alias.toLowerCase().replace(/\.git$/, '')),
  )
}

function remoteHead(repoPath: string, remote = 'origin'): string | null {
  const url = git(['remote', 'get-url', remote], repoPath)
  if (!url) return null
  const raw = exec('git', ['ls-remote', url, 'HEAD'], {
    cwd: repoPath,
    timeout: 10_000,
  })
  return raw?.split(/\s+/)[0] ?? null
}

function isDirty(repoPath: string): boolean {
  return Boolean(git(['status', '--porcelain'], repoPath))
}

/**
 * Return up to `limit` paths from `git status --porcelain` so the UI can
 * tell the user exactly which files are blocking an update. The shape of
 * each entry is the relative path inside the repo (XY status code stripped).
 */
function listDirtyFiles(repoPath: string, limit = 24): Array<string> {
  const raw = git(['status', '--porcelain'], repoPath)
  if (!raw) return []
  const out: Array<string> = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    // porcelain format: XY <space> path  (path may be quoted with renames)
    const path = line.slice(3).trim()
    if (path) out.push(path)
    if (out.length >= limit) break
  }
  return out
}

function canFastForward(repoPath: string, remoteRef: string): boolean {
  return (
    exec('git', ['merge-base', '--is-ancestor', 'HEAD', remoteRef], {
      cwd: repoPath,
      stdio: 'ignore',
    }) !== null
  )
}

function hasRemoteRef(repoPath: string, remoteRef: string): boolean {
  return Boolean(git(['rev-parse', '--verify', remoteRef], repoPath, 10_000))
}

function branchDivergence(
  repoPath: string,
  remoteRef: string,
): { ahead: number; behind: number } | null {
  const raw = git(
    ['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`],
    repoPath,
    10_000,
  )
  if (!raw) return null
  const [aheadRaw, behindRaw] = raw.split(/\s+/)
  const ahead = Number(aheadRaw)
  const behind = Number(behindRaw)
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return null
  return { ahead, behind }
}

export function updateAvailableFromDivergence(
  divergence: { ahead: number; behind: number } | null,
  headsDiffer: boolean,
): boolean {
  // A local checkout can legitimately be ahead of origin because it carries
  // hotfixes or unpublished commits. That is not an available upstream update.
  // Only remote-ahead or diverged histories should surface as updateable.
  return divergence ? divergence.behind > 0 : headsDiffer
}

/**
 * Apply the Phase 0 source-updater containment invariant without discarding
 * useful observational metadata. A local checkout may be current, ahead,
 * behind, dirty, or diverged; none of those shapes authorizes in-process
 * source mutation.
 */
export function enforceSourceUpdateContainment(
  status: ProductUpdateStatus,
): ProductUpdateStatus {
  return {
    ...status,
    canUpdate: false,
    state: 'blocked',
    reason: SOURCE_UPDATE_CONTAINMENT_REASON,
    updateMode: 'manual',
  }
}

/**
 * The apply endpoints must fail before status discovery, child processes,
 * filesystem access, activation, or receipt writes. Keep this status factory
 * pure so calling either endpoint has zero updater side effects.
 */
function blockedApplyStatus(product: ProductId): ProductUpdateStatus {
  return {
    id: product,
    label: product === 'workspace' ? 'Hermes Workspace' : 'Hermes Agent',
    installKind: 'unknown',
    version: 'unknown',
    path: null,
    repoPath: null,
    branch: null,
    currentHead: null,
    latestHead: null,
    updateAvailable: false,
    canUpdate: false,
    state: 'blocked',
    reason: SOURCE_UPDATE_CONTAINMENT_REASON,
    updateMode: 'manual',
  }
}

function blockedApplyResult(product: ProductId): ApplyUpdateResult {
  return {
    ok: false,
    product,
    output: '',
    restartRequired: false,
    status: blockedApplyStatus(product),
    releaseNotes: [],
    error: SOURCE_UPDATE_CONTAINMENT_REASON,
  }
}

function workspaceInstallKind(): InstallKind {
  if (
    process.env.HERMES_WORKSPACE_DESKTOP === '1' ||
    process.env.ELECTRON_RUN_AS_NODE
  )
    return 'desktop'
  if (process.env.HERMES_WORKSPACE_DOCKER === '1' || existsSync('/.dockerenv'))
    return 'docker'
  return realGitRepoPath(process.cwd()) ? 'git' : 'unknown'
}

export function readWorkspaceUpdateStatus(
  repoPath = process.cwd(),
): ProductUpdateStatus {
  const installKind = workspaceInstallKind()
  const gitRepo = realGitRepoPath(repoPath)
  const version = gitRepo ? pkgVersion(gitRepo) : 'unknown'

  if (installKind === 'desktop') {
    return enforceSourceUpdateContainment({
      id: 'workspace',
      label: 'Hermes Workspace',
      installKind,
      version,
      path: repoPath,
      repoPath: gitRepo,
      branch: null,
      currentHead: null,
      latestHead: null,
      updateAvailable: false,
      canUpdate: false,
      state: 'unsupported',
      reason:
        'Desktop auto-updater manifest is not wired yet. This path is reserved for DMG/EXE packaging.',
      updateMode: 'desktop-auto-updater',
    })
  }

  if (installKind === 'docker') {
    return enforceSourceUpdateContainment({
      id: 'workspace',
      label: 'Hermes Workspace',
      installKind,
      version,
      path: repoPath,
      repoPath: gitRepo,
      branch: null,
      currentHead: null,
      latestHead: null,
      updateAvailable: false,
      canUpdate: false,
      state: 'unsupported',
      reason:
        'Docker installs should update by pulling a newer image/tag, not by mutating the running container.',
      updateMode: 'docker-manual',
    })
  }

  if (!gitRepo) {
    return enforceSourceUpdateContainment({
      id: 'workspace',
      label: 'Hermes Workspace',
      installKind: 'unknown',
      version,
      path: repoPath,
      repoPath: null,
      branch: null,
      currentHead: null,
      latestHead: null,
      updateAvailable: false,
      canUpdate: false,
      state: 'unsupported',
      reason: 'Workspace install type could not be detected.',
      updateMode: 'manual',
    })
  }

  const remoteUrl = git(['remote', 'get-url', 'origin'], gitRepo)
  const repoMatches = remoteUrlMatches(remoteUrl, [
    'hermes-workspace',
    'outsourc-e/hermes-workspace',
  ])
  if (repoMatches) git(['fetch', 'origin', '--quiet'], gitRepo, 30_000)
  const currentHead = git(['rev-parse', 'HEAD'], gitRepo)
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], gitRepo)
  const supportedBranch = branch === 'main' || branch === 'master'
  const latestHead =
    repoMatches && supportedBranch ? remoteHead(gitRepo, 'origin') : null
  const dirty = isDirty(gitRepo)
  const remoteRef = `origin/${branch || 'main'}`
  const divergence = latestHead ? branchDivergence(gitRepo, remoteRef) : null
  const updateAvailable = Boolean(
    supportedBranch &&
    currentHead &&
    latestHead &&
    updateAvailableFromDivergence(divergence, currentHead !== latestHead),
  )
  const canSync = updateAvailable ? hasRemoteRef(gitRepo, remoteRef) : true
  const ff = updateAvailable ? canFastForward(gitRepo, remoteRef) : true
  const canUpdate = Boolean(
    repoMatches && supportedBranch && updateAvailable && !dirty && canSync,
  )

  return enforceSourceUpdateContainment({
    id: 'workspace',
    label: 'Hermes Workspace',
    installKind: 'git',
    version,
    path: repoPath,
    repoPath: gitRepo,
    branch,
    currentHead,
    latestHead,
    updateAvailable,
    canUpdate,
    state: !repoMatches
      ? 'unsupported'
      : !supportedBranch
        ? 'unsupported'
        : dirty
          ? 'blocked'
          : updateAvailable
            ? canSync
              ? 'available'
              : 'blocked'
            : 'current',
    reason: !repoMatches
      ? 'Workspace origin remote does not look like hermes-workspace.'
      : !supportedBranch
        ? 'Workspace one-click updates are only enabled on main/master branches.'
        : dirty
          ? 'Workspace checkout has local changes. Commit, stash, or remove the listed files before updating.'
          : updateAvailable && !canSync
            ? 'Workspace update could not verify the remote branch ref.'
            : updateAvailable && !ff
              ? 'Workspace branch diverged from origin. One-click update will realign to the remote branch.'
              : null,
    blockingFiles: dirty ? listDirtyFiles(gitRepo) : undefined,
    updateMode: 'git-ff',
  })
}

function agentRepoPath(): string | null {
  const candidates = [
    process.env.HERMES_AGENT_REPO,
    join(homedir(), '.hermes', 'hermes-agent'),
    join(homedir(), 'Projects', 'hermes-agent'),
    join(homedir(), 'hermes-agent'),
  ]
  for (const candidate of candidates) {
    const repo = realGitRepoPath(candidate)
    if (repo) return repo
  }
  return null
}

export function readAgentUpdateStatus(): ProductUpdateStatus {
  const repoPath = agentRepoPath()
  const repoHermes = repoPath ? join(repoPath, 'venv', 'bin', 'hermes') : null
  const path =
    repoHermes && existsSync(repoHermes)
      ? repoHermes
      : exec('which', ['hermes'])
  const version =
    (path ? exec(path, ['--version'], { timeout: 10_000 }) : null)?.split(
      '\n',
    )[0] ?? 'unknown'

  if (!repoPath) {
    return enforceSourceUpdateContainment({
      id: 'agent',
      label: 'Hermes Agent',
      installKind: 'unknown',
      version,
      path,
      repoPath: null,
      branch: null,
      currentHead: null,
      latestHead: null,
      updateAvailable: false,
      canUpdate: false,
      state: 'unsupported',
      reason:
        'Hermes Agent git checkout was not found. Bundled desktop installs will update through the app updater.',
      updateMode: 'manual',
    })
  }

  const remoteUrl = git(['remote', 'get-url', 'origin'], repoPath)
  const repoMatches = remoteUrlMatches(remoteUrl, [
    'hermes-agent',
    'outsourc-e/hermes-agent',
    'NousResearch/hermes-agent',
  ])
  if (repoMatches) git(['fetch', 'origin', '--quiet'], repoPath, 30_000)
  const currentHead = git(['rev-parse', 'HEAD'], repoPath)
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)
  const latestHead = repoMatches ? remoteHead(repoPath, 'origin') : null
  const remoteRef = repoMatches ? `origin/${branch || 'main'}` : null
  const dirty = isDirty(repoPath)
  const divergence = remoteRef ? branchDivergence(repoPath, remoteRef) : null
  const updateAvailable = Boolean(
    currentHead &&
    latestHead &&
    remoteRef &&
    updateAvailableFromDivergence(divergence, currentHead !== latestHead),
  )
  const canSync = remoteRef ? hasRemoteRef(repoPath, remoteRef) : false
  const ff = remoteRef ? canFastForward(repoPath, remoteRef) : false
  const canUpdate = Boolean(repoMatches && updateAvailable && !dirty && canSync)

  return enforceSourceUpdateContainment({
    id: 'agent',
    label: 'Hermes Agent',
    installKind: 'git',
    version,
    path,
    repoPath,
    branch,
    currentHead,
    latestHead,
    updateAvailable,
    canUpdate,
    state: !repoMatches
      ? 'unsupported'
      : dirty
        ? 'blocked'
        : updateAvailable && canSync
          ? 'available'
          : updateAvailable
            ? 'blocked'
            : 'current',
    reason: !repoMatches
      ? 'Hermes Agent origin remote does not look like hermes-agent.'
      : dirty
        ? 'Hermes Agent checkout has local changes. Commit, stash, or remove the listed files before updating.'
        : updateAvailable && !canSync
          ? 'Hermes Agent update could not verify the remote branch ref.'
          : updateAvailable && !ff
            ? 'Hermes Agent branch diverged from origin. One-click update will realign to the remote branch.'
            : null,
    blockingFiles: dirty ? listDirtyFiles(repoPath) : undefined,
    updateMode: 'hermes-update',
  })
}

export function readUpdateStatus(): UpdateStatus {
  const workspace = readWorkspaceUpdateStatus()
  const agent = readAgentUpdateStatus()
  return {
    ok: true,
    checkedAt: Date.now(),
    products: { workspace, agent },
    updateAvailable: workspace.updateAvailable || agent.updateAvailable,
    pendingReleaseNotes: readPendingReleaseNotes(),
  }
}

export function applyWorkspaceUpdate(): ApplyUpdateResult {
  return blockedApplyResult('workspace')
}

export function applyAgentUpdate(): ApplyUpdateResult {
  return blockedApplyResult('agent')
}
