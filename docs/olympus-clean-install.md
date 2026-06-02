# Olympus clean install: Hermes Workspace + Hermes Agent

This runbook is for attaching Hermes Workspace to an Olympus-managed Hermes
Agent install without overwriting the profile-scoped runtime.

## What Workspace is for

Hermes Workspace is the web command center for Hermes Agent. It brings chat,
sessions, files, memory, skills, terminal, Conductor, and Operations into one
browser UI. In zero-fork mode it talks to two Hermes Agent services:

- Gateway, usually `http://127.0.0.1:8642`, for health, models, chat, and
  streaming.
- Dashboard, usually `http://127.0.0.1:9119`, for sessions, config, skills,
  jobs, MCP, mission APIs, and kanban-backed operations.

## Olympus runtime facts from the June 2, 2026 audit

- Olympus Mission Control already owns `127.0.0.1:3000`.
- Hermes Agent dashboard was reachable on `127.0.0.1:9119` for the
  `prometheus` profile.
- The gateway process was running for Olympus-managed profiles, but
  `127.0.0.1:8642/health` was not bound during the audit.
- Hermes Agent profiles live under
  `/Users/hermes/Olympus/runtime/hermes-agent/profiles/<profile>`, not under a
  default `~/.hermes`-only layout.
- Profile `.env` files did not contain `API_SERVER_ENABLED=true`, so the core
  gateway API must be enabled deliberately for whichever profile owns the
  Workspace pairing.

## Clean attach path for Olympus

Use an attach install, not the public one-line fresh install, when Olympus
already owns the Hermes Agent runtime.

```bash
cd /Users/hermes/Olympus/source-checkouts/hermes-workspace
pnpm install
cp .env.example .env

printf '%s\n' \
  'PORT=3100' \
  'HERMES_API_URL=http://127.0.0.1:8642' \
  'HERMES_DASHBOARD_URL=http://127.0.0.1:9119' \
  >> .env
```

Enable the core API in the owning Hermes profile env before expecting full chat
pairing:

```bash
HERMES_PROFILE_ENV=/Users/hermes/Olympus/runtime/hermes-agent/profiles/prometheus/.env
grep -q '^API_SERVER_ENABLED=' "$HERMES_PROFILE_ENV" && \
  sed -i.bak 's/^API_SERVER_ENABLED=.*/API_SERVER_ENABLED=true/' "$HERMES_PROFILE_ENV" || \
  echo 'API_SERVER_ENABLED=true' >> "$HERMES_PROFILE_ENV"
```

Then restart the Olympus-managed gateway for that profile through the normal
service path and verify:

```bash
curl http://127.0.0.1:8642/health
curl http://127.0.0.1:9119/api/status
PORT=3100 pnpm dev
```

Open `http://localhost:3100`.

## Do not do this on Olympus

- Do not run the public fresh-install one-liner against the managed Olympus
  runtime unless the goal is to create a separate `~/hermes-workspace` and
  `~/.hermes` install.
- Do not bind Workspace to `:3000`; Mission Control already uses it.
- Do not treat `~/.hermes/skills` as the only source of truth for Olympus
  skills. Profile-scoped runtime skills and policy packs need their own owner.
- Do not set `API_SERVER_HOST=0.0.0.0` without `API_SERVER_KEY` and a matching
  `HERMES_API_TOKEN`.

## Public website/install copy that should stay aligned

The website should separate the two user paths:

- Fresh install: one-liner installs Hermes Agent, clones Workspace, enables the
  gateway API, writes `HERMES_API_URL`, writes `HERMES_DASHBOARD_URL`, chooses a
  free UI port, and starts gateway, dashboard, and Workspace.
- Existing/managed install: clone Workspace, set `PORT`, `HERMES_API_URL`, and
  `HERMES_DASHBOARD_URL`, then attach to the already-running Hermes services.

Avoid stale language like "Project Agent" and avoid promising that `:3000` is
always available.

## Responsible gods

- Athena owns public narrative, website copy, and install-path clarity.
- Prometheus owns installer/runtime wiring and rollout safety.
- Atlas owns port audits, health checks, and security review.
- Themis owns secrets, tokens, and non-loopback approval gates.
- Hestia owns steady-state LaunchAgent/service reliability.
