# How the docs are organised

One topic has one document. This page says where each kind of document lives, how the website
is built from them, and the rules that keep one source of truth.

## Where things live

| You write about | It lives in | Readers find it at |
|---|---|---|
| What PKI Manager is and does | `docs/about.md`, `docs/how-it-works.md`, `docs/features/` | `/about/`, `/how-it-works/`, `/features/` |
| How to install, use and operate it | `docs/get-started/`, `docs/guides/`, `docs/ssh/`, `docs/operations/`, `docs/api/` | the same path on the site |
| How to develop it | `docs/development/` | `/development/` |
| A component with its own folder | the `README.md` next to its code (`scep/`, `krl-client/`, `ansible/`) | the path set in `site/docs.config.mjs` |
| Why it is built this way | `backlog/decisions/` (decision records in force) | `/project/decisions/` |
| The plan of a large piece of work that is open now | `backlog/docs/` (specifications) | `/project/specs/` |
| Replaced decisions and plans of finished work | `backlog/archive/decisions/`, `backlog/archive/docs/` | not published |
| What changed in each release | `CHANGELOG.md` | `/operations/releases/` |
| The API reference | generated from the backend source when the site is built | `/api/reference/` |
| Work to do | `backlog/tasks/` and GitHub issues | not published |
| Rules for coding agents | the `AGENTS.md` files | not published |
| How to report a problem and send a change (rules for tests, checks, commits) | `CONTRIBUTING.md` at the root (GitHub links it on new issues and pull requests) | `/development/contributing/` |
| How to report a vulnerability, and which versions get fixes | `SECURITY.md` at the root (GitHub shows it on the Security tab) | GitHub |

## The rules

1. **The URL of a page is its path under `docs/`.** `docs/guides/private-ca.md` is
   `/guides/private-ca/`, and `docs/get-started/index.md` is `/get-started/`. To add a page, add a file.
2. **Nothing is written twice.** Search before you write. If the topic has a home, change it there
   and link to it from other pages. A summary that repeats a page is wrong as soon as the page changes.
3. **The site has no text of its own.** `site/` holds layout and code. Its content folders are made
   at build time from this repository and are not committed.
4. **The README is a front page.** It says what the project is and links to the site. It repeats nothing.
5. **Records are history, and only live records are published.** A decision record or a
   specification is not updated when the product changes. The site shows each one with a note that
   says so. The guides describe the current behaviour. Archive a record with the Backlog.md CLI
   (`backlog decision archive <id>`, `backlog doc archive <id>`) when:
   - a decision is replaced by a new one, or was never built;
   - a record is not a decision (a guide, an inventory of one branch);
   - the work of a specification is done. What lasts goes first to a decision record (why) or to
     a guide (how).

   An archived record stays in the repository and in git, but not on the site. Do not link to it
   from a document.
6. **Every Markdown file has a declared home.** The site build stops when a Markdown file is not
   under `docs/`, is not a record, and is not listed in `site/docs.config.mjs`. That file lists the
   component documents that are published and the files that stay in the repository only, each with
   the reason. This is the check that stops a second copy of a topic.
7. **Write what you ran or read in the code.** A guide whose steps were run on a real stack says
   which release it used (see below). Do not describe a feature from memory.
8. **English only**, short sentences, steps as numbered lists, real output.
9. **Diagrams are PlantUML**, never ASCII art. See [`docs/diagrams/README.md`](../diagrams/README.md).

## Write a page

- Start the file with `# Title`. The site takes the title from that line.
- Link to another document with a relative path to its `.md` file, for example
  `[Docker deployment](../operations/deployment.md)`. The build turns it into a site link, so the
  link works on GitHub and on the site. A link to a file that is not published becomes a GitHub link.
  A broken relative link stops the build.
- Put images next to the document, in an `img/` folder, and link them with a relative path.
- The sidebar label and the order of a page are optional: add the page to `PAGES` in
  `site/docs.config.mjs`. A page that is not there uses its title and goes last in its section.
- When a page moves, add the old path to `REDIRECTS` in the same file.
- When every step of a guide was run on a real stack, add this line after the title. The page
  then shows the release next to the release that the site documents:

  ```markdown
  <!-- tested-with: 3.17.0 -->
  ```

### Product pages

The pages under `/features/`, `/how-it-works/` and `/about/` use the product layout instead of
the docs sidebar. Their text is still Markdown in `docs/`. They start with a small header:

```markdown
---
title: SSH certificate authority
summary: One sentence. It is the text of the card on the home page and the lead of the page.
order: 4                  # position on the features page
image: img/ssh-hosts.png  # screenshot of the card and of the page header
imageAlt: What the screenshot shows
links:                    # "Read more" list at the end of the page
  - label: SSH video series
    href: ../ssh/explainer/index.html
---
```

Every statement on a product page must be true for the current release. Each feature page ends
with what the feature does **not** do.

## Build the site

The site is an [Astro](https://astro.build) project with [Starlight](https://starlight.astro.build) in `site/`.

```bash
just site-dev       # live reload on http://localhost:52085
just site-build     # build into site/dist and check every internal link
just site-preview   # serve the build on http://localhost:52086
```

The first time, run `npm ci` in `site/` (Node.js version in `site/.nvmrc`) and `pnpm install` at
the root: the API reference is generated by starting the backend from source for a moment.

The build does these steps (`site/package.json`):

1. `scripts/sync-docs.mjs` checks that every Markdown file has a home, then writes the site
   content from the repository: titles, links, images, the release of each page.
2. `scripts/plantuml.mjs` renders the diagrams with the PlantUML server `plantuml.joor.net`
   (set `PLANTUML_API` for another server).
3. `scripts/openapi.mjs` writes the OpenAPI document from the backend source.
4. `astro build` makes the pages. `scripts/check-links.mjs` stops the build on a broken internal link.

The workflow `.github/workflows/docs.yml` runs the same build on each pull request. From `main`, it
publishes the site image, and <https://pki-manager.oriolrius.cat> shows the change about 10 minutes
later: see [Website deploy](ci.md#website-deploy).

### Versions on the site

Each page shows the release that the site documents (the version in the root `package.json`), the
release that tested the steps (the `tested-with` line) and the first release that has the last
change of the page (from git). `site/scripts/version.mjs` computes them. It needs the full git
history, so a shallow clone stops the build.

## Demo stack, screenshots and examples

Screenshots and examples come from a demo stack with made-up data. It runs the published images on
its own ports, with its own Keycloak, and never touches the dev data.

```bash
just demo up        # start a clean demo stack (UI http://localhost:47380, API http://localhost:47300)
just demo token     # print an access token of the demo admin
just demo shots     # start it and take the screenshots (Playwright specs in site/demo/shots/)
just demo down      # stop it and delete its volumes
```

- Demo users: `alex` (admin) and `uma` (user), password `Demo-Pass-1`.
- `IMAGE_TAG` selects the release of the images, for example `IMAGE_TAG=3.16.1 just demo up`. The
  default is in `site/demo/demo.sh`; change it when you run the examples and the screenshots again
  on a new release, and change the `tested-with` line of those pages too.
- The specs in `site/demo/shots/` write the screenshots of the guides to `docs/guides/img/` and the
  screenshots of the product pages to `docs/features/img/`. Commit the images.
- `site/demo/doc-examples.sh docs/api/how-to.md` runs every `bash` block of a document against the
  demo stack and stops at the first error. CI runs it for the API how-to.
