# mcp-redhat-account

An [MCP](https://modelcontextprotocol.io/) server for the Red Hat Account Management API. Lets AI assistants query account info, manage users, roles, and permissions.

## Tools

| Tool | Description |
|------|-------------|
| `listAccounts` | List the accounts the token user belongs to |
| `getCurrentUser` | Get the token user's own ID, username, name, email, and status |
| `listUsers` | List an account's users, enabled, disabled, or both (organization administrators only) |
| `searchUsers` | Look up as many as 100 users by username or user ID |
| `getUserDetails` | Get a user's details, roles, permissions, and address |
| `getUserStatus` | Get whether a user is enabled or disabled |
| `getUserRoles` | Get a user's roles |
| `createUser` | Validate, or with `validateOnly: false` create, a user (organization administrators only) |
| `updateUser` | Update a user's email, roles, and permissions (administrators) or name, phone, and address (the user) |
| `updateUserStatus` | Enable or disable a user (organization administrators only) |
| `assignUserRole` | Give a user a role (organization administrators only) |
| `removeUserRole` | Remove a role from a user (organization administrators only) |
| `inviteUsers` | Email invitations to join an account (organization administrators only) |

Every tool that takes `accountId` defaults to the token user's account when the user belongs to exactly one (see `listAccounts`).

## Permissions

Only organization administrators can list, search, create, or change other users. Without that role, the API answers 403 and the tools say so, and you can still read your own user with `getCurrentUser`, `getUserDetails`, `getUserStatus`, and `getUserRoles`. Listing an account you do not belong to returns an empty list rather than an error; `listUsers` and `searchUsers` point that out.

## Pagination

`listUsers` pages through users with `maxResults` (1-1000, default 100) and `startAt`; a full page ends with a note giving the next `startAt`. (Above 1000, the API stops enforcing permissions consistently and returns only your own user, so larger pages are refused.)

`listUsers` and `searchUsers` also accept `offset` (default 0) and `limit` (default 30000), counted in characters of rendered output, to chunk long output. When a response is truncated, it ends with a footer like:

```
[truncated: showing chars 0-30000 of 102783. Call again with offset=30000 for the next chunk.]
```

Pass that `offset` back to fetch the next chunk.

## Output

Tool output is Markdown written for a language model: tables for listings, labeled fields for details, empty fields dropped, and API errors as one readable line.

## Prerequisites

- Node.js 18.14.1+
- A Red Hat offline API token ([generate one here](https://access.redhat.com/management/api))

## Configuration

Set your Red Hat offline API token in your shell profile:

```bash
export REDHAT_TOKEN="your-offline-token-here"
```

In enterprise environments, provide `REDHAT_TOKEN` through your secrets management solution (e.g. HashiCorp Vault, Kubernetes secrets, or your CI platform's secret variables) rather than shell profiles.

The offline token expires if it is not used for 30 days; generate a new one from the same page if authentication starts failing.

### Pinning a version

The examples below run `npx -y mcp-redhat-account`, which fetches the latest published release each time the server starts. For operational use, pin a version so upgrades happen deliberately:

- Replace `mcp-redhat-account` in `args` with `mcp-redhat-account@<version>` (e.g. `mcp-redhat-account@1.1.0`), or
- Install it once with `npm install -g mcp-redhat-account@<version>` and use `mcp-redhat-account` as the `command` with no `args`.

### Gemini CLI

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "redhat-account": {
      "command": "npx",
      "args": ["-y", "mcp-redhat-account"],
      "env": {
        "REDHAT_TOKEN": "$REDHAT_TOKEN"
      }
    }
  }
}
```

### watsonx Orchestrate

```bash
# Add a connection for the Red Hat API token
orchestrate connections add --app-id "redhat-account"
orchestrate connections configure --app-id redhat-account --env draft --kind key_value --type team --url "https://access.redhat.com"
orchestrate connections set-credentials --app-id "redhat-account" --env draft -e REDHAT_TOKEN=your-offline-token-here

# Import the MCP toolkit
orchestrate toolkits import --kind mcp \
  --name redhat-account \
  --description "Red Hat Account Management" \
  --command "npx -y mcp-redhat-account" \
  --tools "*" \
  --app-id redhat-account
```

### Claude Code

Claude Code reads MCP servers from `~/.claude.json` (user and local scopes) or a project's `.mcp.json`, not from `settings.json`.

To make the server available in every project, add it at user scope:

```bash
claude mcp add redhat-account --scope user \
  -e REDHAT_TOKEN="$REDHAT_TOKEN" \
  -- npx -y mcp-redhat-account
```

This stores the token's value in `~/.claude.json`. To keep the token out of configuration files, add the server to a project's `.mcp.json` instead; Claude Code expands `${REDHAT_TOKEN}` from the environment when it starts the server:

```json
{
  "mcpServers": {
    "redhat-account": {
      "command": "npx",
      "args": ["-y", "mcp-redhat-account"],
      "env": {
        "REDHAT_TOKEN": "${REDHAT_TOKEN}"
      }
    }
  }
}
```

Run `claude mcp list` to confirm the server connects.

### VS Code

Add to `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "redhat-account": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-redhat-account"],
      "env": {
        "REDHAT_TOKEN": "${env:REDHAT_TOKEN}"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your workspace, or `~/.cursor/mcp.json` for all workspaces:

```json
{
  "mcpServers": {
    "redhat-account": {
      "command": "npx",
      "args": ["-y", "mcp-redhat-account"],
      "env": {
        "REDHAT_TOKEN": "${env:REDHAT_TOKEN}"
      }
    }
  }
}
```

## Authentication

The server exchanges your Red Hat offline API token for a short-lived bearer token via Red Hat SSO. Tokens are cached, refreshed automatically, and exchanged again if the API rejects a cached one. Every request times out after 30 seconds.

## Releasing

Every push to `main` runs CI (`.github/workflows/ci.yml`): `npm ci`, a syntax check, and `npm test` on Node 18, 20, 22, and 24. `npm test` starts the server and checks that its tools match the tables in [Tools](#tools) and that it reports the `package.json` version.

To release, bump `version` in both `package.json` and the `McpServer` declaration in `src/index.js`, move the `[Unreleased]` entries in [CHANGELOG.md](CHANGELOG.md) under a heading for the new version, then push to `main`. When that version is not yet on npm, CI publishes it with provenance through npm trusted publishing and creates a `vX.Y.Z` GitHub release. Pushes that keep the version only run the tests.

## Related MCP Servers

- [mcp-redhat-knowledge](https://github.com/sleepytimeshon/mcp-redhat-knowledge) - Knowledge Base search
- [mcp-redhat-manpage](https://github.com/sleepytimeshon/mcp-redhat-manpage) - RHEL man pages
- [mcp-redhat-subscription](https://github.com/sleepytimeshon/mcp-redhat-subscription) - Subscription management
- [mcp-redhat-support](https://github.com/sleepytimeshon/mcp-redhat-support) - Support case management

## License

MIT
