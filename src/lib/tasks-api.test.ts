import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAssignees, fetchTasks, resetBackendResolution } from './tasks-api'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  })
}

describe('tasks-api', () => {
  afterEach(() => {
    resetBackendResolution()
    vi.unstubAllGlobals()
  })

  it('uses the canonical assignee route even when the Hermes task store wins', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/hermes-tasks') {
        return jsonResponse({ tasks: [{ id: 'olympus-task' }] })
      }
      if (url === '/api/claude-tasks') {
        return jsonResponse({ tasks: [] })
      }
      if (url === '/api/claude-tasks-assignees') {
        return jsonResponse({
          assignees: [{ id: 'athena', label: 'Athena', isHuman: false }],
          humanReviewer: null,
        })
      }
      if (url === '/api/hermes-tasks-assignees') {
        throw new Error('legacy assignee route should not be selected by the client')
      }

      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAssignees()
    const requestedUrls = fetchMock.mock.calls.map(([input]) =>
      typeof input === 'string' ? input : input.toString(),
    )

    expect(result.assignees).toEqual([
      { id: 'athena', label: 'Athena', isHuman: false },
    ])
    expect(requestedUrls).toContain('/api/claude-tasks-assignees')
    expect(requestedUrls).not.toContain('/api/hermes-tasks-assignees')
  })

  it('surfaces scheduled Olympus jobs as read-only tasks when Kanban is empty', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/hermes-tasks' || url === '/api/claude-tasks') {
        return jsonResponse({ tasks: [] })
      }
      if (url === '/api/claude-jobs?include_disabled=true&profiles=all') {
        return jsonResponse({
          jobs: [
            {
              id: 'runtime-pack-athena',
              name: 'Athena Athena Council Review',
              prompt: 'Review architecture state',
              schedule: {},
              enabled: true,
              state: 'scheduled',
              next_run_at: '2026-06-05T14:00:00.000Z',
              created_at: '2026-06-01T10:00:00.000Z',
              hermes_runtime_pack_cron: {
                profile: 'athena',
                summary: 'Council Review',
                schedule_expr: '0 14 * * *',
              },
            },
            {
              id: 'disabled-themis',
              name: 'Themis Disabled Check',
              prompt: 'Disabled check',
              schedule: {},
              enabled: false,
              state: 'scheduled',
              profile: 'themis',
            },
          ],
        })
      }

      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const tasks = await fetchTasks()
    const requestedUrls = fetchMock.mock.calls.map(([input]) =>
      typeof input === 'string' ? input : input.toString(),
    )

    expect(requestedUrls).toContain('/api/claude-jobs?include_disabled=true&profiles=all')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: 'job:runtime-pack-athena',
      title: 'Council Review',
      column: 'todo',
      priority: 'medium',
      assignee: 'athena',
      tags: ['scheduled', 'athena'],
      readonly: true,
      source: 'job',
    })
    expect(tasks[0]?.description).toContain('Schedule: 0 14 * * *')
  })
})
