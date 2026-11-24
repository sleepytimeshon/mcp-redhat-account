# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.2] - 2026-11-23

### Added
- This changelog, included in the published package.

### Security
- Upgrade `@modelcontextprotocol/sdk` to 1.32.2 and `zod` to 4.6.7, and refresh the lockfile, clearing every `npm audit` advisory (1 critical, 8 high, 2 moderate) in the SDK, zod, and their transitive dependencies.

## [1.1.1] - 2026-11-23

### Added
- Continuous integration on Node.js 18, 20, 22, and 24 for every push and pull request to `main`, with a stdio smoke test that checks the registered tools against the README and the reported server version against `package.json`.
- Automated npm publishing with provenance through npm trusted publishing, plus a GitHub release for each version.
- `engines.node` declares the supported Node.js range (18.14.1 or later).
- README sections on pagination, version pinning, and the release process.

### Changed
- The published package contains only `src/`, `README.md`, `LICENSE`, and `package.json`.

### Fixed
- README setup for Claude Code (MCP servers belong in `~/.claude.json` or `.mcp.json`, not `settings.json`), VS Code (`servers` key and `${env:...}` variables), and Cursor, now documented separately.
- The `bin` path no longer uses a `./` prefix, which npm 11 drops on publish.

## [1.1.0] - 2026-05-06

### Added
- Optional `offset` and `limit` parameters on `listAccounts` and `listUsers` split large responses into chunks; truncated responses end with a footer giving the next `offset`.

### Fixed
- The server reports its package version; earlier releases reported 1.0.0.

## [1.0.3] - 2026-03-20

### Changed
- Repository and issue URLs point to the `sleepytimeshon` GitHub account after the repository transfer.

## [1.0.2] - 2026-03-12

### Changed
- README lists `mcp-redhat-manpage` under Related MCP Servers, in a standard order across all servers.

## [1.0.1] - 2026-03-10

### Added
- README configuration for Gemini CLI and watsonx Orchestrate, and guidance on supplying `REDHAT_TOKEN` through a secrets manager.

## [1.0.0] - 2026-03-08

### Added
- First public release: an MCP server for the Red Hat Account Management API with 12 tools for accounts, users, user status, and role assignments.

[Unreleased]: https://github.com/sleepytimeshon/mcp-redhat-account/compare/v1.1.2...HEAD
[1.1.2]: https://www.npmjs.com/package/mcp-redhat-account/v/1.1.2
[1.1.1]: https://www.npmjs.com/package/mcp-redhat-account/v/1.1.1
[1.1.0]: https://www.npmjs.com/package/mcp-redhat-account/v/1.1.0
[1.0.3]: https://www.npmjs.com/package/mcp-redhat-account/v/1.0.3
[1.0.2]: https://www.npmjs.com/package/mcp-redhat-account/v/1.0.2
[1.0.1]: https://www.npmjs.com/package/mcp-redhat-account/v/1.0.1
[1.0.0]: https://www.npmjs.com/package/mcp-redhat-account/v/1.0.0
