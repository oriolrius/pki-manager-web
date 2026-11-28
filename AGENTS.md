# PKI Manager - Agent Instructions

`AGENTS.md` files are the single source of agent guidance (Claude Code and Codex both read
them). Do not add `CLAUDE.md` files: Claude Code ignores every `AGENTS.md` when one exists.

PKI Manager is a self-hosted web application to run your own certificate authorities: root CAs,
X.509 issue/renew/revoke, CRLs, an SSH CA, a cert-manager external issuer for Kubernetes and an
optional SCEP gateway. Private keys live in **OpenBao Transit** (the PKI Manager build of OpenBao,
fork branch `pki-manager`, pinned in `openbao/image.env`); metadata in SQLite.

It is a personal project of its author, with no commercial interest. Never write marketing claims
about it: say what it does, how, and what it does not do.

## Where things are

| You need | Read |
|---|---|
| What the product does and does not do (verified) | [docs/features/](docs/features/), [docs/how-it-works.md](docs/how-it-works.md) |
| The top-level folders | [README.md](README.md#repository-layout) |
| Run it from source, the dev stack | [docs/development/setup.md](docs/development/setup.md) |
| Tests, images, CI, releases | [docs/development/testing.md](docs/development/testing.md), [docs/development/ci.md](docs/development/ci.md) |
| Where every document lives, and the rules | [docs/development/documentation.md](docs/development/documentation.md) |
| Internals of a subsystem | [backend/AGENTS.md](backend/AGENTS.md), [frontend/AGENTS.md](frontend/AGENTS.md), [k8s/issuer/AGENTS.md](k8s/issuer/AGENTS.md) |
| Why something is built this way | `backlog/decisions/` |

Read the guide of a subsystem before you work in it: it has verified commands, architecture and
gotchas.

## Related repositories

The author keeps all the repositories of the project side by side in one group folder, so
`../<name>` from this repository is the sibling checkout:

| Folder | What it is |
|---|---|
| `pki-manager-web` | this repository: backend, frontend, Kubernetes issuer, SCEP gateway, website |
| `../pki-manager-cli` | Python CLI (`pki`), generated from the REST OpenAPI spec ([oriolrius/pki-manager-cli](https://github.com/oriolrius/pki-manager-cli)) |
| `../pki-manager-ansible` | Ansible collection `oriolrius.pki_manager` ([oriolrius/pki-manager-ansible](https://github.com/oriolrius/pki-manager-ansible)) |
| `../skill-pki-manager` | Claude Code skill that drives the API; `../pki-manager-skill` is an older copy |
| `../k5-stack-pki`, `../k5-stack-pki-site` | the author's private deploy stacks (the app and the website) |

A change to the REST API or its Zod schemas can break the CLI and the Ansible collection. Check
them when you change an endpoint. A sibling folder can be absent: then skip it.

## Code navigation (CodeGraph)

This repository and the CLI and Ansible siblings have a local CodeGraph index in `.codegraph/`
(git-ignored, one per checkout). It covers TypeScript, the Go issuer and the Python files.

- Use the `codegraph_*` tools for structure (definitions, callers, impact, flows). Use grep only
  for literal text. For a sibling, pass its path as `projectPath`.
- The MCP server updates the index when files change. After a branch switch, a pull or a merge,
  run `just codegraph` (it syncs this repository and the indexed siblings).
- A T3 worktree (`~/.t3/worktrees/...`) has no index. Run `codegraph init .` in it if you need
  one, or use the native tools there.

## Documentation rules: one source of truth

- One topic has one document. Search before you write. Change the document that exists and link to it.
- Documentation lives under `docs/`, and its path is its URL on the site. Never add a Markdown
  guide at the repository root or in a code folder. Never write prose in `site/`.
- Decisions go to `backlog/decisions/` and specifications to `backlog/docs/`, with the Backlog.md
  CLI. The site publishes them as history.
- The site build fails when a Markdown file has no declared home (`site/docs.config.mjs`).
- Write only what you ran or read in the code. English only. Diagrams are PlantUML
  (`docs/diagrams/`), never ASCII art.
- The full rules: [docs/development/documentation.md](docs/development/documentation.md).

## Backlog.md CLI — Task Management

**Golden rule: NEVER edit task files directly — always use the `backlog` CLI.**
(The full Backlog.md guidelines are at the end of this file, between the `BACKLOG.MD GUIDELINES` markers — that block is auto-generated, leave it to the CLI.)

```bash
backlog task <id> --plain                              # view (--plain = AI output)
backlog task list --plain                              # list
backlog search "kw" --plain                            # search
backlog task create "Title" -d "Desc" --ac "Criterion"
backlog task edit <id> -s "In Progress" -a @myself     # start
backlog task edit <id> --plan $'1. Step\n2. Step'      # plan (ANSI-C quoting for newlines)
backlog task edit <id> --check-ac 1                    # tick an AC
backlog task edit <id> --notes "PR description" -s Done # finish
```

Workflow: start → `--plan` → implement + `--check-ac <i>` → `--notes` → `-s Done`.
ACs must be **outcome-oriented and testable** ("User can log in"), not implementation steps.

| Action | Flag |
|---|---|
| Add / check / remove AC | `--ac "..."` / `--check-ac <i>` / `--remove-ac <i>` |
| Title / desc / status / assignee | `-t` / `-d` / `-s` / `-a` |
| Labels | `-l a,b` |

## Architecture

- The web UI (React SPA) calls the backend over tRPC with the OIDC bearer token.
- The backend (Fastify) has four API surfaces: `/trpc` (typed, internal to the web UI), `/api/v1`
  (REST, Swagger at `/api/docs`), `/api/v1/external` (integration tokens: Kubernetes issuer, SCEP
  gateway, scripts) and `/api/v1/external/ssh` (SSH fleet tokens).
- `services/` hold the logic. Both APIs delegate to them: crypto (node-forge, plus the local
  X.509 builder in `crypto/`), OpenBao Transit (`openbao/`: HTTPS clients for the X.509, SSH CA and
  SCEP RA keys), SQLite (Drizzle). The backend builds certificates and SSH certificates and
  Transit signs certificates and CRLs with the CA key. decision-018 explains the cutover from Cosmian KMS, decision-019 how the fork follows upstream.
- `k8s/issuer` (Go) sends each CSR to `POST /api/v1/external/sign`. One integration token is bound
  to one CA.
- **OIDC is optional**: with no `OIDC_ISSUER`/`OIDC_AUDIENCE`, the management API has no login.
  The external API still needs its token, and the SSH CA operations need
  `ALLOW_UNAUTHENTICATED_SSH_CA=true`.

**SSH Zones** (decision-017): a generic `zones` table makes the SSH manager multi-tenant —
`ssh_cas/hosts/identities/principals/fleet_tokens` carry a `zone_id` and a host trusts only
its own zone's user CAs. Zone resolution is **fail-closed** (`resolveZone`): implicit while
one zone exists, an error once several do. Single-zone installs are unchanged. See
[docs/ssh/zones.md](docs/ssh/zones.md).

## Tech Stack

| Area | Stack |
|---|---|
| Backend | Fastify 5 · tRPC v11 · Drizzle + better-sqlite3 · Zod · node-forge · jose · Vitest |
| Frontend | React 19 · TanStack Router/Query · tRPC client · Tailwind 4 · Vite 8 · Vitest+RTL |
| Issuer | Go 1.26.11 · controller-runtime 0.24 · cert-manager 1.21 · Helm |
| Website | Astro · Starlight, in `site/` (content comes from `docs/` and `backlog/`) |
| Tooling | just · pnpm workspaces (Node 22 LTS, `.nvmrc`; pnpm ≥9) · Commitizen conventional commits |

## Commands

`just` is the entry point. Run `just` to list every recipe.

| Command | Action |
|---|---|
| `just setup` | install dependencies, create the `.env` files, migrate the dev database |
| `just dev` | **restart** the dev stack: stop this repository's old processes, start KMS and Keycloak, then **mprocs** (`backend` + `frontend`) in the tmux session `dev-pki-manager`, and the Backlog.md web UI in `backlog-pki-manager`. It works without a TTY |
| `just backlog` | **restart** only the Backlog.md web UI, on `0.0.0.0:52082` (Backlog on `127.0.0.1:52083` + a socat relay); never touches another project's board |
| `just status` / `just logs [proc]` | session, ports and screen / last lines of a process log |
| `just stop` / `just down` | stop the processes / also the KMS and Keycloak containers |
| `just test` / `typecheck` / `lint` / `build` | both workspaces (`pnpm -r`) |
| `just site-build` | build the website and check its links |
| `just codegraph` | sync the CodeGraph index of this checkout and of the indexed siblings (makes it when absent) |
| `just demo up\|down\|shots` | demo stack for the screenshots and the API examples of the docs |

**Never launch bare `mprocs`.** After `just dev`, the web UI is at http://localhost:52080 (login
`admin`/`admin`, OIDC is on by default) and the API at http://localhost:52081. Use `localhost`,
never another host name: OIDC login needs a secure context (see [frontend/AGENTS.md](frontend/AGENTS.md)).
Per-workspace commands (DB migrations, ports, build modes) are in the subsystem guides. The Go
issuer uses `make` from `k8s/issuer/`.

## Conventions

- **New endpoint**: Zod schema → `services/*` method → expose via a tRPC procedure and/or
  REST route (both delegate to the service).
- **New frontend route**: add `frontend/src/routes/<name>.tsx`; the router plugin
  regenerates `routeTree.gen.ts`.
- **DB change**: edit `backend/src/db/schema.ts` → `pnpm db:generate && pnpm db:migrate`.
- Write an `audit_log` row for every state-changing operation (success and failure).
- Never persist private keys outside OpenBao — the DB stores only key references. SSH CA and SCEP
  RA keys are non-exportable; X.509 keys leave OpenBao only through the audited export formats.
- Run each workspace's `typecheck`, not just `build`: the frontend `build:docker` is relaxed
  (`strict: false`), so a green Docker build is not a clean typecheck.

## Certificate Fields

- **Types:** `server`, `client`, `dual`, `email`, `code_signing`
- **Required subject:** CN, O, C (2-letter). **Optional:** OU, ST, L.
- **SANs:** DNS, IP, email.

<!-- BACKLOG.MD GUIDELINES START -->
# Instructions for the usage of Backlog.md CLI Tool

## Backlog.md: Comprehensive Project Management Tool via CLI

### Assistant Objective

Efficiently manage all project tasks, status, and documentation using the Backlog.md CLI, ensuring all project metadata
remains fully synchronized and up-to-date.

### Core Capabilities

- ✅ **Task Management**: Create, edit, assign, prioritize, and track tasks with full metadata
- ✅ **Search**: Fuzzy search across tasks, documents, and decisions with `backlog search`
- ✅ **Acceptance Criteria**: Granular control with add/remove/check/uncheck by index
- ✅ **Board Visualization**: Terminal-based Kanban board (`backlog board`) and web UI (`backlog browser`)
- ✅ **Git Integration**: Automatic tracking of task states across branches
- ✅ **Dependencies**: Task relationships and subtask hierarchies
- ✅ **Documentation & Decisions**: Structured docs and architectural decision records
- ✅ **Export & Reporting**: Generate markdown reports and board snapshots
- ✅ **AI-Optimized**: `--plain` flag provides clean text output for AI processing

### Why This Matters to You (AI Agent)

1. **Comprehensive system** - Full project management capabilities through CLI
2. **The CLI is the interface** - All operations go through `backlog` commands
3. **Unified interaction model** - You can use CLI for both reading (`backlog task 1 --plain`) and writing (
   `backlog task edit 1`)
4. **Metadata stays synchronized** - The CLI handles all the complex relationships

### Key Understanding

- **Tasks** live in `backlog/tasks/` as `task-<id> - <title>.md` files
- **You interact via CLI only**: `backlog task create`, `backlog task edit`, etc.
- **Use `--plain` flag** for AI-friendly output when viewing/listing
- **Never bypass the CLI** - It handles Git, metadata, file naming, and relationships

---

# ⚠️ CRITICAL: NEVER EDIT TASK FILES DIRECTLY. Edit Only via CLI

**ALL task operations MUST use the Backlog.md CLI commands**

- ✅ **DO**: Use `backlog task edit` and other CLI commands
- ✅ **DO**: Use `backlog task create` to create new tasks
- ✅ **DO**: Use `backlog task edit <id> --check-ac <index>` to mark acceptance criteria
- ❌ **DON'T**: Edit markdown files directly
- ❌ **DON'T**: Manually change checkboxes in files
- ❌ **DON'T**: Add or modify text in task files without using CLI

**Why?** Direct file editing breaks metadata synchronization, Git tracking, and task relationships.

---

## 1. Source of Truth & File Structure

### 📖 **UNDERSTANDING** (What you'll see when reading)

- Markdown task files live under **`backlog/tasks/`** (drafts under **`backlog/drafts/`**)
- Files are named: `task-<id> - <title>.md` (e.g., `task-42 - Add GraphQL resolver.md`)
- Project documentation is in **`backlog/docs/`**
- Project decisions are in **`backlog/decisions/`**

### 🔧 **ACTING** (How to change things)

- **All task operations MUST use the Backlog.md CLI tool**
- This ensures metadata is correctly updated and the project stays in sync
- **Always use `--plain` flag** when listing or viewing tasks for AI-friendly text output

---

## 2. Common Mistakes to Avoid

### ❌ **WRONG: Direct File Editing**

```markdown
# DON'T DO THIS:

1. Open backlog/tasks/task-7 - Feature.md in editor
2. Change "- [ ]" to "- [x]" manually
3. Add notes directly to the file
4. Save the file
```

### ✅ **CORRECT: Using CLI Commands**

```bash
# DO THIS INSTEAD:
backlog task edit 7 --check-ac 1  # Mark AC #1 as complete
backlog task edit 7 --notes "Implementation complete"  # Add notes
backlog task edit 7 -s "In Progress" -a @agent-k  # Multiple commands: change status and assign the task when you start working on the task
```

---

## 3. Understanding Task Format (Read-Only Reference)

⚠️ **FORMAT REFERENCE ONLY** - The following sections show what you'll SEE in task files.
**Never edit these directly! Use CLI commands to make changes.**

### Task Structure You'll See

```markdown
---
id: task-42
title: Add GraphQL resolver
status: To Do
assignee: [@sara]
labels: [backend, api]
---

## Description

Brief explanation of the task purpose.

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 First criterion
- [x] #2 Second criterion (completed)
- [ ] #3 Third criterion

<!-- AC:END -->

## Implementation Plan

1. Research approach
2. Implement solution

## Implementation Notes

Summary of what was done.
```

### How to Modify Each Section

| What You Want to Change | CLI Command to Use                                       |
|-------------------------|----------------------------------------------------------|
| Title                   | `backlog task edit 42 -t "New Title"`                    |
| Status                  | `backlog task edit 42 -s "In Progress"`                  |
| Assignee                | `backlog task edit 42 -a @sara`                          |
| Labels                  | `backlog task edit 42 -l backend,api`                    |
| Description             | `backlog task edit 42 -d "New description"`              |
| Add AC                  | `backlog task edit 42 --ac "New criterion"`              |
| Check AC #1             | `backlog task edit 42 --check-ac 1`                      |
| Uncheck AC #2           | `backlog task edit 42 --uncheck-ac 2`                    |
| Remove AC #3            | `backlog task edit 42 --remove-ac 3`                     |
| Add Plan                | `backlog task edit 42 --plan "1. Step one\n2. Step two"` |
| Add Notes (replace)     | `backlog task edit 42 --notes "What I did"`              |
| Append Notes            | `backlog task edit 42 --append-notes "Another note"` |

---

## 4. Defining Tasks

### Creating New Tasks

**Always use CLI to create tasks:**

```bash
# Example
backlog task create "Task title" -d "Description" --ac "First criterion" --ac "Second criterion"
```

### Title (one liner)

Use a clear brief title that summarizes the task.

### Description (The "why")

Provide a concise summary of the task purpose and its goal. Explains the context without implementation details.

### Acceptance Criteria (The "what")

**Understanding the Format:**

- Acceptance criteria appear as numbered checkboxes in the markdown files
- Format: `- [ ] #1 Criterion text` (unchecked) or `- [x] #1 Criterion text` (checked)

**Managing Acceptance Criteria via CLI:**

⚠️ **IMPORTANT: How AC Commands Work**

- **Adding criteria (`--ac`)** accepts multiple flags: `--ac "First" --ac "Second"` ✅
- **Checking/unchecking/removing** accept multiple flags too: `--check-ac 1 --check-ac 2` ✅
- **Mixed operations** work in a single command: `--check-ac 1 --uncheck-ac 2 --remove-ac 3` ✅

```bash
# Examples

# Add new criteria (MULTIPLE values allowed)
backlog task edit 42 --ac "User can login" --ac "Session persists"

# Check specific criteria by index (MULTIPLE values supported)
backlog task edit 42 --check-ac 1 --check-ac 2 --check-ac 3  # Check multiple ACs
# Or check them individually if you prefer:
backlog task edit 42 --check-ac 1    # Mark #1 as complete
backlog task edit 42 --check-ac 2    # Mark #2 as complete

# Mixed operations in single command
backlog task edit 42 --check-ac 1 --uncheck-ac 2 --remove-ac 3

# ❌ STILL WRONG - These formats don't work:
# backlog task edit 42 --check-ac 1,2,3  # No comma-separated values
# backlog task edit 42 --check-ac 1-3    # No ranges
# backlog task edit 42 --check 1         # Wrong flag name

# Multiple operations of same type
backlog task edit 42 --uncheck-ac 1 --uncheck-ac 2  # Uncheck multiple ACs
backlog task edit 42 --remove-ac 2 --remove-ac 4    # Remove multiple ACs (processed high-to-low)
```

**Key Principles for Good ACs:**

- **Outcome-Oriented:** Focus on the result, not the method.
- **Testable/Verifiable:** Each criterion should be objectively testable
- **Clear and Concise:** Unambiguous language
- **Complete:** Collectively cover the task scope
- **User-Focused:** Frame from end-user or system behavior perspective

Good Examples:

- "User can successfully log in with valid credentials"
- "System processes 1000 requests per second without errors"
- "CLI preserves literal newlines in description/plan/notes; `\\n` sequences are not auto‑converted"

Bad Example (Implementation Step):

- "Add a new function handleLogin() in auth.ts"
- "Define expected behavior and document supported input patterns"

### Task Breakdown Strategy

1. Identify foundational components first
2. Create tasks in dependency order (foundations before features)
3. Ensure each task delivers value independently
4. Avoid creating tasks that block each other

### Task Requirements

- Tasks must be **atomic** and **testable** or **verifiable**
- Each task should represent a single unit of work for one PR
- **Never** reference future tasks (only tasks with id < current task id)
- Ensure tasks are **independent** and don't depend on future work

---

## 5. Implementing Tasks

### 5.1. First step when implementing a task

The very first things you must do when you take over a task are:

* set the task in progress
* assign it to yourself

```bash
# Example
backlog task edit 42 -s "In Progress" -a @{myself}
```

### 5.2. Create an Implementation Plan (The "how")

Previously created tasks contain the why and the what. Once you are familiar with that part you should think about a
plan on **HOW** to tackle the task and all its acceptance criteria. This is your **Implementation Plan**.
First do a quick check to see if all the tools that you are planning to use are available in the environment you are
working in.   
When you are ready, write it down in the task so that you can refer to it later.

```bash
# Example
backlog task edit 42 --plan "1. Research codebase for references\n2Research on internet for similar cases\n3. Implement\n4. Test"
```

## 5.3. Implementation

Once you have a plan, you can start implementing the task. This is where you write code, run tests, and make sure
everything works as expected. Follow the acceptance criteria one by one and MARK THEM AS COMPLETE as soon as you
finish them.

### 5.4 Implementation Notes (PR description)

When you are done implementing a tasks you need to prepare a PR description for it.
Because you cannot create PRs directly, write the PR as a clean description in the task notes.
Append notes progressively during implementation using `--append-notes`:

```
backlog task edit 42 --append-notes "Implemented X" --append-notes "Added tests"
```

```bash
# Example
backlog task edit 42 --notes "Implemented using pattern X because Reason Y, modified files Z and W"
```

**IMPORTANT**: Do NOT include an Implementation Plan when creating a task. The plan is added only after you start the
implementation.

- Creation phase: provide Title, Description, Acceptance Criteria, and optionally labels/priority/assignee.
- When you begin work, switch to edit, set the task in progress and assign to yourself
  `backlog task edit <id> -s "In Progress" -a "..."`.
- Think about how you would solve the task and add the plan: `backlog task edit <id> --plan "..."`.
- Add Implementation Notes only after completing the work: `backlog task edit <id> --notes "..."` (replace) or append progressively using `--append-notes`.

## Phase discipline: What goes where

- Creation: Title, Description, Acceptance Criteria, labels/priority/assignee.
- Implementation: Implementation Plan (after moving to In Progress and assigning to yourself).
- Wrap-up: Implementation Notes (Like a PR description), AC and Definition of Done checks.

**IMPORTANT**: Only implement what's in the Acceptance Criteria. If you need to do more, either:

1. Update the AC first: `backlog task edit 42 --ac "New requirement"`
2. Or create a new follow up task: `backlog task create "Additional feature"`

---

## 6. Typical Workflow

```bash
# 1. Identify work
backlog task list -s "To Do" --plain

# 2. Read task details
backlog task 42 --plain

# 3. Start work: assign yourself & change status
backlog task edit 42 -s "In Progress" -a @myself

# 4. Add implementation plan
backlog task edit 42 --plan "1. Analyze\n2. Refactor\n3. Test"

# 5. Work on the task (write code, test, etc.)

# 6. Mark acceptance criteria as complete (supports multiple in one command)
backlog task edit 42 --check-ac 1 --check-ac 2 --check-ac 3  # Check all at once
# Or check them individually if preferred:
# backlog task edit 42 --check-ac 1
# backlog task edit 42 --check-ac 2
# backlog task edit 42 --check-ac 3

# 7. Add implementation notes (PR Description)
backlog task edit 42 --notes "Refactored using strategy pattern, updated tests"

# 8. Mark task as done
backlog task edit 42 -s Done
```

---

## 7. Definition of Done (DoD)

A task is **Done** only when **ALL** of the following are complete:

### ✅ Via CLI Commands:

1. **All acceptance criteria checked**: Use `backlog task edit <id> --check-ac <index>` for each
2. **Implementation notes added**: Use `backlog task edit <id> --notes "..."`
3. **Status set to Done**: Use `backlog task edit <id> -s Done`

### ✅ Via Code/Testing:

4. **Tests pass**: Run test suite and linting
5. **Documentation updated**: Update relevant docs if needed
6. **Code reviewed**: Self-review your changes
7. **No regressions**: Performance, security checks pass

⚠️ **NEVER mark a task as Done without completing ALL items above**

---

## 8. Finding Tasks and Content with Search

When users ask you to find tasks related to a topic, use the `backlog search` command with `--plain` flag:

```bash
# Search for tasks about authentication
backlog search "auth" --plain

# Search only in tasks (not docs/decisions)
backlog search "login" --type task --plain

# Search with filters
backlog search "api" --status "In Progress" --plain
backlog search "bug" --priority high --plain
```

**Key points:**
- Uses fuzzy matching - finds "authentication" when searching "auth"
- Searches task titles, descriptions, and content
- Also searches documents and decisions unless filtered with `--type task`
- Always use `--plain` flag for AI-readable output

---

## 9. Quick Reference: DO vs DON'T

### Viewing and Finding Tasks

| Task         | ✅ DO                        | ❌ DON'T                         |
|--------------|-----------------------------|---------------------------------|
| View task    | `backlog task 42 --plain`   | Open and read .md file directly |
| List tasks   | `backlog task list --plain` | Browse backlog/tasks folder     |
| Check status | `backlog task 42 --plain`   | Look at file content            |
| Find by topic| `backlog search "auth" --plain` | Manually grep through files |

### Modifying Tasks

| Task          | ✅ DO                                 | ❌ DON'T                           |
|---------------|--------------------------------------|-----------------------------------|
| Check AC      | `backlog task edit 42 --check-ac 1`  | Change `- [ ]` to `- [x]` in file |
| Add notes     | `backlog task edit 42 --notes "..."` | Type notes into .md file          |
| Change status | `backlog task edit 42 -s Done`       | Edit status in frontmatter        |
| Add AC        | `backlog task edit 42 --ac "New"`    | Add `- [ ] New` to file           |

---

## 10. Complete CLI Command Reference

### Task Creation

| Action           | Command                                                                             |
|------------------|-------------------------------------------------------------------------------------|
| Create task      | `backlog task create "Title"`                                                       |
| With description | `backlog task create "Title" -d "Description"`                                      |
| With AC          | `backlog task create "Title" --ac "Criterion 1" --ac "Criterion 2"`                 |
| With all options | `backlog task create "Title" -d "Desc" -a @sara -s "To Do" -l auth --priority high` |
| Create draft     | `backlog task create "Title" --draft`                                               |
| Create subtask   | `backlog task create "Title" -p 42`                                                 |

### Task Modification

| Action           | Command                                     |
|------------------|---------------------------------------------|
| Edit title       | `backlog task edit 42 -t "New Title"`       |
| Edit description | `backlog task edit 42 -d "New description"` |
| Change status    | `backlog task edit 42 -s "In Progress"`     |
| Assign           | `backlog task edit 42 -a @sara`             |
| Add labels       | `backlog task edit 42 -l backend,api`       |
| Set priority     | `backlog task edit 42 --priority high`      |

### Acceptance Criteria Management

| Action              | Command                                                                     |
|---------------------|-----------------------------------------------------------------------------|
| Add AC              | `backlog task edit 42 --ac "New criterion" --ac "Another"`                  |
| Remove AC #2        | `backlog task edit 42 --remove-ac 2`                                        |
| Remove multiple ACs | `backlog task edit 42 --remove-ac 2 --remove-ac 4`                          |
| Check AC #1         | `backlog task edit 42 --check-ac 1`                                         |
| Check multiple ACs  | `backlog task edit 42 --check-ac 1 --check-ac 3`                            |
| Uncheck AC #3       | `backlog task edit 42 --uncheck-ac 3`                                       |
| Mixed operations    | `backlog task edit 42 --check-ac 1 --uncheck-ac 2 --remove-ac 3 --ac "New"` |

### Task Content

| Action           | Command                                                  |
|------------------|----------------------------------------------------------|
| Add plan         | `backlog task edit 42 --plan "1. Step one\n2. Step two"` |
| Add notes        | `backlog task edit 42 --notes "Implementation details"`  |
| Add dependencies | `backlog task edit 42 --dep task-1 --dep task-2`         |

### Multi‑line Input (Description/Plan/Notes)

The CLI preserves input literally. Shells do not convert `\n` inside normal quotes. Use one of the following to insert real newlines:

- Bash/Zsh (ANSI‑C quoting):
  - Description: `backlog task edit 42 --desc $'Line1\nLine2\n\nFinal'`
  - Plan: `backlog task edit 42 --plan $'1. A\n2. B'`
  - Notes: `backlog task edit 42 --notes $'Done A\nDoing B'`
  - Append notes: `backlog task edit 42 --append-notes $'Progress update line 1\nLine 2'`
- POSIX portable (printf):
  - `backlog task edit 42 --notes "$(printf 'Line1\nLine2')"`
- PowerShell (backtick n):
  - `backlog task edit 42 --notes "Line1`nLine2"`

Do not expect `"...\n..."` to become a newline. That passes the literal backslash + n to the CLI by design.

Descriptions support literal newlines; shell examples may show escaped `\\n`, but enter a single `\n` to create a newline.

### Implementation Notes Formatting

- Keep implementation notes human-friendly and PR-ready: use short paragraphs or
  bullet lists instead of a single long line.
- Lead with the outcome, then add supporting details (e.g., testing, follow-up
  actions) on separate lines or bullets.
- Prefer Markdown bullets (`-` for unordered, `1.` for ordered) so Maintainers
  can paste notes straight into GitHub without additional formatting.
- When using CLI flags like `--append-notes`, remember to include explicit
  newlines. Example:

  ```bash
  backlog task edit 42 --append-notes $'- Added new API endpoint\n- Updated tests\n- TODO: monitor staging deploy'
  ```

### Task Operations

| Action             | Command                                      |
|--------------------|----------------------------------------------|
| View task          | `backlog task 42 --plain`                    |
| List tasks         | `backlog task list --plain`                  |
| Search tasks       | `backlog search "topic" --plain`              |
| Search with filter | `backlog search "api" --status "To Do" --plain` |
| Filter by status   | `backlog task list -s "In Progress" --plain` |
| Filter by assignee | `backlog task list -a @sara --plain`         |
| Archive task       | `backlog task archive 42`                    |
| Demote to draft    | `backlog task demote 42`                     |

---

## Common Issues

| Problem              | Solution                                                           |
|----------------------|--------------------------------------------------------------------|
| Task not found       | Check task ID with `backlog task list --plain`                     |
| AC won't check       | Use correct index: `backlog task 42 --plain` to see AC numbers     |
| Changes not saving   | Ensure you're using CLI, not editing files                         |
| Metadata out of sync | Re-edit via CLI to fix: `backlog task edit 42 -s <current-status>` |

---

## Remember: The Golden Rule

**🎯 If you want to change ANYTHING in a task, use the `backlog task edit` command.**
**📖 Use CLI to read tasks, exceptionally READ task files directly, never WRITE to them.**

Full help available: `backlog --help`

<!-- BACKLOG.MD GUIDELINES END -->
