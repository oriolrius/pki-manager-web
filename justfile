# pki-manager tasks. `just` lists them. Guide: docs/development/setup.md
#
# The dev stack is mprocs (backend + frontend, mprocs.yaml) in the tmux session
# `dev-pki-manager`, the Backlog.md web UI in the tmux session `backlog-pki-manager`, and
# KMS and Keycloak in docker. `just dev` and `just backlog` always RESTART, so you never
# talk to an old process. Only this repository's processes are stopped.
set shell := ["bash", "-uc"]

# List the recipes
default:
    @just --list --unsorted

# ─────────────────────────── dev stack ───────────────────────────

# First run: install dependencies, create the .env files, migrate the dev database
setup:
    pnpm install
    @[ -f backend/.env ] || { cp backend/.env.example backend/.env && echo "created backend/.env"; }
    @[ -f frontend/.env ] || { cp frontend/.env.example frontend/.env && echo "created frontend/.env"; }
    cd backend && pnpm db:migrate

# Restart the dev stack (stops this repo's old one first) and open it
dev:
    @bash scripts/dev-session.sh restart

# Restart only the Backlog.md web UI, on all interfaces (0.0.0.0:52082)
backlog:
    @bash scripts/dev-session.sh backlog

# Open the running dev stack without restarting it
attach:
    @bash scripts/dev-session.sh attach

# Is it running, who holds the ports, what is on the mprocs screen
status:
    @bash scripts/dev-session.sh status

# Where to open each service
urls:
    @bash scripts/dev-session.sh urls

# Last lines of the process logs: just logs [backend|frontend|backlog] [lines]
logs proc="" lines="80":
    @bash scripts/dev-session.sh logs {{proc}} {{lines}}

# Stop the dev processes (KMS and Keycloak keep running, so the next start is fast)
stop:
    @bash scripts/dev-session.sh stop

# Stop everything: dev processes, KMS and Keycloak (containers and data are kept)
down:
    @bash scripts/dev-session.sh down

alias ps := status
alias kill := stop

# ─────────────────────────── checks ───────────────────────────

# Unit tests of backend and frontend
test:
    pnpm -r test

# Type-check backend and frontend
typecheck:
    pnpm -r typecheck

# Lint backend and frontend
lint:
    pnpm -r lint

# Build backend and frontend
build:
    pnpm -r build

# Apply the database migrations to the dev database
db-migrate:
    cd backend && pnpm db:migrate

# Sync the CodeGraph index of this checkout and of the indexed sibling repositories
codegraph:
    #!/usr/bin/env bash
    set -euo pipefail
    [ -d .codegraph ] || codegraph init .
    codegraph sync .
    for d in ../pki-manager-cli ../pki-manager-ansible; do
      [ -d "$d/.codegraph" ] && { echo "== $d"; codegraph sync "$d"; }
    done
    true

# ─────────────────────────── website ───────────────────────────

# Website (product pages + docs) with live reload on http://localhost:52085
site-dev:
    cd site && npm run dev

# Build the website into site/dist and check its links
site-build:
    cd site && npm run build

# Serve the built website on http://localhost:52086
site-preview:
    cd site && npm run preview

# Demo stack for docs and screenshots (fake data): just demo up|down|token|shots
demo *args:
    @bash site/demo/demo.sh {{args}}
