const fs = require('node:fs')
const path = require('node:path')

const STATIC_FILE_CONTAINMENT_REASON =
  'Static content is unavailable under the containment policy'

const STATIC_FILE_SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
})

const STATIC_FILE_DENIAL_HEADERS = Object.freeze({
  ...STATIC_FILE_SECURITY_HEADERS,
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Pragma: 'no-cache',
  Expires: '0',
})

const APPROVED_PUBLIC_MIME_TYPES = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
})

const APPROVED_JSON_MANIFEST_PATHS = new Set([
  '/manifest.json',
  '/assets/hermesworld/MANIFEST.json',
])

const PROTECTED_STATIC_PATH_PREFIXES = Object.freeze([
  '/.claude',
  '/.cursor',
  '/.git',
  '/.omc',
  '/.omx',
  '/.output',
  '/.runtime',
  '/.tanstack',
  '/.vscode',
  '/coverage',
  '/docs/screenshots',
  '/memory',
  '/node_modules',
  '/playwright-report',
  '/screenshots',
  '/test-results',
])

const EXECUTABLE_OR_DOCUMENT_EXTENSIONS = new Set([
  '.htm',
  '.html',
  '.xhtml',
  '.svg',
  '.xml',
  '.xsl',
  '.xslt',
  '.pdf',
  '.mjs',
  '.wasm',
])

const HASHED_BUILD_ASSET_PATTERN =
  /^\/assets\/(?:[^/]+\/)*[^/]+[-._][A-Za-z0-9_-]{8,}\.(?:js|css)$/i

function deny(code, pathname) {
  return {
    action: 'deny',
    ...(pathname ? { pathname } : {}),
    status: 404,
    headers: STATIC_FILE_DENIAL_HEADERS,
    reason: STATIC_FILE_CONTAINMENT_REASON,
    code,
  }
}

function app(pathname, code) {
  return {
    action: 'app',
    pathname,
    reason: code,
  }
}

function parseRequestPath(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    return { error: 'missing-request-target' }
  }
  if (rawUrl.includes('#')) return { error: 'fragment-in-request-target' }

  const queryIndex = rawUrl.indexOf('?')
  const rawPathname = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex)

  if (!rawPathname.startsWith('/') || rawPathname.startsWith('//')) {
    return { error: 'invalid-path-root' }
  }
  if (rawPathname.includes('\\') || /%(?:00|2f|5c)/i.test(rawPathname)) {
    return { error: 'encoded-or-literal-path-separator' }
  }
  if (/%25[0-9a-f]{2}/i.test(rawPathname)) {
    return { error: 'double-encoded-path' }
  }

  let pathname
  try {
    pathname = decodeURIComponent(rawPathname)
  } catch {
    return { error: 'malformed-path-encoding' }
  }

  if (
    pathname.includes('\\') ||
    pathname.includes('\0') ||
    pathname.includes('?') ||
    pathname.includes('#') ||
    /[\u0000-\u001f\u007f]/.test(pathname) ||
    /%[0-9a-f]{2}/i.test(pathname)
  ) {
    return { error: 'unsafe-decoded-path' }
  }
  if (pathname !== '/' && pathname.includes('//')) {
    return { error: 'empty-path-segment' }
  }

  const segments = pathname.split('/').slice(1)
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return { error: 'dot-segment' }
  }

  return { pathname }
}

function extensionOf(pathname) {
  const lastSlash = pathname.lastIndexOf('/')
  const basename = pathname.slice(lastSlash + 1)
  const lastDot = basename.lastIndexOf('.')
  if (lastDot === -1) return { extension: '', hasDot: false }
  return {
    extension: basename.slice(lastDot).toLowerCase(),
    hasDot: true,
  }
}

function approvedPublicMimeType(pathname) {
  if (APPROVED_JSON_MANIFEST_PATHS.has(pathname)) {
    return 'application/json; charset=utf-8'
  }
  const { extension } = extensionOf(pathname)
  return APPROVED_PUBLIC_MIME_TYPES[extension] || null
}

function isProtectedStaticPath(pathname) {
  const foldedPathname = pathname.toLowerCase()
  return PROTECTED_STATIC_PATH_PREFIXES.some(
    (prefix) =>
      foldedPathname === prefix || foldedPathname.startsWith(`${prefix}/`),
  )
}

/**
 * Classify a raw Node/Vite request target before any filesystem lookup.
 * Application routes are delegated to the framework; only allowlisted static
 * resources receive a relative path that an adapter may resolve under its
 * configured client root.
 */
