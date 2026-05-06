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

- Node.js 18+
- A Red Hat offline API token ([generate one here](https://access.redhat.com/management/api))

## Configuration

Set your Red Hat offline API token in your shell profile:

```bash
export REDHAT_TOKEN="your-offline-token-here"
```

In enterprise environments, provide `REDHAT_TOKEN` through your secrets management solution (e.g. HashiCorp Vault, Kubernetes secrets, or your CI platform's secret variables) rather than shell profiles.

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

Add to `~/.claude/settings.json`:

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

### VS Code / Cursor

Add to `.vscode/mcp.json` in your workspace:

```json
{
  "mcpServers": {
    "redhat-account": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-redhat-account"],
      "env": {
        "REDHAT_TOKEN": "${REDHAT_TOKEN}"
      }
    }
  }
}
```

## Authentication

The server exchanges your Red Hat offline API token for a short-lived bearer token via Red Hat SSO. Tokens are cached and refreshed automatically.

## Related MCP Servers

- [mcp-redhat-knowledge](https://github.com/sleepytimeshon/mcp-redhat-knowledge) - Knowledge Base search
- [mcp-redhat-manpage](https://github.com/sleepytimeshon/mcp-redhat-manpage) - RHEL man pages
- [mcp-redhat-subscription](https://github.com/sleepytimeshon/mcp-redhat-subscription) - Subscription management
- [mcp-redhat-support](https://github.com/sleepytimeshon/mcp-redhat-support) - Support case management

## License

MIT
