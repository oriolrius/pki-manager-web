// The documentation inventory of the repository. site/scripts/sync-docs.mjs reads it.
//
// ONE RULE: a Markdown file under docs/ is published at the URL that equals its path.
//   docs/guides/private-ca.md   ->  /guides/private-ca/
//   docs/get-started/index.md   ->  /get-started/
// So a new page needs no change here. This file holds only what the rule cannot know:
// sidebar labels and order, documents that live next to their code, records from backlog/,
// files that stay in the repository only, and redirects for pages that moved.
//
// The build FAILS when a Markdown file of the repository is in none of these groups.
// That is how a second copy of a topic is stopped: every document has one declared home.

/** Sidebar label and order of a published page (key = site path). Not listed: label = page title, placed last. */
export const PAGES = {
  'get-started': ['Start here', 1],
  'get-started/install': ['Install and log in', 2],

  'guides/private-ca': ['Private CA and certificates', 1],
  'guides/mqtt': ['Client cert auth: Mosquitto', 2],
  'guides/kubernetes': ['Kubernetes with cert-manager', 3],
  'guides/automation': ['Automation, tokens and SCEP', 4],
  'guides/private-root-ca': ['Trust your root CA on devices', 5],
  'guides/k8s-csr-signing': ['Reference: how Kubernetes CSRs are signed', 6],

  'ssh/concept': ['How it works', 1],
  'ssh/operator-quickstart': ['Operator quickstart', 2],
  'ssh/setup': ['Host and client setup', 3],
  'ssh/deploy-server-and-user': ['Deploy a server and a user', 4],
  'ssh/principals-guide': ['Principals guide', 5],
  'ssh/zones': ['Zones', 6],
  'ssh/host-blocks-runbook': ['Per-host access blocks', 7],
  'ssh/ansible-role': ['Ansible role', 8],
  'ssh/krl-client': ['KRL client for hosts', 9],
  'ssh/api-contract': ['External API contract', 10],

  'operations/deployment': ['Docker deployment', 1],
  'operations/oidc': ['OIDC login', 2],
  'operations/keycloak': ['Keycloak setup', 3],
  'operations/scep-gateway': ['SCEP gateway', 4],
  'operations/scep-intune': ['SCEP with Intune', 5],
  'operations/migration-0009': ['Migration 0009: SSH zones', 6],
  'operations/migration-0010': ['Migration 0010: integrations', 7],
  'operations/releases': ['Release notes', 9],

  'api': ['REST API', 1],
  'api/how-to': ['Call the API (examples)', 2],
  'api/integrations': ['Integration API', 3],

  'development/setup': ['Development setup', 1],
  'development/testing': ['Testing', 2],
  'development/ci': ['CI and releases', 3],
  'development/documentation': ['How the docs are organised', 4],
  'development/contributing': ['Contributing', 5],
};

/**
 * Documents that live next to their code (or at the root) and are published too.
 * repo path -> site path. `title` only for a file without a "# Title" line.
 */
export const EXTERNAL = {
  'CHANGELOG.md': { to: 'operations/releases', title: 'Release notes' },
  'CONTRIBUTING.md': { to: 'development/contributing' },
  'ansible/README.md': { to: 'ssh/ansible-role' },
  'krl-client/README.md': { to: 'ssh/krl-client' },
  'scep/README.md': { to: 'operations/scep-gateway' },
  'scep/docs/intune.md': { to: 'operations/scep-intune' },
};

/**
 * Product pages: Markdown under docs/, shown with the product layout (not the docs sidebar).
 * The path rule is the same: docs/about.md -> /about/, docs/features/x.md -> /features/x/.
 */
export const PRODUCT = ['docs/index.md', 'docs/about.md', 'docs/how-it-works.md', 'docs/features/'];

/**
 * Records from Backlog.md, published as they are. They are history: each page says so.
 * A new decision or specification appears on the site with no change here.
 */
export const RECORDS = [
  {
    dir: 'backlog/decisions',
    to: 'project/decisions',
    kind: 'Decision record',
    title: 'Decision records',
    intro: 'A decision record explains why PKI Manager is built the way it is: the context at that time, the options, and the choice. Only the decisions that are still in force are here. A record is not updated when the product changes, so read the guides for the current behaviour. A decision that was replaced, or never built, goes to the archive (`backlog/archive/decisions/`).',
  },
  {
    dir: 'backlog/docs',
    to: 'project/specs',
    kind: 'Specification',
    title: 'Specifications',
    intro: 'A specification is the plan of a large piece of work that is open now: the goal, the findings, the tasks and the risks. When the work is done, the specification goes to the archive (`backlog/archive/docs/`): the reasons stay in the decision records and the current behaviour is in the guides.',
    empty: 'There is no open specification now.',
  },
];

/** Under docs/ but not pages. path prefix -> reason. */
export const NOT_PAGES = {
  'docs/README.md': 'index of the docs folder for readers on GitHub',
  'docs/diagrams/README.md': 'how to add a diagram',
  'docs/ssh/explainer/': 'video scripts and tooling; the result is the page /ssh/videos/',
};

/** Links to these repository paths go to a site page that is not built from one Markdown file. */
export const ALIASES = {
  'docs/ssh/explainer/index.html': 'ssh/videos',
  'docs/ssh/explainer/README.md': 'ssh/videos',
  'docs/ssh/explainer': 'ssh/videos',
  'docs/features': 'features',
};

/**
 * Markdown that stays in the repository only. path or path prefix -> why it is not on the site.
 * Add a file here only when it is NOT documentation for users or contributors of the product.
 */
export const REPO_ONLY = {
  'README.md': 'front page of the repository; it links to the site and repeats nothing',
  'SECURITY.md': 'security policy; GitHub shows it on the Security tab of the repository, where a reporter looks for it',
  'AGENTS.md': 'instructions for coding agents',
  'backend/AGENTS.md': 'instructions for coding agents',
  'frontend/AGENTS.md': 'instructions for coding agents',
  'k8s/issuer/AGENTS.md': 'instructions for coding agents',
  '.claude/': 'skills and agents for Claude Code',
  'backlog/tasks/': 'work items',
  'backlog/archive/': 'work items',
  'backlog/milestones/': 'work items',
  'kms/README.md': 'notes for the dev KMS container, next to its compose file',
  'keycloak/README.md': 'notes for the dev Keycloak container, next to its compose file',
  'k8s/issuer/README.md': 'developer entry of the issuer (make targets); users read /guides/kubernetes/',
  'k8s/issuer/docs/security.md': 'threat notes of the issuer, next to its code',
  'k8s/issuer/test/e2e/in-cluster/README.md': 'notes of a test harness',
  'ansible/tests/e2e/README.md': 'notes of a test harness',
  'krl-client/internal/app/testdata/README.md': 'notes of test data',
  'krl-client/spike/README.md': 'result of a spike, kept as evidence for decision-015',
};

/** Pages that moved or were merged: old site path -> new site path. */
export const REDIRECTS = {
  'guides/k8s-issuer': 'guides/kubernetes',
  'guides/k8s-issuer-install': 'guides/kubernetes',
  'guides/integrations': 'api/integrations',
};
