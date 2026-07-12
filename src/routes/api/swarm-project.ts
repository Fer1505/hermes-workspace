import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getProfilesDir } from '../../server/claude-paths'

type PreviewSource = 'none'

type ProjectResponse = {
  workerId: string
  cwd: string | null
  projectName: string | null
  branch: string | null
  changedFiles: Array<string>
  previewUrls: Array<string>
  packageScripts: Array<string>
  previewSource: PreviewSource
  fetchedAt: number
  error?: string
}

function isValidWorkerId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)
}

type RuntimeMeta = {
  cwd: string | null
}

function readRuntimeMeta(profilePath: string): RuntimeMeta {
  const file = join(profilePath, 'runtime.json')
  if (!existsSync(file)) return { cwd: null }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Record<
      string,
      unknown
    >
    const cwd = typeof raw.cwd === 'string' ? raw.cwd : null
    return {
      cwd: cwd && existsSync(cwd) ? cwd : null,
    }
  } catch {
    return { cwd: null }
  }
}

function gitBranch(cwd: string): string | null {
  try {
    const out = execFileSync(
      'git',
      ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { encoding: 'utf-8', timeout: 1500 },
    )
    const branch = out.trim()
    return branch && branch !== 'HEAD' ? branch : null
  } catch {
    return null
  }
}

function gitChangedFiles(cwd: string, max = 25): Array<string> {
  try {
    const out = execFileSync('git', ['-C', cwd, 'status', '--porcelain'], {
      encoding: 'utf-8',
      timeout: 2000,
    })
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, max)
      .map((line) => {
        const m = line.match(/^[A-Z?! ]{1,2}\s+(.+)$/)
        return m ? m[1].replace(/^"|"$/g, '') : line
      })
  } catch {
    return []
  }
}

function readPackageScripts(cwd: string): Array<string> {
  const file = join(cwd, 'package.json')
  if (!existsSync(file)) return []
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as {
      scripts?: Record<string, string>
    }
    return raw.scripts ? Object.keys(raw.scripts) : []
  } catch {
    return []
  }
}

function buildProject(workerId: string): ProjectResponse {
  const profilePath = join(getProfilesDir(), workerId)
  const runtime = readRuntimeMeta(profilePath)
  const cwd = runtime.cwd
  if (!cwd) {
    return {
      workerId,
      cwd: null,
      projectName: null,
      branch: null,
      changedFiles: [],
      previewUrls: [],
      packageScripts: [],
      previewSource: 'none',
      fetchedAt: Date.now(),
      error: 'cwd missing in runtime.json or path no longer exists',
    }
  }
  const projectName = basename(cwd)
  const branch = gitBranch(cwd)
  const changedFiles = gitChangedFiles(cwd)
  const packageScripts = readPackageScripts(cwd)

  return {
    workerId,
    cwd,
    projectName,
    branch,
    changedFiles,
    previewUrls: [],
    packageScripts,
    previewSource: 'none',
    fetchedAt: Date.now(),
  }
}

export const Route = createFileRoute('/api/swarm-project')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const workerIdRaw = (url.searchParams.get('workerId') ?? '').trim()
        if (!workerIdRaw || !isValidWorkerId(workerIdRaw)) {
          return json({ error: 'workerId required' }, { status: 400 })
        }
        const result = await buildProject(workerIdRaw)
        return json(result)
      },
    },
  },
})
