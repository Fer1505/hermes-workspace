import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readAgentUpdateStatus,
  readWorkspaceUpdateStatus,
  remoteUrlMatches,
} from './update-system'

const tempRoots: Array<string> = []

function tempRoot(): string {
  const path = mkdtempSync(join(tmpdir(), 'hermes-update-system-'))
  tempRoots.push(path)
  return path
}

function runGit(cwd: string, args: Array<string>): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
  })
}

function initRepo(path: string): void {
  mkdirSync(path, { recursive: true })
  runGit(path, ['init', '-b', 'main'])
  runGit(path, ['config', 'user.email', 'test@example.com'])
  runGit(path, ['config', 'user.name', 'Test User'])
}

function commitFile(repo: string, relativePath: string, body: string): void {
  const path = join(repo, relativePath)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, body)
  runGit(repo, ['add', relativePath])
  runGit(repo, ['commit', '-m', `commit ${relativePath}`])
}

afterEach(() => {
  delete process.env.HERMES_AGENT_REPO
  delete process.env.HERMES_AGENT_SOURCE_CHECKOUT
  delete process.env.HERMES_AGENT_CHECKOUT
  delete process.env.HERMES_AGENT_UPDATE_REMOTE
  delete process.env.HERMES_AGENT_UPDATE_BRANCH
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('update-system helpers', () => {
  it('matches GitHub URL forms against expected repo aliases', () => {
    expect(
      remoteUrlMatches('https://github.com/outsourc-e/hermes-workspace.git', [
        'outsourc-e/hermes-workspace',
      ]),
    ).toBe(true)
    expect(
      remoteUrlMatches('git@github.com:NousResearch/hermes-agent.git', [
        'hermes-agent',
      ]),
    ).toBe(true)
    expect(
      remoteUrlMatches('https://github.com/example/other.git', [
        'hermes-workspace',
      ]),
    ).toBe(false)
  })

  it('keeps the first path character for staged dirty workspace files', () => {
    const root = tempRoot()
    const repo = join(root, 'hermes-workspace')
    const origin = join(root, 'origin-hermes-workspace.git')
    initRepo(repo)
    commitFile(repo, 'src/file.ts', 'export const value = 1\n')
    execFileSync('git', ['init', '--bare', origin], { stdio: 'ignore' })
    runGit(repo, ['remote', 'add', 'origin', origin])
    runGit(repo, ['push', '-u', 'origin', 'main'])

    writeFileSync(join(repo, 'src/file.ts'), 'export const value = 2\n')
    runGit(repo, ['add', 'src/file.ts'])

    const status = readWorkspaceUpdateStatus(repo)

    expect(status.state).toBe('blocked')
    expect(status.blockingFiles).toContain('src/file.ts')
    expect(status.blockingFiles).not.toContain('rc/file.ts')
  })

  it('blocks divergent upstream Hermes Agent updates instead of offering reset', () => {
    const root = tempRoot()
    const agent = join(root, 'hermes-agent')
    const upstream = join(root, 'upstream-hermes-agent')
    const origin = join(root, 'origin-hermes-agent.git')
    initRepo(agent)
    commitFile(agent, '.gitignore', '.venv/\n')
    commitFile(agent, 'agent.txt', 'base\n')
    execFileSync('git', ['init', '--bare', origin], { stdio: 'ignore' })
    runGit(agent, ['remote', 'add', 'origin', origin])
    runGit(agent, ['push', '-u', 'origin', 'main'])

    execFileSync('git', ['clone', agent, upstream], { stdio: 'ignore' })
    runGit(upstream, ['config', 'user.email', 'test@example.com'])
    runGit(upstream, ['config', 'user.name', 'Test User'])
    commitFile(upstream, 'agent.txt', 'upstream\n')
    runGit(agent, ['remote', 'add', 'upstream', upstream])

    commitFile(agent, 'local.txt', 'local retained change\n')
    mkdirSync(join(agent, '.venv', 'bin'), { recursive: true })
    const hermesPath = join(agent, '.venv', 'bin', 'hermes')
    writeFileSync(hermesPath, '#!/usr/bin/env sh\necho Hermes Agent test\n')
    chmodSync(hermesPath, 0o755)

    process.env.HERMES_AGENT_REPO = agent
    process.env.HERMES_AGENT_UPDATE_REMOTE = 'upstream'
    process.env.HERMES_AGENT_UPDATE_BRANCH = 'main'

    const status = readAgentUpdateStatus()

    expect(status.updateAvailable).toBe(true)
    expect(status.canUpdate).toBe(false)
    expect(status.state).toBe('blocked')
    expect(status.path).toBe(realpathSync(hermesPath))
    expect(status.reason).toContain('diverged from upstream/main')
  })
})
