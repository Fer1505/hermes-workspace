/**
 * Source-only containment policy for agent-generated content.
 *
 * This module deliberately has no Node dependencies so the server routes and
 * browser UI use the same exact extension and MIME decisions.
 */
export const GENERATED_CONTENT_CONTAINMENT_REASON =
  'Generated executable-content previews are disabled until an isolated, least-privilege preview origin is available.'

const EXECUTABLE_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.xhtml',
  '.js',
  '.mjs',
  '.svg',
  '.pdf',
])

const EXECUTABLE_MIME_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'application/javascript',
  'text/javascript',
  'application/ecmascript',
  'text/ecmascript',
  'image/svg+xml',
  'application/pdf',
])

const SAFE_RASTER_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.avif',
])

const SAFE_RASTER_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/avif',
])

function terminalExtension(name: string): string {
  let decoded = name.trim()
  for (let attempts = 0; attempts < 3; attempts += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      break
    }
  }
  const normalized = decoded.split(/[?#]/, 1)[0]?.toLowerCase() ?? ''
  const slash = Math.max(
    normalized.lastIndexOf('/'),
    normalized.lastIndexOf('\\'),
  )
  const basename = normalized.slice(slash + 1)
  const dot = basename.lastIndexOf('.')
  return dot >= 0 ? basename.slice(dot) : ''
}

function normalizedMimeType(mime: string): string {
  return mime.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

export function isExecutableGeneratedContentName(name: string): boolean {
  return EXECUTABLE_EXTENSIONS.has(terminalExtension(name))
}

export function isExecutableGeneratedContentMime(mime: string): boolean {
  return EXECUTABLE_MIME_TYPES.has(normalizedMimeType(mime))
}

export function isSafeRasterName(name: string): boolean {
  return SAFE_RASTER_EXTENSIONS.has(terminalExtension(name))
}

export function isSafeRasterMime(mime: string): boolean {
  return SAFE_RASTER_MIME_TYPES.has(normalizedMimeType(mime))
}
