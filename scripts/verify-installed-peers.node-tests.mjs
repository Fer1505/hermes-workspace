import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { validateInstalledPeers } from './verify-installed-peers.mjs'

async function fixture({
  peerRange,
  peerVersion,
  optional = false,
  consumerName = 'consumer',
  rootPeerVersion,
}) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'hermes-peer-contract-'),
  )
  const context = path.join(root, 'node_modules', '.pnpm', 'fixture', 'node_modules')
  const consumer = path.join(context, ...consumerName.split('/'))
  await fs.mkdir(consumer, { recursive: true })
  await fs.writeFile(
    path.join(consumer, 'package.json'),
    JSON.stringify({
      name: consumerName,
      version: '1.0.0',
      peerDependencies: { peer: peerRange },
      peerDependenciesMeta: optional ? { peer: { optional: true } } : {},
    }),
  )
  if (peerVersion) {
    const peer = path.join(context, 'peer')
    await fs.mkdir(peer, { recursive: true })
    await fs.writeFile(
      path.join(peer, 'package.json'),
      JSON.stringify({ name: 'peer', version: peerVersion }),
    )
  }
  if (rootPeerVersion) {
    const rootPeer = path.join(root, 'node_modules', 'peer')
    await fs.mkdir(rootPeer, { recursive: true })
    await fs.writeFile(
      path.join(rootPeer, 'package.json'),
      JSON.stringify({ name: 'peer', version: rootPeerVersion }),
    )
  }
  return { root, consumer }
}

async function validateFixture(options) {
  const value = await fixture(options)
  try {
    return await validateInstalledPeers({
      projectRoot: value.root,
      packageDirectories: [value.consumer],
    })
  } finally {
    await fs.rm(value.root, { recursive: true, force: true })
  }
}

test('accepts a resolved peer within its declared range', async () => {
  const result = await validateFixture({
    peerRange: '^9.0.0',
    peerVersion: '9.39.4',
  })
  assert.deepEqual(result.violations, [])
  assert.equal(result.checkedPeers, 1)
})

test('rejects an incompatible resolved peer', async () => {
  const result = await validateFixture({
    peerRange: '^8.0.0 || ^9.0.0',
    peerVersion: '10.2.0',
  })
  assert.equal(result.violations.length, 1)
  assert.match(result.violations[0], /resolved peer@10\.2\.0/)
})

test('rejects a missing required peer', async () => {
  const result = await validateFixture({ peerRange: '^9.0.0' })
  assert.equal(result.violations.length, 1)
  assert.match(result.violations[0], /missing peer/)
})

test('allows a missing optional peer', async () => {
  const result = await validateFixture({
    peerRange: '^9.0.0',
    optional: true,
  })
  assert.deepEqual(result.violations, [])
  assert.equal(result.checkedPeers, 0)
})

test('rejects a present incompatible optional peer', async () => {
  const result = await validateFixture({
    peerRange: '^9.0.0',
    peerVersion: '10.2.0',
    optional: true,
  })
  assert.equal(result.violations.length, 1)
  assert.match(result.violations[0], /resolved peer@10\.2\.0/)
})

test('scoped consumers resolve peers from their pnpm instance context', async () => {
  const result = await validateFixture({
    consumerName: '@scope/consumer',
    peerRange: '^9.0.0',
    peerVersion: '9.39.4',
    rootPeerVersion: '10.2.0',
  })
  assert.deepEqual(result.violations, [])
  assert.equal(result.checkedPeers, 1)
})

test('does not substitute a root peer for a missing instance peer', async () => {
  const result = await validateFixture({
    consumerName: '@scope/consumer',
    peerRange: '^9.0.0',
    rootPeerVersion: '9.39.4',
  })
  assert.equal(result.violations.length, 1)
  assert.match(result.violations[0], /missing peer/)
})
