/**
 * Preview-file endpoint.
 *
 * The route is retained as a stable API boundary while generated executable
 * previews are contained. It intentionally returns before parsing a URL or
 * touching a caller-controlled path.
 */
import { createFileRoute } from '@tanstack/react-router'
import { GENERATED_CONTENT_CONTAINMENT_REASON } from '../../lib/generated-content-containment'
import { isAuthenticated } from '../../server/auth-middleware'

const CONTAINMENT_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Content-Type': 'text/plain; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const

export function previewFileGetHandler({
  request,
}: {
  request: Request
}): Response {
  if (!isAuthenticated(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  return new Response(GENERATED_CONTENT_CONTAINMENT_REASON, {
    status: 410,
    headers: CONTAINMENT_HEADERS,
  })
}

export const Route = createFileRoute('/api/preview-file')({
  server: {
    handlers: {
      GET: previewFileGetHandler,
    },
  },
})
