/**
 * Tasks API client with automatic backend detection.
 *
 * Two backend routes exist for task storage:
 *   /api/hermes-tasks  — flat-file store at ~/.hermes/tasks.json (used by agents/cron)
 *   /api/claude-tasks  — kanban-backend abstraction (local JSON, or Hermes Dashboard proxy)
 *
 * On first fetch this module probes both in parallel and selects the backend that has
 * data. If both have data, hermes-tasks wins (it is the canonical agent task store).
 * The decision is cached for the page session so subsequent calls never re-probe.
 *
 * All mutations (create, update, move, delete, launch) route through the same resolved
 * backend so reads and writes are always consistent.
 */

import { fetchJobs } from './jobs-api'
import type { ClaudeJob } from './jobs-api'

const HERMES_BASE = '/api/hermes-tasks'
const CLAUDE_BASE = '/api/claude-tasks'
const ASSIGNEES_BASE = '/api/claude-tasks-assignees'

export type TasksBackend = 'hermes' | 'claude'

// --- Backend resolution -------------------------------------------------

type BackendResolution = {
  base: string
  backend: TasksBackend
}

let _resolved: BackendResolution | null = null
let _resolving: Promise<BackendResolution> | null = null

async function probeBackend(base: string): Promise<number> {
  try {
    const res = await fetch(base, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return 0
    // Guard against HTML catch-all responses (route not found returns 200 HTML)
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) return -1
    const data = await res.json()
    return Array.isArray(data.tasks) ? data.tasks.length : 0
  } catch {
    return 0
  }
}

async function resolveBackend(): Promise<BackendResolution> {
  if (_resolved) return _resolved
  if (_resolving) return _resolving

  _resolving = (async () => {
    const [hermesCount, claudeCount] = await Promise.all([
      probeBackend(HERMES_BASE),
      probeBackend(CLAUDE_BASE),
    ])

    // Prefer hermes if it has real data (> 0); fall back to claude if hermes is
    // missing (returns -1 for non-JSON / route-not-found) or empty.
    // Default to claude when both are empty — it is the active backend after the
    // hermes-tasks → claude-tasks route rename (commit efcb7d14).
    const useHermes = hermesCount > 0 && hermesCount >= claudeCount
    _resolved = {
      base: useHermes ? HERMES_BASE : CLAUDE_BASE,
      backend: useHermes ? 'hermes' : 'claude',
    }
    return _resolved
  })()

  return _resolving
}

/** Returns the currently resolved backend id, or null if not yet probed. */
export function getActiveBackend(): TasksBackend | null {
  return _resolved?.backend ?? null
}

/** Force a fresh re-probe on the next fetchTasks() call (e.g. after backend config changes). */
export function resetBackendResolution(): void {
  _resolved = null
  _resolving = null
}

// --- Types --------------------------------------------------------------

export type TaskColumn = 'backlog' | 'todo' | 'in_progress' | 'review' | 'blocked' | 'done' | 'deleted'
export type TaskPriority = 'high' | 'medium' | 'low'

export type ClaudeTask = {
  id: string
  title: string
  description: string
  column: TaskColumn
  priority: TaskPriority
  assignee: string | null
  tags: Array<string>
  due_date: string | null
  position: number
  created_by: string
  created_at: string
  updated_at: string
  session_id?: string | null
  readonly?: boolean
  source?: 'kanban' | 'job'
}

export type CreateTaskInput = {
  title: string
  description?: string
  column?: TaskColumn
  priority?: TaskPriority
  assignee?: string | null
  tags?: Array<string>
  due_date?: string | null
  created_by?: string
}

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, 'created_by'>>

export type TaskAssignee = {
  id: string
  label: string
  isHuman: boolean
}

export type AssigneesResponse = {
  assignees: Array<TaskAssignee>
  humanReviewer: string | null
}

// --- API functions -------------------------------------------------------

export async function fetchAssignees(): Promise<AssigneesResponse> {
  await resolveBackend()
  const res = await fetch(ASSIGNEES_BASE)
  if (!res.ok) return { assignees: [], humanReviewer: null }
  return res.json()
}

