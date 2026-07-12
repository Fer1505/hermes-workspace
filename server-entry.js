import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import server from './dist/server/server.js'
import requestBodyLimit from './server/request-body-limit.cjs'
import responseHeaderPolicy from './server/response-header-policy.cjs'
import staticFilePolicy from './server/static-file-policy.cjs'

const {
  MAX_REQUEST_BODY_BYTES,
  readBoundedRequestBody,
  RequestBodyTooLargeError,
} = requestBodyLimit
const { mergeResponseSecurityHeaders } = responseHeaderPolicy
const {
  STATIC_FILE_CONTAINMENT_REASON,
  STATIC_FILE_DENIAL_HEADERS,
  classifyStaticRequest,
  resolveContainedStaticPath,
} = staticFilePolicy

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const CLIENT_DIR = join(__dirname, 'dist', 'client')

// Content Security Policy — emitted as an HTTP response header on EVERY
// response so the policy survives any edge body transformations (e.g.
// Cloudflare's JS Challenge inserting a `<meta http-equiv="Content-Security-Policy">`
// with a per-request nonce into the served HTML when a request trips the
// "impersonate browsers" rule).
//
// KEEP IN SYNC with `src/lib/csp.ts` (single source of truth) and
// `src/routes/__root.tsx` APP_CSP (which emits the same policy as `<meta>`).
// If you change the directives here, change them in all three places.
const APP_CSP_HEADERS = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' ws: wss: http: https:",
  "worker-src 'self' blob:",
  "media-src 'self' blob: data:",
  "frame-src 'self' http: https:",
].join('; ')

const ALWAYS_HEADERS = {
  'Content-Security-Policy': APP_CSP_HEADERS,
  // Tighten later if/when CSP moves to nonce-based — the dash prefix
  // makes adding/removing trivial without searching the codebase.
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
}

const port = parseInt(process.env.PORT || '3000', 10)
// Default HOST to localhost-only. Operators who want the workspace reachable
// on a LAN / Tailscale / public surface must opt in explicitly with
// HOST=0.0.0.0 *and* set CLAUDE_PASSWORD (enforced below). See #122.
const host = process.env.HOST || '127.0.0.1'

function isNonLoopbackHost(h) {
  if (!h) return false
  const norm = h.trim().toLowerCase()
  if (norm === '127.0.0.1' || norm === '::1' || norm === 'localhost') {
    return false
  }
  return true
}

if (isNonLoopbackHost(host)) {
  // Honor HERMES_PASSWORD (current name) with CLAUDE_PASSWORD as a back-compat
  // fallback for deployments configured pre-rename.
  const password = (
    process.env.HERMES_PASSWORD ||
    process.env.CLAUDE_PASSWORD ||
    ''
  ).trim()
  if (!password) {
    console.error(
      '\n[workspace] refusing to start.\n' +
        `  HOST is set to "${host}" (non-loopback), but HERMES_PASSWORD is unset.\n` +
        '  This would expose a high-privilege control plane (terminals, files, agents)\n' +
        '  to anyone who can reach the port. Either:\n' +
        '    • set HOST=127.0.0.1 for local-only access, or\n' +
        '    • set HERMES_PASSWORD=<strong-secret> to enable workspace auth, or\n' +
        '    • set HERMES_ALLOW_INSECURE_REMOTE=1 to bypass this check (not recommended).\n' +
        '  See #122 for context.\n',
    )
    const allowInsecure = (
      process.env.HERMES_ALLOW_INSECURE_REMOTE ||
      process.env.CLAUDE_ALLOW_INSECURE_REMOTE ||
      ''
    )
      .trim()
      .toLowerCase()
    if (
      allowInsecure !== '1' &&
      allowInsecure !== 'true' &&
      allowInsecure !== 'yes'
    ) {
      process.exit(1)
    }
    console.warn(
      '[workspace] HERMES_ALLOW_INSECURE_REMOTE is set — starting anyway.',
    )
  }

  // Warn when serving over plain HTTP with a password: NODE_ENV=production
  // sets the Secure flag on session cookies, which browsers silently drop
  // over http://.  Operators must set COOKIE_SECURE=0 for plain-HTTP LAN
  // deployments.  See #149.
  const cookieSecureOverride = (process.env.COOKIE_SECURE || '')
    .trim()
    .toLowerCase()
  const cookieSecureExplicit =
    cookieSecureOverride === '0' ||
    cookieSecureOverride === 'false' ||
    cookieSecureOverride === 'no'
  if (!cookieSecureExplicit && process.env.NODE_ENV === 'production') {
    console.warn(
      '\n[workspace] warning: plain-HTTP LAN deployment detected.\n' +
        '  NODE_ENV=production enables the Secure flag on session cookies.\n' +
        '  Browsers silently drop Secure cookies over http://, so login will fail.\n' +
        '  Add COOKIE_SECURE=0 to your .env to fix this.  See #149.\n',
    )
  }
}

