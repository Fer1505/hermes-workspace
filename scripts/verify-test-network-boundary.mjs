#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'

const directUndiciImport =
  /(?:from\s*|import\s*(?:\(\s*)?|require\(\s*)['"](?:node:)?undici(?:\/[^'"]*)?['"]/u
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'])

async function sourceFiles(directory) {
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const candidate = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await sourceFiles(candidate)))
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(candidate)
  }
  return files
}

const roots = ['src', 'server', 'electron']
const violations = []
let scanned = 0
for (const root of roots) {
  for (const file of await sourceFiles(path.resolve(root))) {
    if (file.endsWith(path.join('electron', 'server-bundle.cjs'))) continue
    scanned += 1
    const source = await fs.readFile(file, 'utf8')
    if (directUndiciImport.test(source)) violations.push(path.relative('.', file))
  }
}

if (scanned === 0) throw new Error('Test network-boundary scan inspected zero files')
if (violations.length > 0) {
  throw new Error(
    `Direct undici imports bypass the Vitest fetch guard:\n${violations.join('\n')}`,
  )
}
console.log(`Test network-boundary imports verified across ${scanned} source files`)
