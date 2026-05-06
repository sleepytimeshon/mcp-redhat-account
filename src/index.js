#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const TOKEN_URL = "https://sso.redhat.com/auth/realms/redhat-external/protocol/openid-connect/token";
const API_BASE = "https://api.access.redhat.com/account/v1";
const CLIENT_ID = "rhsm-api";

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const offlineToken = process.env.REDHAT_TOKEN;
  if (!offlineToken) {
    throw new Error("REDHAT_TOKEN environment variable is required (Red Hat offline API token)");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: offlineToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function apiRequest(path, options = {}) {
  const token = await getAccessToken();
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API request failed (${res.status} ${res.statusText}): ${text}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// --- Response pagination ---

const DEFAULT_CHUNK = 30000;

function paginate(text, offset, limit, label) {
  const total = text.length;
  const start = Math.min(offset, total);
  const end = Math.min(start + limit, total);
  const slice = text.slice(start, end);
  const header = `# ${label}\n# chars ${start}-${end} of ${total}\n\n`;
  const footer =
    end < total
      ? `\n\n[truncated: showing chars ${start}-${end} of ${total}. Call again with offset=${end} for the next chunk.]`
      : "";
  return `${header}${slice}${footer}`;
}

const paginationSchema = {
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(0)
    .describe(`Byte offset into the rendered response. Default 0. Use the value from the previous call's "[truncated]" footer to fetch the next chunk.`),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .default(DEFAULT_CHUNK)
    .describe(`Maximum characters to return in this call. Default ${DEFAULT_CHUNK} keeps responses under typical MCP tool-result token caps.`),
};

function jsonResponse(data, offset, limit, label) {
  const text = JSON.stringify(data, null, 2);
  if (offset === undefined && limit === undefined) {
    return { content: [{ type: "text", text }] };
  }
  return { content: [{ type: "text", text: paginate(text, offset ?? 0, limit ?? DEFAULT_CHUNK, label ?? "response") }] };
}

function paginationParams(firstResultIndex, maxResults) {
  return new URLSearchParams({
    firstResultIndex: String(firstResultIndex),
    maxResults: String(maxResults),
  });
}

const server = new McpServer({
  name: "mcp-redhat-account",
  version: "1.1.0",
});

// === Accounts ===

server.registerTool(
  "listAccounts",
  {
    description: "List account details for the current user's Red Hat accounts. Large responses are paginated — call repeatedly with `offset` to read subsequent chunks.",
    inputSchema: {
      firstResultIndex: z.number().optional().default(0).describe("Upstream API row-pagination start index (default 0)"),
      maxResults: z.number().optional().default(100).describe("Upstream API max rows to return (default 100)"),
      ...paginationSchema,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ firstResultIndex, maxResults, offset, limit }) => {
    const data = await apiRequest(`/accounts?${paginationParams(firstResultIndex, maxResults)}`);
    return jsonResponse(data, offset, limit, "listAccounts");
  }
);

server.registerTool(
  "getCurrentUser",
  {
    description: "Get personal information of the currently authenticated Red Hat user",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => jsonResponse(await apiRequest("/user"))
);

// === Users ===

server.registerTool(
  "listUsers",
  {
    description: "List all users under a Red Hat account. Only Org Admins can list all users. Large responses are paginated — call repeatedly with `offset` to read subsequent chunks.",
    inputSchema: {
      accountId: z.string().describe("The account ID"),
      status: z.enum(["enabled", "disabled", "any"]).optional().default("enabled").describe("Filter by user status (default 'enabled')"),
      firstResultIndex: z.number().optional().default(0).describe("Upstream API row-pagination start index"),
      maxResults: z.number().optional().default(100).describe("Upstream API max rows to return"),
      ...paginationSchema,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ accountId, status, firstResultIndex, maxResults, offset, limit }) => {
    const params = paginationParams(firstResultIndex, maxResults);
    params.set("status", status);
    const data = await apiRequest(`/accounts/${accountId}/users?${params}`);
    return jsonResponse(data, offset, limit, `listUsers: ${accountId}`);
  }
);

server.registerTool(
  "getUserDetails",
  {
    description: "Get details of a specific user. Org Admins can view any user; others can only view themselves.",
    inputSchema: {
      accountId: z.string().describe("The account ID"),
      userId: z.string().describe("The user ID"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ accountId, userId }) => {
    return jsonResponse(await apiRequest(`/accounts/${accountId}/users/${userId}`));
  }
);

server.registerTool(
  "createUser",
  {
    description: "Create a new user under a Red Hat account. Only Org Admins can create users. Set validateUser=true to validate input without saving.",
    inputSchema: {
      accountId: z.string().describe("The account ID"),
      validateUser: z.boolean().optional().default(false).describe("If true, validate input without saving (returns 204 if valid)"),
      username: z.string().describe("Username for the new user"),
      firstName: z.string().describe("First name"),
      lastName: z.string().describe("Last name"),
      email: z.string().describe("Email address"),
      salutation: z.string().optional().describe("Salutation (e.g. Mr., Ms.)"),
      phone: z.string().optional().describe("Phone number"),
      address: z.object({
        streets: z.array(z.string()).optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        county: z.string().optional(),
        country: z.string().optional(),
        zipCode: z.string().optional(),
      }).optional().describe("Mailing address"),
      permissions: z.array(z.enum([
        "portal_download", "portal_system_management",
        "portal_manage_subscriptions", "portal_manage_cases",
      ])).optional().describe("Permissions to assign"),
      roles: z.array(z.enum(["organization_administrator"])).optional().describe("Roles to assign"),
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ accountId, validateUser, ...userData }) => {
    const params = new URLSearchParams({ validateUser: String(validateUser) });
    const data = await apiRequest(`/accounts/${accountId}/users?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userData),
    });
    if (data === null) {
      return { content: [{ type: "text", text: "Validation passed (204 No Content)" }] };
    }
    return jsonResponse(data);
  }
);

server.registerTool(
  "updateUser",
  {
    description: "Update a user's details. Org Admins can update email, roles, and permissions. Users can update their own name, address, and phone.",
    inputSchema: {
      accountId: z.string().describe("The account ID"),
      userId: z.string().describe("The user ID"),
      salutation: z.string().optional().describe("Salutation"),
      firstName: z.string().optional().describe("First name"),
      lastName: z.string().optional().describe("Last name"),
      phone: z.string().optional().describe("Phone number"),
      email: z.string().optional().describe("Email address"),
      address: z.object({
        streets: z.array(z.string()).optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        county: z.string().optional(),
        country: z.string().optional(),
        zipCode: z.string().optional(),
      }).optional().describe("Mailing address"),
      permissions: z.array(z.enum([
        "portal_download", "portal_system_management",
        "portal_manage_subscriptions", "portal_manage_cases",
      ])).optional().describe("Permissions to set"),
      roles: z.array(z.enum(["organization_administrator"])).optional().describe("Roles to set"),
    },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ accountId, userId, ...fields }) => {
    const body = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) body[k] = v;
    }
    const data = await apiRequest(`/accounts/${accountId}/users/${userId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return jsonResponse(data);
  }
);

// === User Status ===

server.registerTool(
  "getUserStatus",
  {
    description: "Get the current status of a user. Org Admins can view any user's status.",
    inputSchema: {
      accountId: z.string().describe("The account ID"),
      userId: z.string().describe("The user ID"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ accountId, userId }) => {
    return jsonResponse(await apiRequest(`/accounts/${accountId}/users/${userId}/status`));
  }
);

server.registerTool(
  "updateUserStatus",
  {
    description: "Enable or disable a user. Only Org Admins can update user status.",
    inputSchema: {
      accountId: z.string().describe("The account ID"),
      userId: z.string().describe("The user ID"),
      status: z.enum(["enabled", "disabled"]).describe("New status for the user"),
    },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ accountId, userId, status }) => {
    const data = await apiRequest(`/accounts/${accountId}/users/${userId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    return jsonResponse(data);
  }
);

// === User Roles ===

server.registerTool(
  "getUserRoles",
  {
    description: "Get all roles assigned to a user. Org Admins can view any user's roles.",
    inputSchema: {
      accountId: z.string().describe("The account ID"),
      userId: z.string().describe("The user ID"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ accountId, userId }) => {
    return jsonResponse(await apiRequest(`/accounts/${accountId}/users/${userId}/roles`));
  }
);

server.registerTool(
  "assignUserRole",
  {
    description: "Assign a role to a user. Only Org Admins can assign roles.",
    inputSchema: {
      accountId: z.string().describe("The account ID"),
      userId: z.string().describe("The user ID"),
      role: z.enum(["organization_administrator"]).describe("The role to assign"),
    },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ accountId, userId, role }) => {
    const data = await apiRequest(`/accounts/${accountId}/users/${userId}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    return jsonResponse(data);
  }
);

server.registerTool(
  "removeUserRole",
  {
    description: "Remove a role from a user. Only Org Admins can remove roles.",
    inputSchema: {
      accountId: z.string().describe("The account ID"),
      userId: z.string().describe("The user ID"),
      role: z.enum(["organization_administrator"]).describe("The role to remove"),
    },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ accountId, userId, role }) => {
    const data = await apiRequest(`/accounts/${accountId}/users/${userId}/roles`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    return jsonResponse(data);
  }
);

// === User Invitations ===

server.registerTool(
  "inviteUsers",
  {
    description: "Invite new users to join a Red Hat account by email. Only Org Admins can invite users.",
    inputSchema: {
      accountId: z.string().describe("The account ID"),
      emails: z.array(z.string()).describe("Email addresses to invite"),
      localeCode: z.string().optional().describe("Locale for the invitation email (e.g. 'en')"),
      permissions: z.array(z.enum([
        "portal_download", "portal_system_management",
        "portal_manage_subscriptions", "portal_manage_cases",
      ])).optional().describe("Permissions to grant invited users"),
      roles: z.array(z.enum(["organization_administrator"])).optional().describe("Roles to assign to invited users"),
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ accountId, ...inviteData }) => {
    const data = await apiRequest(`/accounts/${accountId}/users/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inviteData),
    });
    return jsonResponse(data);
  }
);

// --- Start server ---

const transport = new StdioServerTransport();
await server.connect(transport);
