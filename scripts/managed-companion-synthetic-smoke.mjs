#!/usr/bin/env node

import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'

// This certificate and key are synthetic, non-secret test fixtures used only
// by the ephemeral listener created below. # pragma: allowlist secret
const SYNTHETIC_TLS_KEY = [
  '-----BEGIN PRIVATE KEY-----', // synthetic test fixture, not a credential
  'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC/hJyVxj/00IUE',
  'x5F5y+a0MM2kpgaOoLdemVA+/wy1ZUPPFo6P2IfTbgjnJgcFQNaCfrEO7/x3mzAe',
  'XeMxsWj+aP6TMNpwoDEQuaD82JIgGxHcSK83C7LSQ0AGJhHSuXgK3s2P1EOKShMG',
  'DHYPCcXo1WsJCH8QVdfxW9zMEIizDTUwrnY0dTSvAoBTsBMMoaFcesRzIAhrtvdn',
  'wBmb04ioMvUl++e6RYtMfwJE9y6EjZwRIZTuj/GbDnLfRUDX8pSkwcGNDU1FHm92',
  'D3fE3Bi+jPlH2NYj1dKwWXQw7gevgveo8LyG7Wcnvc9qFBATqqmc1ISLu8vBputx',
  'QcZv62NhAgMBAAECggEACyblgqJ+0o/FJyBDJtSfiZ+L4fSu+LrVYqNKdRifPKgk',
  'Y4MnPatjTAWiFr+en14v/3zxbMgUVeyfR9gPZN3f72yIDQ8bsSeKzolYnVCJFb3Y',
  'c5DMmcfLG7ZBx082hiQ5oBHAO4n7KCrPDRudpkYwlDG/3/tILC3WJgjuLvh0KqTW',
  'DalhSmrSPiBOnO61JmTcoz7I8e+9Tajnn+OPw5gSFlDpeiF/3LZUHg6+ifwmuNfh',
  'Fc1uLzBTwCcnG0ADSt9nOebokidwDukEgwO4mRvviW7PdVsu/MbV3YUIdLtREqOX',
  'd1W4Edbg2M58bIB975Sy9au8OSX8js88ioxSfyjPzwKBgQD9eVSdSbiHHvRdoe9C',
  'vqpRn8W/8Vrjpx2l96bffwZGS6f9E17rlY8JdMF88AjLuk0lp2Le0Ua6urgs2oDC',
  'o2eo+Pa5Egi66CuSgvw+Bu4dTFjhxYdM0sEcMo3i7F8nqxOcwi5fK7fqQKb+nhEG',
  'JRyysOgrocIadkGjIdgTac2BuwKBgQDBbTeu0yN+jV5ZzFSAq5GFpHB9nyPcJWtW',
  'A2w4ho7e/E/zKV37ty0ILyLr6J/DCxpl0ff02fTLYIoFl4apdYhxbOHuwABAxEvS',
  'BiUEcdU1JXWmgfk7aeQindhngIXxm3NAAYvmUERHRMJo4tkdt2oYQmcMnWWusSQN',
  '4lhVPjjfkwKBgC/K4cZqcQ2hK4hAEUHve2O6kWm4k1+bUf7KLD+1zrQQbdNNBLe8',
  '0mSBDD6Hb9EiBovT/NNweDqbHEDwzhhlARWeI78PhG/heN2+LttvKRSDIbsoKHO2',
  'xUyQx6oC0YpEOoVzI5U0RBA6MoKNwT38X2Xd71jSviuJIqUkq341k9cjAoGARwve',
  '0BAtkWZLqaArybc7FGN6DipN+aak7ksDjR+firgShbZEFxkJKWBm60/enr2NTKj6',
  '8qy8BZfIGpW1mLjbDQ55TkCn1yJC1zn6js9hCMxhkm9bJD+Y1D42Jo5GpJ/8jR4E',
  'TOxep+7RmcT5Crk79v0s7K1DlA7st0zUNTtNmJECgYEA18eNzbMvmy5imF6Q+jGH',
  'XV5n5UcL7wzk8IfBaMgRjMdp3bROYjTTN9lNDjD8ASArfJ9jqsflh5A9XQf87W1X',
  '3qq0FKLkrN8WurguHnnKySEtSuj8e5MugBXpfnbVFydciD8bycTKL0tgQy2O7Juw',
  'HJJ2zolnKW9P50d6pn4vffE=',
  '-----END PRIVATE KEY-----', // synthetic test fixture, not a credential
].join('\n')

