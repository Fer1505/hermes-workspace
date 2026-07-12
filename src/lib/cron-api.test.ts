import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCronJobs } from './cron-api'

describe('fetchCronJobs', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes Olympus runtime-pack cron jobs from structured dashboard payloads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            jobs: [
              {
                id: 'athena:76697f0f8dc3',
                name: 'Athena strategic drift review',
                enabled: true,
                profile: 'athena',
                schedule: {
                  kind: 'cron',
                  expr: '0 9 * * *',
                  tz: 'America/Kentucky/Louisville',
                  display: 'daily 09:00 America/Kentucky/Louisville',
                },
                hermes_runtime_pack_cron: {
                  summary: 'Athena strategic drift, council, and recommendation review',
                },
                next_run_at: '2026-06-04T09:00:00-04:00',
                last_run_at: '2026-06-03T09:04:31.074917-04:00',
                last_status: 'ok',
              },
            ],
          }),
          {
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    )

    const jobs = await fetchCronJobs()

    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      id: 'athena:76697f0f8dc3',
      profile: 'athena',
      schedule: 'daily 09:00 America/Kentucky/Louisville',
      description: 'Athena strategic drift, council, and recommendation review',
      nextRunAt: '2026-06-04T13:00:00.000Z',
    })
    expect(jobs[0]?.lastRun?.status).toBe('success')
    expect(jobs[0]?.lastRun?.startedAt).toBe('2026-06-03T13:04:31.074Z')
  })
})
