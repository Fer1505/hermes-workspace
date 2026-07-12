import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ServedRootWriteDeniedError,
  assertNotApplicationServedRootMutation,
  canonicalProjectedPath,
} from './served-root-write-policy'

describe('application served-root write containment', () => {
  let root = ''

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-served-root-'))
    fs.mkdirSync(path.join(root, 'public'), { recursive: true })
    fs.mkdirSync(path.join(root, 'dist', 'client'), { recursive: true })
    fs.mkdirSync(path.join(root, 'workspace'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it.each([
    ['public root', () => path.join(root, 'public')],
    ['public child', () => path.join(root, 'public', 'payload.js')],
    ['built client root', () => path.join(root, 'dist', 'client')],
    ['built client child', () => path.join(root, 'dist', 'client', 'sw.js')],
    ['served-root parent', () => root],
    ['dist parent', () => path.join(root, 'dist')],
  ])('denies mutation of %s', async (_label, target) => {
    await expect(
      assertNotApplicationServedRootMutation(target(), root),
    ).rejects.toBeInstanceOf(ServedRootWriteDeniedError)
  })

  it('denies a nonexistent child projected beneath a served root', async () => {
    await expect(
      assertNotApplicationServedRootMutation(
        path.join(root, 'public', 'future', 'payload.html'),
        root,
      ),
    ).rejects.toBeInstanceOf(ServedRootWriteDeniedError)
  })

  it('denies a symlinked path that resolves into a served root', async () => {
    const link = path.join(root, 'workspace', 'static-link')
    fs.symlinkSync(path.join(root, 'public'), link)

    await expect(
      assertNotApplicationServedRootMutation(
        path.join(link, 'payload.js'),
        root,
      ),
    ).rejects.toBeInstanceOf(ServedRootWriteDeniedError)
  })

  it('allows a sibling with a shared lexical prefix', async () => {
    const target = path.join(root, 'public-safe', 'notes.txt')
    await expect(
      assertNotApplicationServedRootMutation(target, root),
    ).resolves.toBeUndefined()
  })

  it('allows an unrelated workspace file', async () => {
    const target = path.join(root, 'workspace', 'notes.txt')
    await expect(
      assertNotApplicationServedRootMutation(target, root),
    ).resolves.toBeUndefined()
  })

  it('canonicalizes a missing suffix below a symlinked ancestor', async () => {
    const external = fs.mkdtempSync(
      path.join(os.tmpdir(), 'workspace-served-external-'),
    )
    const link = path.join(root, 'workspace', 'external-link')
    fs.symlinkSync(external, link)
    try {
      await expect(
        canonicalProjectedPath(path.join(link, 'future', 'file.txt')),
      ).resolves.toBe(
        path.join(fs.realpathSync(external), 'future', 'file.txt'),
      )
    } finally {
      fs.rmSync(external, { recursive: true, force: true })
    }
  })
})