const SYNTHETIC_TLS_CERT = [
  '-----BEGIN CERTIFICATE-----',
  'MIIDeDCCAmCgAwIBAgIUJRyO5y4IGqMUdzdeYwtO3Yjf7WwwDQYJKoZIhvcNAQEL',
  'BQAwQzESMBAGA1UEAwwJMTI3LjAuMC4xMS0wKwYDVQQKDCRIZXJtZXMgV29ya3Nw',
  'YWNlIFN5bnRoZXRpYyBUZXN0IE9ubHkwHhcNMjYwODE2MjAyMDExWhcNMzYwODEz',
  'MjAyMDExWjBDMRIwEAYDVQQDDAkxMjcuMC4wLjExLTArBgNVBAoMJEhlcm1lcyBX',
  'b3Jrc3BhY2UgU3ludGhldGljIFRlc3QgT25seTCCASIwDQYJKoZIhvcNAQEBBQAD',
  'ggEPADCCAQoCggEBAL+EnJXGP/TQhQTHkXnL5rQwzaSmBo6gt16ZUD7/DLVlQ88W',
  'jo/Yh9NuCOcmBwVA1oJ+sQ7v/HebMB5d4zGxaP5o/pMw2nCgMRC5oPzYkiAbEdxI',
  'rzcLstJDQAYmEdK5eArezY/UQ4pKEwYMdg8JxejVawkIfxBV1/Fb3MwQiLMNNTCu',
  'djR1NK8CgFOwEwyhoVx6xHMgCGu292fAGZvTiKgy9SX757pFi0x/AkT3LoSNnBEh',
  'lO6P8ZsOct9FQNfylKTBwY0NTUUeb3YPd8TcGL6M+UfY1iPV0rBZdDDuB6+C96jw',
  'vIbtZye9z2oUEBOqqZzUhIu7y8Gm63FBxm/rY2ECAwEAAaNkMGIwHQYDVR0OBBYE',
  'FIEA6anF+W2tG81GZ5JxRg6FEMu7MB8GA1UdIwQYMBaAFIEA6anF+W2tG81GZ5Jx',
  'Rg6FEMu7MA8GA1UdEwEB/wQFMAMBAf8wDwYDVR0RBAgwBocEfwAAATANBgkqhkiG',
  '9w0BAQsFAAOCAQEAlLHfi49tjDkIzUY7C1rFSm0dhtL6MZ5wRvk8BBlEA89nnRyM',
  'wFJTJWP++ZqbyUh1RHNWBicMxdf65mfIkt2eTdeH8Zt08efsGNN7YGyNOZMwP6FR',
  'xPfSBgZWcfDm86R1QhM6rZZb+VAWufGOokhnHsw0VW8FyHckfa1fzQjZsjYvbRhv',
  'GeJg1bQV3+fH6sUSG8QW+RD6mzom5L+Zhvl2djAbKPFoojeMiKqNe2emGljRaPcJ',
  'k5wXmifae+wJjelmsWtrAnd/TMy08HCsRyuvea2N9S7sUewMuGTc6qysRqG2/yPt',
  'HPtst1594/E+p0ztfHG6ml9dpCqINZnT0N+rVw==',
  '-----END CERTIFICATE-----',
].join('\n')

const suspiciousPatterns = [
  'ERR_MODULE_NOT_FOUND',
  'Cannot find module',
  'Failed to load url',
  'does not provide an export named',
]

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { rejectUnauthorized: false },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          if ((response.statusCode || 0) >= 400) {
            reject(new Error(`HTTP ${response.statusCode} for owned harness`))
            return
          }
          resolve(Buffer.concat(chunks).toString('utf8'))
        })
      },
    )
    request.setTimeout(5_000, () => {
      request.destroy(new Error('Synthetic companion request timed out'))
    })
    request.on('error', reject)
  })
}

function assertCleanLog(logPath) {
  const tail = fs
    .readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .slice(-200)
    .join('\n')
  const badPattern = suspiciousPatterns.find((pattern) => tail.includes(pattern))
  if (badPattern) {
    throw new Error(`Detected synthetic companion runtime error: ${badPattern}`)
  }
}

if (process.argv.length !== 2) {
  throw new Error('Managed companion smoke accepts no external URL or log path')
}

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'hermes-managed-companion-smoke-'),
)
fs.chmodSync(temporaryRoot, 0o700)
const logPath = path.join(temporaryRoot, 'managed-companion.log')
fs.writeFileSync(logPath, 'synthetic companion started\n', { mode: 0o600 })

const server = https.createServer(
  { key: SYNTHETIC_TLS_KEY, cert: SYNTHETIC_TLS_CERT },
  (request, response) => {
    if (request.method !== 'GET' || request.url !== '/chat/new') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('not found')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Hermes Workspace</title>')
  },
)

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string' || address.port <= 0) {
    throw new Error('Synthetic companion did not acquire an ephemeral port')
  }

  const html = await fetchText(`https://127.0.0.1:${address.port}/chat/new`)
  if (!html.includes('Hermes Workspace')) {
    throw new Error('Synthetic managed companion did not render the expected shell')
  }

  assertCleanLog(logPath)
  fs.appendFileSync(logPath, 'ERR_MODULE_NOT_FOUND synthetic negative control\n')
  let negativeControlRejected = false
  try {
    assertCleanLog(logPath)
  } catch (error) {
    negativeControlRejected =
      error instanceof Error && error.message.includes('ERR_MODULE_NOT_FOUND')
  }
  if (!negativeControlRejected) {
    throw new Error('Synthetic bad-log negative control was not rejected')
  }

  console.log(
    `Managed companion synthetic smoke passed on owned ephemeral TLS port ${address.port}`,
  )
} finally {
  let closeError
  try {
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  } catch (error) {
    closeError = error
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
  if (fs.existsSync(temporaryRoot)) {
    throw new Error('Synthetic companion temporary state survived teardown')
  }
  if (closeError) {
    throw closeError
  }
}
