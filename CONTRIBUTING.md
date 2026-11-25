# Contributing

PKI Manager is a personal project of one maintainer, with no commercial interest. Problem reports
and pull requests are welcome. There is no response time: the maintainer answers when they can.

## Report a problem or ask for a feature

Open an issue: <https://github.com/oriolrius/pki-manager-web/issues>. Each issue is public and stays
in the archive of the repository.

- A problem: say the version (`GET /api/v1/health` gives it), how it is deployed, the steps, what
  you expected and what you got. Logs and screenshots help.
- A feature: say what you want to do and why. A use case helps more than a design.

A security vulnerability is different: do **not** open an issue. Report it in private as the
[security policy](SECURITY.md) says.

## Send a change

1. Fork the repository and make a branch from `main`.
2. Set up the development stack: [Development setup](docs/development/setup.md).
3. Make the change. Read the `AGENTS.md` guide of the part that you change (`backend/`,
   `frontend/`, `k8s/issuer/`): it has the architecture and the rules of that part.
4. Run the checks (below). They must all pass.
5. Open a pull request against `main`. Say what was wrong, what you changed and how you tested it.
   Link the issue (`Fixes #123`).

CI runs the same checks on the pull request ([CI and releases](docs/development/ci.md)). The
maintainer merges a pull request only when every required check passes.

## Rules for a change

- **Tests.** New functionality comes with automated tests that prove it. A bug fix comes with a
  regression test that fails before the fix and passes after it. A pull request without tests
  for a code change is not merged, unless it says why a test is not possible.
- **Checks.** `just typecheck`, `just lint` and `just test` pass with no errors. An explicit
  `any` is a lint error: use a real type. Do not turn off a check (`@ts-ignore`,
  `eslint-disable`) without a written reason on the same line. The Go code passes `go vet ./...`
  and `go test ./...` in its module. [Testing](docs/development/testing.md) has the details.
- **Security.** Private keys stay in the Cosmian KMS: the database stores only KMS ids. Validate
  all input with Zod, and fail closed. Every operation that changes state writes an `audit_log`
  row, for success and for failure. No secrets in the code or in the tests.
- **Dependencies.** Add a dependency only when it is necessary. Pin it in the lock file
  (`pnpm-lock.yaml`, `go.sum`). A new GitHub Action is pinned by commit SHA.
- **Documentation.** A change of behaviour updates the document that describes it, in the same
  pull request. One topic has one document: [How the docs are organised](docs/development/documentation.md).
  Write in English, with short sentences, and only what you ran or read in the code.
- **Commits.** Use [Conventional Commits](https://www.conventionalcommits.org/)
  (`fix(backend): ...`, `feat(frontend): ...`, `docs: ...`). The release tool (Commitizen) writes
  the release notes from them.

## License

The project is under the [Apache License 2.0](LICENSE). By sending a pull request you agree that
your contribution is under the same license (section 5 of the license). You keep your copyright.