export async function fetchTasks(params?: {
  column?: TaskColumn
  assignee?: string
  priority?: TaskPriority
  include_done?: boolean
}): Promise<Array<ClaudeTask>> {
  const { base } = await resolveBackend()
  const q = new URLSearchParams()
  if (params?.column) q.set('column', params.column)
  if (params?.assignee) q.set('assignee', params.assignee)
  if (params?.priority) q.set('priority', params.priority)
  if (params?.include_done) q.set('include_done', 'true')
  const url = q.toString() ? `${base}?${q}` : base
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.status}`)
  const data = await res.json()
  const tasks = Array.isArray(data.tasks) ? data.tasks as Array<ClaudeTask> : []
  if (tasks.length > 0) return tasks
  return fetchScheduledJobTasks(params)
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readStringCandidate(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function normalizeJobProfile(job: ClaudeJob): string | null {
  const runtimePackCron = readRecord((job as Record<string, unknown>).hermes_runtime_pack_cron)
  return readStringCandidate(
    job.profile,
    job.profile_name,
    runtimePackCron.profile,
    runtimePackCron.runtime_pack_id,
  )
}

function mapJobToColumn(job: ClaudeJob): TaskColumn {
  const state = typeof job.state === 'string' ? job.state.toLowerCase() : ''
  if (job.last_run_error || job.error || /failed|error|cancelled|canceled/.test(state)) return 'blocked'
  if (/running|active|executing/.test(state)) return 'in_progress'
  return 'todo'
}

function normalizeJobTitle(job: ClaudeJob, profile: string | null): string {
  const runtimePackCron = readRecord((job as Record<string, unknown>).hermes_runtime_pack_cron)
  const summary = readStringCandidate(runtimePackCron.summary)
  if (summary) return summary

  const title = readStringCandidate(job.name, job.id) ?? 'Scheduled agent work'
  if (!profile) return title

  const profileLabel = profile
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
  const duplicatePrefix = `${profileLabel} ${profileLabel} `
  return title.startsWith(duplicatePrefix) ? title.slice(profileLabel.length + 1) : title
}

function formatJobTimestamp(label: string, value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return `${label}: ${parsed.toLocaleString()}`
}

function taskFromJob(job: ClaudeJob, index: number): ClaudeTask | null {
  if (job.enabled === false) return null

  const profile = normalizeJobProfile(job)
  const runtimePackCron = readRecord((job as Record<string, unknown>).hermes_runtime_pack_cron)
  const schedule = readStringCandidate(
    job.schedule_display,
    runtimePackCron.schedule_expr,
    readRecord(job.schedule).display,
  )
  const title = normalizeJobTitle(job, profile)
  const description = [
    schedule ? `Schedule: ${schedule}` : null,
    formatJobTimestamp('Last run', job.last_run_at),
    formatJobTimestamp('Next run', job.next_run_at),
    job.last_run_error ? `Last error: ${job.last_run_error}` : null,
    job.error ? `Error: ${job.error}` : null,
  ].filter(Boolean).join('\n')
  const positionTimestamp =
    Date.parse(job.next_run_at || '') ||
    Date.parse(job.last_run_at || '') ||
    Date.parse(job.updated_at || '') ||
    Date.parse(job.created_at || '') ||
    Date.now() + index
  const createdAt = job.created_at || job.last_run_at || new Date(positionTimestamp).toISOString()
  const updatedAt = job.updated_at || job.last_run_at || createdAt
  const column = mapJobToColumn(job)

  return {
    id: `job:${job.id || job.jobId || index}`,
    title,
    description,
    column,
    priority: column === 'blocked' ? 'high' : 'medium',
    assignee: profile,
    tags: ['scheduled', ...(profile ? [profile] : [])],
    due_date: null,
    position: positionTimestamp,
    created_by: 'hermes-agent',
    created_at: createdAt,
    updated_at: updatedAt,
    readonly: true,
    source: 'job',
  }
}

async function fetchScheduledJobTasks(params?: {
  column?: TaskColumn
  assignee?: string
  priority?: TaskPriority
  include_done?: boolean
}): Promise<Array<ClaudeTask>> {
  const tasks = (await fetchJobs())
    .map(taskFromJob)
    .filter((task): task is ClaudeTask => Boolean(task))
    .filter((task) => {
      if (!params?.include_done && task.column === 'done') return false
      if (params?.column && task.column !== params.column) return false
      if (params?.assignee && task.assignee !== params.assignee) return false
      if (params?.priority && task.priority !== params.priority) return false
      return true
    })

  return tasks.sort((left, right) => left.position - right.position || left.title.localeCompare(right.title))
}

export async function createTask(input: CreateTaskInput): Promise<ClaudeTask> {
  const { base } = await resolveBackend()
  const res = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { detail?: string }).detail || `Failed to create task: ${res.status}`)
  }
  return (await res.json()).task
}

export async function updateTask(taskId: string, input: UpdateTaskInput): Promise<ClaudeTask> {
  const { base } = await resolveBackend()
  const res = await fetch(`${base}/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Failed to update task: ${res.status}`)
  return (await res.json()).task
}

export async function deleteTask(taskId: string): Promise<void> {
  const { base } = await resolveBackend()
  const res = await fetch(`${base}/${taskId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Failed to delete task: ${res.status}`)
}

export async function linkSession(taskId: string, sessionId: string | null): Promise<ClaudeTask> {
  const { base } = await resolveBackend()
  const res = await fetch(`${base}/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  })
  if (!res.ok) throw new Error(`Failed to link session: ${res.status}`)
  return (await res.json()).task
}

export async function launchSession(taskId: string): Promise<{ sessionId: string; briefing: string; task: ClaudeTask }> {
  const { base } = await resolveBackend()
  const res = await fetch(`${base}/${taskId}?action=launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!res.ok) throw new Error(`Failed to launch session: ${res.status}`)
  return res.json()
}

export async function moveTask(taskId: string, column: TaskColumn, movedBy = 'user'): Promise<ClaudeTask> {
  const { base } = await resolveBackend()
  const res = await fetch(`${base}/${taskId}?action=move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column, moved_by: movedBy }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { detail?: string }).detail || `Failed to move task: ${res.status}`)
  }
  return (await res.json()).task
}

// --- Display constants ---------------------------------------------------

export const COLUMN_LABELS: Record<TaskColumn, string> = {
  backlog: 'Triage',
  todo: 'Ready',
  in_progress: 'Running',
  review: 'Review',
  blocked: 'Blocked',
  done: 'Done',
  deleted: 'Deleted',
}

export const COLUMN_ORDER: Array<TaskColumn> = ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done']

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  high: '#ef4444',
  medium: '#f97316',
  low: '#6b7280',
}

export const COLUMN_COLORS: Record<TaskColumn, string> = {
  backlog: '#6b7280',
  todo: '#3b82f6',
  in_progress: '#f97316',
  review: '#a855f7',
  blocked: '#ef4444',
  done: '#22c55e',
  deleted: '#374151',
}

export function isOverdue(task: ClaudeTask): boolean {
  if (!task.due_date) return false
  // Parse YYYY-MM-DD manually to avoid UTC-vs-local offset issues.
  // new Date("2026-04-02") parses as UTC midnight, which in EST is the
  // previous evening — causing everything to appear one day early.
  const [year, month, day] = task.due_date.split('-').map(Number)
  const due = new Date(year, month - 1, day) // local midnight
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return due < today
}
