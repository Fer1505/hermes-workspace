import { createFileRoute } from '@tanstack/react-router'
import { taskAssigneesResponse } from './claude-tasks-assignees'

export const Route = createFileRoute('/api/hermes-tasks-assignees')({
  server: {
    handlers: {
      GET: async ({ request }) => taskAssigneesResponse(request),
    },
  },
})
