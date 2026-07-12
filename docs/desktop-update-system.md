# Hermes Workspace Desktop Update System

This document describes the update API contract and its current containment
state. The API is not an in-process source updater.

## Products

Hermes ships two separately updateable products:

1. **Hermes Workspace**: the UI/server shell.
2. **Hermes Agent**: the local agent/gateway runtime.

They must not be modeled as two remotes in the same git checkout. A future
release system must activate Workspace and Agent as separately attested
artifacts.

## API

- `GET /api/update/status`
  - returns Workspace + Agent version/install/update observations.
  - reports `canUpdate: false` and `state: blocked` with the stable containment
    reason for both products.
- `POST /api/update/workspace`
  - returns the containment result before status discovery, Git, filesystem,
    package-manager, build, activation, or receipt activity.
- `POST /api/update/agent`
  - returns the same containment result before any updater activity.

## Install kinds

Current implementation detects:

- `git`: development/source checkout.
- `docker`: running in container, update is not applied in-process.
- `desktop`: the source API is blocked; the native Electron updater is a
  separate lane described below.
- `unknown`: cannot safely update automatically.

## Current source containment

One-click source mutation is disabled for every checkout shape, including
clean, dirty, ahead, behind, and diverged repositories. Observed version, head,
and dirty-file metadata may still be reported by the status endpoint, but that
metadata cannot authorize an update. The fixed operator-facing reason is:

> One-click source updates are disabled until the reviewed staged-release
> workflow provides immutable artifacts, frozen dependencies, atomic
> activation, health/readback, and rollback.

The former source apply implementation has been removed. In particular, there
is no hard-reset fallback, non-frozen dependency install, in-place build, or
update receipt write in either POST path. Packaged production prefers the
tracked `electron/server-bundle.cjs`, so that execution surface carries the
same narrow containment patch and a focused parity test rejects either removed
hazard, status-logic drift, or an apply body that is no longer fail-closed.

## Native Electron updater: active and deferred

This source-API freeze does **not** disable the independent native updater in
`electron/main.cjs`. That lane still checks GitHub releases after startup,
offers a download, enables installation on application quit, and can call
`quitAndInstall()`. It is not controlled by `/api/update/*` and must not be
treated as an attested staged release merely because its native flow succeeds.

The native lane remains deferred `RUN-001` P1 work. Before it can satisfy the
Olympus release contract, it must provide:

1. Signed, immutable Workspace and Agent artifacts with exact digests and
   frozen dependency resolution.
2. Staging that does not mutate the loaded release.
3. Atomic activation with rollback.
4. Post-activation health and readback against the loaded process identity.
5. A governed receipt binding artifact, configuration, policy, schema, process,
   health, and rollback outcome.

Only after those controls are implemented and reviewed should either the native
lane or an API bridge report an authorized, current loaded release.
