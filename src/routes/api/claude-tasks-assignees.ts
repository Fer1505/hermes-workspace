/**
 * Proxy endpoint — returns available task assignees.
 * Reads agent profiles from the Hermes Agent gateway and combines with the
 * configured human reviewer name (tasks.human_reviewer in config.yaml).
 * Falls back to profile directory listing if the gateway doesn't have
 * a /api/tasks/assignees endpoint.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import YAML from 'yaml'
import { isAuthenticated } from '../../server/auth-middleware'
import { dashboardFetch, gatewayFetch } from '../../server/gateway-capabilities'

type RawAssignee = {
  id?: unknown
  name?: unknown
  label?: unknown
  isHuman?: unknown
  is_human?: unknown
}

type TaskAssignee = {
  id: string
  label: string
  isHuman: boolean
}

const CLAUDE_HOME = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
const CONFIG_PATH = path.join(CLAUDE_HOME, 'config.yaml')

function readConfig(): Record<string, unknown> {
  try {
    const parsed = YAML.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

function hasProfileConfig(dir: string): boolean {
  return isDirectory(dir) && fs.existsSync(path.join(dir, 'config.yaml'))
}

function isProfileRoot(dir: string): boolean {
  try {
    return fs.readdirSync(dir).some(name => hasProfileConfig(path.join(dir, name)))
  } catch {
    return false
  }
}

function getProfileRoots(): Array<string> {
  const roots: Array<string> = []
  const addRoot = (dir: string) => {
    const resolved = path.resolve(dir)
    if (!roots.includes(resolved) && isProfileRoot(resolved)) roots.push(resolved)
  }

  addRoot(path.join(CLAUDE_HOME, 'profiles'))
  addRoot(CLAUDE_HOME)

  if (hasProfileConfig(CLAUDE_HOME)) {
    addRoot(path.dirname(CLAUDE_HOME))
  }

  return roots
}

function getProfileNames(): Array<string> {
  const profiles = new Set<string>()

  for (const root of getProfileRoots()) {
    for (const name of fs.readdirSync(root)) {
      if (hasProfileConfig(path.join(root, name))) profiles.add(name)
    }
  }

  return Array.from(profiles)
}

function activeProfileNameFromHome(): string | null {
  const profileName = path.basename(CLAUDE_HOME)
  if (profileName === 'default') return null

  const parent = path.dirname(CLAUDE_HOME)
  return hasProfileConfig(CLAUDE_HOME) && isProfileRoot(parent)
    ? profileName
    : null
}

function normalizeProfileId(id: string): string {
  return id === 'default' ? activeProfileNameFromHome() ?? id : id
}

function titleCaseProfile(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function normalizeAssigneePayload(payload: unknown, humanReviewer: string | null): Array<TaskAssignee> {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null
  const rawAssignees = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.assignees)
      ? record.assignees
      : []

  const seen = new Set<string>()
  const assignees: Array<TaskAssignee> = []

  for (const raw of rawAssignees) {
    const item = typeof raw === 'string' ? { id: raw, label: raw } : raw as RawAssignee
    const rawId = typeof item.id === 'string'
      ? item.id
      : typeof item.name === 'string'
        ? item.name
        : null
    const id = rawId ? normalizeProfileId(rawId) : null
    if (!id || seen.has(id)) continue
    seen.add(id)
    const label = rawId !== 'default' && typeof item.label === 'string' && item.label.trim().length > 0
      ? item.label
      : titleCaseProfile(id)
    assignees.push({
      id,
      label,
      isHuman: item.isHuman === true || item.is_human === true || id === humanReviewer,
    })
  }

  return assignees
}

async function fetchJson(fetcher: () => Promise<Response>): Promise<unknown | null> {
  try {
    const res = await fetcher()
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function taskAssigneesResponse(request: Request): Promise<Response> {
  if (!isAuthenticated(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const config = readConfig()
  const tasksConfig = (config.tasks ?? {}) as Record<string, unknown>
  const configuredHumanReviewer = (tasksConfig.human_reviewer as string) || null
  const humanReviewer = configuredHumanReviewer
    ? normalizeProfileId(configuredHumanReviewer)
    : null

  // Prefer the dashboard plugin endpoint: it is the source used by the
  // Hermes kanban CLI and includes board assignees already present upstream.
  const remotePayload =
    await fetchJson(() =>
      dashboardFetch('/api/plugins/kanban/assignees', {
        signal: AbortSignal.timeout(2000),
      }),
    ) ??
    await fetchJson(() =>
      gatewayFetch('/api/tasks/assignees', {
        signal: AbortSignal.timeout(2000),
      }),
    )
  const remoteAssignees = remotePayload
    ? normalizeAssigneePayload(remotePayload, humanReviewer)
    : []

  const profiles = getProfileNames()
  const merged = new Map<string, TaskAssignee>()
  for (const assignee of remoteAssignees) {
    merged.set(assignee.id, assignee)
  }
  for (const id of profiles) {
    if (!merged.has(id)) {
      merged.set(id, { id, label: titleCaseProfile(id), isHuman: id === humanReviewer })
    }
  }
  if (humanReviewer && !merged.has(humanReviewer)) {
    merged.set(humanReviewer, {
      id: humanReviewer,
      label: titleCaseProfile(humanReviewer),
      isHuman: true,
    })
  }

  const assignees = Array.from(merged.values()).sort((a, b) => {
    if (a.isHuman !== b.isHuman) return a.isHuman ? -1 : 1
    return a.label.localeCompare(b.label)
  })

  return new Response(
    JSON.stringify({ assignees, humanReviewer }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

export const Route = createFileRoute('/api/claude-tasks-assignees')({
  server: {
    handlers: {
      GET: async ({ request }) => taskAssigneesResponse(request),
    },
  },
})