function classifyStaticRequest(rawUrl, method = 'GET') {
  const parsed = parseRequestPath(rawUrl)
  if (parsed.error) return deny(parsed.error)

  const { pathname } = parsed
  const foldedPathname = pathname.toLowerCase()
  const normalizedMethod =
    typeof method === 'string' ? method.toUpperCase() : ''

  if (normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') {
    return app(pathname, 'non-static-method')
  }

  if (foldedPathname === '/api' || foldedPathname.startsWith('/api/')) {
    return app(pathname, 'api-route')
  }
  if (pathname === '/') return app(pathname, 'application-root')
  if (foldedPathname === '/memory') {
    return app(pathname, 'application-route')
  }
  if (foldedPathname === '/sw.js') {
    return deny('root-service-worker', pathname)
  }
  if (isProtectedStaticPath(pathname)) {
    return deny('protected-static-prefix', pathname)
  }

  const { extension, hasDot } = extensionOf(pathname)
  if (!hasDot) return app(pathname, 'extensionless-application-route')

  if (
    EXECUTABLE_OR_DOCUMENT_EXTENSIONS.has(extension) ||
    (extension === '.js' && !HASHED_BUILD_ASSET_PATTERN.test(pathname))
  ) {
    return deny('executable-or-document-static-content', pathname)
  }

  if (HASHED_BUILD_ASSET_PATTERN.test(pathname)) {
    return {
      action: 'static',
      pathname,
      relativePath: pathname.slice(1),
      contentType:
        extension === '.css'
          ? 'text/css; charset=utf-8'
          : 'application/javascript; charset=utf-8',
      immutable: true,
      headers: STATIC_FILE_SECURITY_HEADERS,
    }
  }

  const contentType = approvedPublicMimeType(pathname)
  if (!contentType) return deny('unapproved-static-extension', pathname)

  return {
    action: 'static',
    pathname,
    relativePath: pathname.slice(1),
    contentType,
    immutable: false,
    headers: STATIC_FILE_SECURITY_HEADERS,
  }
}

/**
 * Public-directory inputs are intentionally stricter than built client output:
 * executable code is never approved merely because its filename looks hashed.
 */
function isApprovedPublicAssetPath(rawUrl) {
  const requestTarget =
    typeof rawUrl === 'string' && !rawUrl.startsWith('/')
      ? `/${rawUrl}`
      : rawUrl
  const parsed = parseRequestPath(requestTarget)
  if (parsed.error) return false
  const { pathname } = parsed
  const foldedPathname = pathname.toLowerCase()
  if (
    pathname === '/' ||
    foldedPathname === '/sw.js' ||
    foldedPathname === '/api' ||
    foldedPathname.startsWith('/api/') ||
    isProtectedStaticPath(pathname)
  ) {
    return false
  }
  return approvedPublicMimeType(pathname) !== null
}

/**
 * Resolve an existing validated URL path beneath the canonical root. Resolving
 * both sides prevents a final file or parent-directory symlink from escaping
 * the served tree before an adapter stats or reads it.
 */
function resolveContainedStaticPath(root, pathname) {
  if (typeof root !== 'string' || root.length === 0) return null
  const parsed = parseRequestPath(pathname)
  if (parsed.error || parsed.pathname === '/') return null

  const lexicalRoot = path.resolve(root)
  const lexicalCandidate = path.resolve(lexicalRoot, parsed.pathname.slice(1))
  const lexicalRelative = path.relative(lexicalRoot, lexicalCandidate)

  if (
    lexicalRelative === '' ||
    lexicalRelative === '..' ||
    lexicalRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(lexicalRelative)
  ) {
    return null
  }

  try {
    const canonicalRoot = fs.realpathSync(lexicalRoot)
    const canonicalCandidate = fs.realpathSync(lexicalCandidate)
    const canonicalRelative = path.relative(canonicalRoot, canonicalCandidate)
    if (
      canonicalRelative === '' ||
      canonicalRelative === '..' ||
      canonicalRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(canonicalRelative)
    ) {
      return null
    }
    return canonicalCandidate
  } catch {
    return null
  }
}

module.exports = {
  APPROVED_JSON_MANIFEST_PATHS,
  PROTECTED_STATIC_PATH_PREFIXES,
  INERT_STATIC_HEADERS: STATIC_FILE_SECURITY_HEADERS,
  STATIC_CONTENT_CONTAINMENT_REASON: STATIC_FILE_CONTAINMENT_REASON,
  STATIC_FILE_CONTAINMENT_REASON,
  STATIC_FILE_DENIAL_HEADERS,
  STATIC_FILE_SECURITY_HEADERS,
  classifyStaticRequest,
  isApprovedPublicAssetPath,
  resolveContainedStaticPath,
}
