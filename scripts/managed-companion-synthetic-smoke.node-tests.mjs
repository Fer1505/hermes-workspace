import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function smokeRoots() {
  return new Set(
    (await fs.readdir(os.tmpdir())).filter((entry) =>
      entry.startsWith('hermes-managed-companion-smoke-'),
    ),
  )
}

async function connectionFails(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(true))
    socket.setTimeout(2_000, () => {
      socket.destroy()
      resolve(true)
    })
  })
}

test('synthetic managed companion owns and tears down its listener and state', async () => {
  const before = await smokeRoots()
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [path.join(process.cwd(), 'scripts/managed-companion-synthetic-smoke.mjs')],
    { timeout: 15_000 },
  )
  assert.equal(stderr, '')
  const portMatch = stdout.match(/owned ephemeral TLS port (\d+)/)
  assert.ok(portMatch, `missing owned-port evidence in: ${stdout}`)
  const port = Number(portMatch[1])
  assert.equal(await connectionFails(port), true)
  assert.deepEqual(await smokeRoots(), before)
})

test('synthetic smoke rejects external URL or log arguments without state', async () => {
  const before = await smokeRoots()
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        path.join(process.cwd(), 'scripts/managed-companion-synthetic-smoke.mjs'),
        'https://127.0.0.1:4445/chat/new',
      ],
      { timeout: 5_000 },
    ),
    (error) => {
      assert.match(error.stderr, /accepts no external URL or log path/)
      return true
    },
  )
  assert.deepEqual(await smokeRoots(), before)
})