function endStaticDenial(req, res, classification) {
  const reason = classification.reason || STATIC_FILE_CONTAINMENT_REASON
  res.writeHead(classification.status || 404, {
    ...STATIC_FILE_DENIAL_HEADERS,
    'Content-Length': Buffer.byteLength(reason),
  })
  res.end(req.method === 'HEAD' ? undefined : reason)
}

async function tryServeStatic(req, res) {
  const classification = classifyStaticRequest(req.url || '/', req.method)
  if (classification.action === 'app') return false
  if (classification.action === 'deny') {
    endStaticDenial(req, res, classification)
    return true
  }

  const filePath = resolveContainedStaticPath(
    CLIENT_DIR,
    classification.pathname,
  )
  if (!filePath) {
    endStaticDenial(req, res, classification)
    return true
  }

  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) throw new Error('not a file')
    const data = req.method === 'HEAD' ? null : await readFile(filePath)

    const headers = {
      ...classification.headers,
      'Content-Type': classification.contentType,
      'Content-Length': data?.length ?? fileStat.size,
      'Cache-Control': classification.immutable
        ? 'public, max-age=31536000, immutable'
        : 'no-store',
    }

    res.writeHead(200, headers)
    res.end(data || undefined)
    return true
  } catch {
    endStaticDenial(req, res, classification)
    return true
  }
}

async function requestHandler(req, res) {
  // Try static files first (client assets)
  if (req.method === 'GET' || req.method === 'HEAD') {
    const served = await tryServeStatic(req, res)
    if (served) return
  }

  // Fall through to SSR handler
  const url = new URL(
    req.url || '/',
    `http://${req.headers.host || 'localhost'}`,
  )

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }

  let body = null
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      body = await readBoundedRequestBody(req, MAX_REQUEST_BODY_BYTES)
    } catch (error) {
      const tooLarge = error instanceof RequestBodyTooLargeError
      const status = tooLarge ? 413 : 400
      res.writeHead(status, {
        ...ALWAYS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        Connection: 'close',
      })
      res.end(
        JSON.stringify({
          ok: false,
          error: tooLarge ? 'Request body too large' : 'Invalid request body',
        }),
      )
      return
    }
  }

  const request = new Request(url.toString(), {
    method: req.method,
    headers,
    body,
    duplex: 'half',
  })

  try {
    const response = await server.fetch(request)

    const reqPathname = new URL(request.url).pathname

    // Keep the adapter defaults authoritative for pages while preserving the
    // exact inert CSP/referrer pair deliberately emitted by /api/* generated-
    // content boundaries. The merge also folds header names case-insensitively.
    const headers = mergeResponseSecurityHeaders(
      response.headers,
      ALWAYS_HEADERS,
      { isApi: reqPathname.startsWith('/api/') },
    )

    // The same case-insensitive merge also replaces any /api/* route cache
    // fields with one exact no-store policy. Static assets short-circuit before
    // this branch and retain their immutable headers.

    res.writeHead(response.status, headers)

    if (response.body) {
      const reader = response.body.getReader()
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(value)
        }
        res.end()
      }
      pump().catch((err) => {
        console.error('Stream error:', err)
        res.end()
      })
    } else {
      const text = await response.text()
      res.end(text)
    }
  } catch (err) {
    console.error('Request error:', err)
    res.writeHead(500)
    res.end('Internal Server Error')
  }
}

function listenOn(bindHost) {
  const httpServer = createServer(requestHandler)
  httpServer.listen(port, bindHost, () => {
    console.log(`Hermes Workspace running at http://${bindHost}:${port}`)
  })
  return httpServer
}

listenOn(host)

// Cloudflared remote-managed ingress currently points at http://localhost:10280.
// On macOS, localhost may resolve to ::1 before 127.0.0.1; if Workspace only
// listens on IPv4 loopback, tunneled requests intermittently fail with
// `dial tcp [::1]:10280: connect: connection refused`. Keep the default
// local-only security posture while also serving IPv6 loopback.
if (host === '127.0.0.1') {
  listenOn('::1')
}
