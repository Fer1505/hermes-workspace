# Olympus Managed Attach: Hermes Workspace + Hermes Agent

This runbook is for attaching Hermes Workspace to an Olympus-managed Hermes Agent runtime without overwriting profile-scoped state.

## Current Olympus Runtime

- Mission Control owns `127.0.0.1:3000`.
- Hermes Workspace runs loopback-only on `127.0.0.1:3100`.
- The shared Hermes Agent API runs on `127.0.0.1:8642`.
- The dashboard/API helper runs on `127.0.0.1:9119`.
- The active managed profile is `olympus-hermes` under `/Users/hermes/Olympus/runtime/hermes-agent/profiles/olympus-hermes`.

## Attach Path

Use the managed launcher from the Olympus core repo whenever possible:

```bash
/Users/hermes/Olympus/core/messa-brain-v2/scripts/run_hermes_workspace.sh
```

For a manual dev attach from this checkout:

```bash
cd /Users/hermes/Olympus/source-checkouts/hermes-workspace
pnpm install
HERMES_HOME=/Users/hermes/Olympus/runtime/hermes-agent/profiles/olympus-hermes \
HERMES_API_URL=http://127.0.0.1:8642 \
HERMES_DASHBOARD_URL=http://127.0.0.1:9119 \
PORT=3100 \
pnpm dev
```

The owning Hermes Agent API profile must have `API_SERVER_ENABLED=true`. If the gateway uses `API_SERVER_KEY`, set the same value in Workspace as `HERMES_API_TOKEN`.

## Do Not Do This On Olympus

- Do not run the public fresh-install one-liner against the managed Olympus runtime.
- Do not bind Workspace to `:3000`; Mission Control already owns that port.
- Do not bind Workspace or the gateway to non-loopback hosts without reviewed auth and network controls.
- Do not treat a public `~/.hermes` layout as the source of truth for Olympus profile state.

## Verification

```bash
curl http://127.0.0.1:8642/health
curl http://127.0.0.1:9119/api/status
curl http://127.0.0.1:3100/api/connection-status
```
