import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { listMemoryFiles } from '../../../server/memory-browser'
import { PROFILE_MEMORY_CONTRACT_VERSION } from '../../../server/profile-memory-contract'

export const Route = createFileRoute('/api/memory/list')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        // Memory is sourced entirely from local filesystem via memory-browser.ts
        // (reads canonical $HERMES_HOME/memories/ learned state plus
        // $HERMES_HOME/memory/ runtime state; retired root decoys are ignored). No
        // remote gateway endpoint is required, so no capability gate is needed.
        try {
          return json({
            contractVersion: PROFILE_MEMORY_CONTRACT_VERSION,
            files: listMemoryFiles(),
          })
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to list memory files',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
