import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  createKanbanCard,
  listKanbanCards,
  updateKanbanCard,
} from '../../server/kanban-backend'
import { Route } from './swarm-kanban'

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../server/kanban-backend', () => {
  const card = {
    id: 'card-1',
    title: 'Ship the slice',
    spec: '',
    acceptanceCriteria: [],
    assignedWorker: null,
    reviewer: null,
    status: 'backlog',
    missionId: null,
    reportPath: null,
    createdBy: 'test',
    createdAt: 1,
    updatedAt: 1,
  }
  const backend = {
    id: 'local',
    label: 'Local',
    detected: true,
    writable: true,
    path: '/tmp/swarm2-kanban.json',
  }

  return {
    createKanbanCard: vi.fn((input) => ({
      ...card,
      ...input,
      id: 'created-1',
    })),
    getKanbanBackendMeta: vi.fn(() => backend),
    listKanbanCards: vi.fn(() => [card]),
    updateKanbanCard: vi.fn((id, updates) => ({
      ...card,
      ...updates,
      id,
      updatedAt: 2,
    })),
  }
})

type SwarmKanbanHandlers = {
  GET: (ctx: { request: Request }) => Promise<Response>
  POST: (ctx: { request: Request }) => Promise<Response>
  PATCH: (ctx: { request: Request }) => Promise<Response>
}

const handlers = Route.options.server?.handlers as SwarmKanbanHandlers
const mockIsAuthenticated = vi.mocked(isAuthenticated)
const mockCreateKanbanCard = vi.mocked(createKanbanCard)
const mockListKanbanCards = vi.mocked(listKanbanCards)
const mockUpdateKanbanCard = vi.mocked(updateKanbanCard)

function request(method: string, body?: unknown, contentType = 'application/json') {
  return new Request('http://localhost/api/swarm-kanban', {
    method,
    headers: contentType ? { 'Content-Type': contentType } : undefined,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsAuthenticated.mockReturnValue(true)
})

describe('/api/swarm-kanban auth and mutation guards', () => {
  it('rejects unauthenticated reads', async () => {
    mockIsAuthenticated.mockReturnValue(false)

    const res = await handlers.GET({ request: request('GET') })

    expect(res.status).toBe(401)
    expect(mockListKanbanCards).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated creates before parsing the body', async () => {
    mockIsAuthenticated.mockReturnValue(false)

    const res = await handlers.POST({
      request: request('POST', { title: 'Nope' }),
    })

    expect(res.status).toBe(401)
    expect(mockCreateKanbanCard).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated updates before parsing the body', async () => {
    mockIsAuthenticated.mockReturnValue(false)

    const res = await handlers.PATCH({
      request: request('PATCH', { id: 'card-1', status: 'done' }),
    })

    expect(res.status).toBe(401)
    expect(mockUpdateKanbanCard).not.toHaveBeenCalled()
  })

  it('requires application/json for creates', async () => {
    const res = await handlers.POST({
      request: request('POST', { title: 'Nope' }, 'text/plain'),
    })

    expect(res.status).toBe(415)
    expect(mockCreateKanbanCard).not.toHaveBeenCalled()
  })

  it('requires application/json for updates', async () => {
    const res = await handlers.PATCH({
      request: request('PATCH', { id: 'card-1' }, 'text/plain'),
    })

    expect(res.status).toBe(415)
    expect(mockUpdateKanbanCard).not.toHaveBeenCalled()
  })

  it('allows authenticated creates with JSON content', async () => {
    const res = await handlers.POST({
      request: request('POST', {
        title: 'Ship the slice',
        status: 'todo',
        tags: 'audit,security',
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      card: {
        id: 'created-1',
        title: 'Ship the slice',
        status: 'todo',
        tags: ['audit', 'security'],
      },
    })
    expect(mockCreateKanbanCard).toHaveBeenCalledOnce()
  })

  it('allows authenticated updates with JSON content', async () => {
    const res = await handlers.PATCH({
      request: request('PATCH', { id: 'card-1', status: 'done' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      card: { id: 'card-1', status: 'done' },
    })
    expect(mockUpdateKanbanCard).toHaveBeenCalledWith('card-1', {
      status: 'done',
    })
  })
})
