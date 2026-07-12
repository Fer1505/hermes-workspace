import { createMiddleware, createStart } from '@tanstack/react-start'
import { enforceSensitiveApiPolicy } from './server/sensitive-api-policy'

/**
 * Runs before TanStack dispatches API routes. Keep this at the Start entry so
 * newly refactored handlers cannot silently bypass the emergency boundary.
 */
export const sensitiveApiRequestMiddleware = createMiddleware({
  type: 'request',
}).server(async ({ request, pathname, next }) => {
  return enforceSensitiveApiPolicy({ request, pathname, next })
})

export const startInstance = createStart(() => ({
  requestMiddleware: [sensitiveApiRequestMiddleware],
}))
