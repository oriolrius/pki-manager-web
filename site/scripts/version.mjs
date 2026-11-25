// PKI Manager version data for the site, from the repo (package.json, CHANGELOG.md, git).
// Needs the full git history and tags: in CI, check out with fetch-depth: 0.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();

if (git('rev-parse', '--is-shallow-repository') === 'true') {
  throw new Error('version: shallow git clone, page versions would be wrong (use fetch-depth: 0)');
}

/** The release the site documents: the version in package.json, its CHANGELOG date, commits after its tag. */
export function siteVersion() {
  const version = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version;
  const tag = `v${version}`;
  const date = readFileSync(join(REPO, 'CHANGELOG.md'), 'utf8').match(new RegExp(`^## ${tag.replace(/\./g, '\\.')} \\((\\d{4}-\\d{2}-\\d{2})\\)`, 'm'))?.[1] ?? null;
  // The bump commit can be built before its tag is pushed: then it is the release commit.
  const tagged = git('tag', '--list', tag) === tag;
  const commitsAfter = tagged ? Number(git('rev-list', '--count', `${tag}..HEAD`)) : 0;
  return { version, date, commit: git('rev-parse', '--short', 'HEAD'), commitsAfter };
}

/** First release that contains the last change of a repo file, or null when the change is newer than all releases. */
export function changedIn(repoPath) {
  const commit = git('log', '-1', '--format=%H', '--', repoPath);
  if (!commit) return null;
  const first = git('tag', '--contains', commit, '--sort=v:refname', '--list', 'v[0-9]*').split('\n')[0];
  return first ? first.slice(1) : null;
}
