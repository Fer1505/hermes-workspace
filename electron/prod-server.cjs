const http = require('http')
const fs = require('fs')
const path = require('path')
const {
  MAX_REQUEST_BODY_BYTES,
  readBoundedRequestBody,
  RequestBodyTooLargeError,
} = require('../server/request-body-limit.cjs')
const {
  STATIC_FILE_CONTAINMENT_REASON,
  STATIC_FILE_DENIAL_HEADERS,
  classifyStaticRequest,
  resolveContainedStaticPath,
} = require('../server/static-file-policy.cjs')

const portArg = process.argv.find(
  (value, index, arr) => arr[index - 1] === '--port',
)
const PORT = Number.parseInt(process.env.PORT || portArg || '3847', 10)
const DIST_CLIENT = path.join(__dirname, '..', 'dist', 'client')
const BUNDLED_SERVER = path.join(__dirname, 'server-bundle.cjs')
const UNBUNDLED_SERVER = path.join(
  __dirname,
  '..',
  'dist',
  'server',
  'server.js',
)

function endStaticDenial(req, res, classification) {
  const reason = classification.reason || STATIC_FILE_CONTAINMENT_REASON
  res.writeHead(classification.status || 404, {
    ...STATIC_FILE_DENIAL_HEADERS,
    'Content-Length': Buffer.byteLength(reason),
  })
  res.end(req.method === 'HEAD' ? undefined : reason)
}

async function loadServerBuild() {
  if (fs.existsSync(BUNDLED_SERVER)) {
    const bundled = require(BUNDLED_SERVER)
    return bundled.default || bundled
  }
  const serverModule = await import(`file://${UNBUNDLED_SERVER}`)
  return serverModule.default
}

async function main() {
  process.env.NODE_ENV = process.env.NODE_ENV || 'production'
  process.env.HERMES_WORKSPACE_DESKTOP =
    process.env.HERMES_WORKSPACE_DESKTOP || '1'
  process.env.HERMES_API_URL =
    process.env.HERMES_API_URL || 'http://127.0.0.1:8642'
  process.env.HERMES_DASHBOARD_URL =
    process.env.HERMES_DASHBOARD_URL || 'http://127.0.0.1:9119'

  const serverBuild = await loadServerBuild()

  const server = http.createServer(async (req, res) => {
    const url = req.url || '/'

    if (req.method === 'GET' || req.method === 'HEAD') {
      const classification = classifyStaticRequest(url, req.method)
      if (classification.action === 'deny') {
        endStaticDenial(req, res, classification)
        return
      }
      if (classification.action === 'static') {
        const filePath = resolveContainedStaticPath(
          DIST_CLIENT,
          classification.pathname,
        )
        if (!filePath) {
          endStaticDenial(req, res, classification)
          return
        }
        try {
          const fileStat = fs.statSync(filePath)
          if (!fileStat.isFile()) throw new Error('not a file')
          const content =
            req.method === 'HEAD' ? null : fs.readFileSync(filePath)
          res.writeHead(200, {
            ...classification.headers,
            'Content-Type': classification.contentType,
            'Content-Length': content?.length ?? fileStat.size,
            'Cache-Control': classification.immutable
              ? 'public, max-age=31536000, immutable'
              : 'no-store',
          })
          res.end(content || undefined)
          return
        } catch {
          endStaticDenial(req, res, classification)
          return
        }
      }
    }

    try {
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) {
        if (value)
          headers.set(key, Array.isArray(value) ? value.join(', ') : value)
      }
      const protocol = req.headers['x-forwarded-proto'] || 'http'
      const host = req.headers.host || `127.0.0.1:${PORT}`
      const fullUrl = `${protocol}://${host}${url}`
      const webRequest = new Request(fullUrl, {
        method: req.method,
        headers,
        body:
          req.method !== 'GET' && req.method !== 'HEAD'
            ? await readBoundedRequestBody(req, MAX_REQUEST_BODY_BYTES)
            : undefined,
        duplex: 'half',
      })
      const webResponse = await serverBuild.fetch(webRequest)
      const resHeaders = {}
      webResponse.headers.forEach((value, key) => {
        resHeaders[key] = value
      })
      res.writeHead(
        webResponse.status,
        webResponse.statusText || '',
        resHeaders,
      )
      if (webResponse.body) {
        const reader = webResponse.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(value)
        }
      }
      res.end()
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        res.writeHead(413, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          Connection: 'close',
        })
        res.end(JSON.stringify({ ok: false, error: 'Request body too large' }))
        return
      }
      console.error('[Hermes Workspace desktop] SSR error:', error)
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Internal Server Error')
    }
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(
      `[Hermes Workspace desktop] server listening on http://127.0.0.1:${PORT}`,
    )
    if (process.send) process.send({ type: 'ready', port: PORT })
  })
}

main().catch((error) => {
  console.error('[Hermes Workspace desktop] fatal:', error)
  process.exit(1)
})
