import fs from 'node:fs/promises'
import path from 'node:path'

export const SERVED_ROOT_WRITE_CONTAINMENT_REASON =
  'Workspace file mutations cannot target Hermes Workspace served roots.'

export class ServedRootWriteDeniedError extends Error {
  constructor() {
    super(SERVED_ROOT_WRITE_CONTAINMENT_REASON)
    this.name = 'ServedRootWriteDeniedError'
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

/**
 * Resolve every existing component, including symlinks, while retaining a
 * normalized suffix for a target that does not exist yet.
 */
export async function canonicalProjectedPath(input: string): Promise<string> {
  let cursor = path.resolve(input)
  const suffix: Array<string> = []

  for (;;) {
    try {
      const canonicalAncestor = await fs.realpath(cursor)
      return path.resolve(canonicalAncestor, ...suffix)
    } catch (error) {
      if (!isMissingPathError(error)) throw error
      const parent = path.dirname(cursor)
      if (parent === cursor) throw error
      suffix.unshift(path.basename(cursor))
      cursor = parent
    }
  }
}

function containsPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}

export async function applicationServedRoots(
  applicationRoot = process.cwd(),
): Promise<Array<string>> {
  return Promise.all(
    [
      path.resolve(applicationRoot, 'public'),
      path.resolve(applicationRoot, 'dist', 'client'),
    ].map(canonicalProjectedPath),
  )
}

export async function assertNotApplicationServedRootMutation(
  targetPath: string,
  applicationRoot = process.cwd(),
): Promise<void> {
  const [candidate, servedRoots] = await Promise.all([
    canonicalProjectedPath(targetPath),
    applicationServedRoots(applicationRoot),
  ])

  if (
    servedRoots.some(
      (servedRoot) =>
        containsPath(servedRoot, candidate) ||
        containsPath(candidate, servedRoot),
    )
  ) {
    throw new ServedRootWriteDeniedError()
  }
}
