#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import semver from 'semver'

async function readManifest(packageDirectory) {
  return JSON.parse(
    await fs.readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
  )
}

async function isDirectory(candidate) {
  try {
    return (await fs.stat(candidate)).isDirectory()
  } catch {
    return false
  }
}

async function packageDirectoriesIn(contextDirectory) {
  const result = []
  for (const entry of await fs.readdir(contextDirectory, {
    withFileTypes: true,
  })) {
    if (entry.name === '.bin' || !entry.isDirectory()) continue
    const candidate = path.join(contextDirectory, entry.name)
    if (entry.name.startsWith('@')) {
      for (const scopedEntry of await fs.readdir(candidate, {
        withFileTypes: true,
      })) {
        if (scopedEntry.isDirectory()) {
          result.push(path.join(candidate, scopedEntry.name))
        }
      }
    } else {
      result.push(candidate)
    }
  }
  return result
}

export async function discoverPhysicalPackageDirectories(projectRoot) {
  const storeRoot = path.join(projectRoot, 'node_modules', '.pnpm')
  const packageDirectories = []

  for (const entry of await fs.readdir(storeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    const contextDirectory = path.join(storeRoot, entry.name, 'node_modules')
    if (await isDirectory(contextDirectory)) {
      packageDirectories.push(
        ...(await packageDirectoriesIn(contextDirectory)),
      )
    }
  }

  return packageDirectories
}

async function resolvePeerDirectory({
  packageDirectory,
  packageName,
  peerName,
}) {
  const peerPath = peerName.split('/')
  const contextDirectory = packageName.startsWith('@')
    ? path.dirname(path.dirname(packageDirectory))
    : path.dirname(packageDirectory)
  const candidates = [path.join(contextDirectory, ...peerPath)]

  for (const candidate of candidates) {
    if (await isDirectory(candidate)) return candidate
  }
  return null
}

export async function validateInstalledPeers({
  projectRoot,
  packageDirectories,
}) {
  const directories =
    packageDirectories ??
    (await discoverPhysicalPackageDirectories(projectRoot))
  const checkedRealPaths = new Set()
  const violations = []
  let checkedPeers = 0

  for (const packageDirectory of directories) {
    const realPackageDirectory = await fs.realpath(packageDirectory)
    if (checkedRealPaths.has(realPackageDirectory)) continue
    checkedRealPaths.add(realPackageDirectory)

    const manifest = await readManifest(packageDirectory)
    const peerDependencies = manifest.peerDependencies ?? {}
    const peerMetadata = manifest.peerDependenciesMeta ?? {}

    for (const [peerName, requiredRange] of Object.entries(peerDependencies)) {
      const optional = peerMetadata[peerName]?.optional === true
      const peerDirectory = await resolvePeerDirectory({
        packageDirectory,
        packageName: manifest.name,
        peerName,
      })

      if (!peerDirectory) {
        if (!optional) {
          violations.push(
            `${manifest.name}@${manifest.version} requires missing peer ${peerName}@${requiredRange}`,
          )
        }
        continue
      }

      const peerManifest = await readManifest(peerDirectory)
      checkedPeers += 1
      if (
        peerManifest.name !== peerName ||
        !semver.valid(peerManifest.version) ||
        !semver.validRange(requiredRange) ||
        !semver.satisfies(peerManifest.version, requiredRange)
      ) {
        violations.push(
          `${manifest.name}@${manifest.version} requires ${peerName}@${requiredRange}, resolved ${peerManifest.name}@${peerManifest.version}`,
        )
      }
    }
  }

  return {
    checkedPackages: checkedRealPaths.size,
    checkedPeers,
    violations,
  }
}

async function main() {
  const projectRoot = process.cwd()
  const result = await validateInstalledPeers({ projectRoot })
  if (result.checkedPackages === 0) {
    throw new Error('Installed peer contract verification scanned zero packages')
  }
  if (result.violations.length > 0) {
    throw new Error(
      `Installed peer contract verification failed:\n${result.violations.join('\n')}`,
    )
  }
  console.log(
    `Installed peer contracts verified: ${result.checkedPeers} peer edges across ${result.checkedPackages} physical packages`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
