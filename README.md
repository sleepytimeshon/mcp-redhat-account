# mcp-redhat-account

An [MCP](https://modelcontextprotocol.io/) server for the Red Hat Account Management API. Lets AI assistants query account info, manage users, roles, and permissions.

## Tools

| Tool | Description |
|------|-------------|
| `listAccounts` | List account details for the current user's Red Hat accounts |
| `getCurrentUser` | Get personal information of the currently authenticated user |
| `listUsers` | List all users under an account (Org Admin only) |
| `getUserDetails` | Get details of a specific user |
| `createUser` | Create a new user under an account (Org Admin only) |
| `updateUser` | Update a user's details (email, roles, permissions, address, etc.) |
| `getUserStatus` | Get the current status of a user |
| `updateUserStatus` | Enable or disable a user (Org Admin only) |
| `getUserRoles` | Get all roles assigned to a user |
| `assignUserRole` | Assign a role to a user (Org Admin only) |
| `removeUserRole` | Remove a role from a user (Org Admin only) |
| `inviteUsers` | Invite new users to join an account by email (Org Admin only) |

## Pagination

`listAccounts` and `listUsers` accept optional `offset` (default 0) and `limit` (default 30000) parameters to chunk response output. Listing users for a large organization can exceed typical MCP tool-result token caps when returned whole. When a response is truncated, the output ends with a footer like:

```
[truncated: showing chars 0-30000 of 102783. Call again with offset=30000 for the next chunk.]
```

Pass that `offset` back to fetch the next chunk. Small responses return in one call. The upstream API's `firstResultIndex`/`maxResults` row-pagination is preserved unchanged on both tools.

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

The server exchanges your Red Hat offline API token for a short-lived bearer token via Red Hat SSO. Tokens are cached and refreshed automatically.

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
