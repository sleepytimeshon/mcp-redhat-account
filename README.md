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

## Prerequisites

- Node.js 18+
- A Red Hat offline API token ([generate one here](https://access.redhat.com/management/api))

## Configuration

Set your Red Hat offline API token in your shell profile:

```bash
export REDHAT_TOKEN="your-offline-token-here"
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

- [mcp-redhat-support](https://github.com/shonstephens/mcp-redhat-support) - Support case management
- [mcp-redhat-subscription](https://github.com/shonstephens/mcp-redhat-subscription) - Subscription management
- [mcp-redhat-knowledge](https://github.com/shonstephens/mcp-redhat-knowledge) - Knowledge Base search

## License

MIT
