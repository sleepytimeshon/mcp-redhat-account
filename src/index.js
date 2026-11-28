#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  apiRequest,
  DEFAULT_CHUNK,
  emptyResultNote,
  formatAccounts,
  formatUser,
  formatUserList,
  getMyAccounts,
  MAX_USERS_PAGE,
  normalizeEmail,
  normalizeLogin,
  normalizeUserId,
  paginate,
  PERMISSIONS,
  resolveAccountId,
  ROLES,
} from "./lib.js";

const paginationSchema = {
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(0)
    .describe(`Character offset into the rendered response. Default 0. Use the value from the previous call's "[truncated]" footer to fetch the next chunk.`),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .default(DEFAULT_CHUNK)
    .describe(`Maximum characters to return in this call. Default ${DEFAULT_CHUNK} keeps responses under typical MCP tool-result token caps.`),
};

const accountIdSchema = z.string().optional().describe("Account ID; defaults to your account (see listAccounts)");
const userIdSchema = z.string().describe("User ID (digits; getCurrentUser gives your own)");
const permissionsSchema = z.array(z.enum(PERMISSIONS)).optional();
const rolesSchema = z.array(z.enum(ROLES)).optional();
const addressSchema = z.object({
  streets: z.array(z.string()).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  county: z.string().optional(),
  country: z.string().optional(),
  zipCode: z.string().optional(),
}).optional().describe("Mailing address");

const READ = { readOnlyHint: true, openWorldHint: true };
const textResult = (text) => ({ content: [{ type: "text", text }] });
const server = new McpServer({ name: "mcp-redhat-account", version: "2.0.0" });

const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

// === Accounts and the current user ===

server.registerTool(
  "listAccounts",
  {
    description: "List the Red Hat accounts the REDHAT_TOKEN user belongs to (ID, name, type). Other tools default to the user's account when there is only one.",
    inputSchema: {},
    annotations: READ,
  },
  async () => textResult(formatAccounts(await getMyAccounts()))
);

server.registerTool(
  "getCurrentUser",
  {
    description: "Get the REDHAT_TOKEN user's own personal information: user ID, username, name, email, and status.",
    inputSchema: {},
    annotations: READ,
  },
  async () => textResult(formatUser((await apiRequest("/user"))?.body || {}, { title: "Current user" }))
);

// === Users ===

server.registerTool(
  "listUsers",
  {
    description: "List the users on an account (username, user ID, name, email, status, permissions). Only organization administrators can list users. Pages with maxResults and startAt; large output is paginated — call again with `offset`.",
    inputSchema: {
      accountId: accountIdSchema,
      status: z.enum(["enabled", "disabled", "any"]).optional().default("enabled").describe("Which users to list (default enabled)"),
      maxResults: z.number().int().min(1).max(MAX_USERS_PAGE).optional().default(100).describe(`Users per call, 1-${MAX_USERS_PAGE} (default 100)`),
      startAt: z.number().int().nonnegative().optional().default(0).describe("Skip this many users (for the next page)"),
      ...paginationSchema,
    },
    annotations: READ,
  },
  async ({ accountId, status, maxResults, startAt, offset, limit }) => {
    const acct = await resolveAccountId(accountId);
    const data = await apiRequest(`/accounts/${acct}/users`, { query: { status, maxResults, firstResultIndex: startAt } });
    const list = data?.body || [];
    const note = list.length ? "" : await emptyResultNote(acct);
    return textResult(paginate(formatUserList(list, { accountId: acct, startAt, limit: maxResults }) + note, offset, limit, `listUsers: ${acct}`));
  }
);

server.registerTool(
  "searchUsers",
  {
    description: "Look up as many as 100 users on an account by username or by user ID (give one or the other). Organization administrators can find any user on the account. Users not found are listed.",
    inputSchema: {
      accountId: accountIdSchema,
      usernames: z.array(z.string()).min(1).max(100).optional().describe("Usernames (logins) to look up"),
      userIds: z.array(z.string()).min(1).max(100).optional().describe("User IDs to look up"),
      ...paginationSchema,
    },
    annotations: READ,
  },
  async ({ accountId, usernames, userIds, offset, limit }) => {
    if (Boolean(usernames) === Boolean(userIds)) throw new Error("Give either usernames or userIds, not both");
    const acct = await resolveAccountId(accountId);
    const by = usernames ? { logins: usernames.map(normalizeLogin) } : { ids: userIds.map(normalizeUserId) };
    const list = (await apiRequest(`/accounts/${acct}/users/search`, { method: "POST", body: { by } }))?.body || [];
    const found = new Set(list.flatMap((s) => [s.user?.username, s.user?.id].filter(Boolean).map((x) => String(x).toLowerCase())));
    const missing = (by.logins || by.ids).filter((x) => !found.has(String(x).toLowerCase()));
    const note = missing.length ? `\n\nNot found: ${missing.join(", ")}.${await emptyResultNote(acct)}` : "";
    return textResult(paginate(formatUserList(list, { accountId: acct, title: "Matching users" }) + note, offset, limit, `searchUsers: ${acct}`));
  }
);

server.registerTool(
  "getUserDetails",
  {
    description: "Get a user's details: username, name, email, phone, address, status, roles, and permissions. Organization administrators can read any user on the account; others only themselves.",
    inputSchema: { accountId: accountIdSchema, userId: userIdSchema },
    annotations: READ,
  },
  async ({ accountId, userId }) => {
    const acct = await resolveAccountId(accountId);
    return textResult(formatUser((await apiRequest(`/accounts/${acct}/users/${normalizeUserId(userId)}`))?.body || {}));
  }
);

server.registerTool(
  "getUserStatus",
  {
    description: "Get whether a user is enabled or disabled. Organization administrators can read any user; others only themselves.",
    inputSchema: { accountId: accountIdSchema, userId: userIdSchema },
    annotations: READ,
  },
  async ({ accountId, userId }) => {
    const acct = await resolveAccountId(accountId);
    const id = normalizeUserId(userId);
    const status = (await apiRequest(`/accounts/${acct}/users/${id}/status`))?.body?.status;
    return textResult(`User ${id} on account ${acct} is ${status || "of unknown status"}.`);
  }
);

server.registerTool(
  "getUserRoles",
  {
    description: "Get the roles of a user (for example organization_administrator). Organization administrators can read any user; others only themselves.",
    inputSchema: { accountId: accountIdSchema, userId: userIdSchema },
    annotations: READ,
  },
  async ({ accountId, userId }) => {
    const acct = await resolveAccountId(accountId);
    const id = normalizeUserId(userId);
    const roles = (await apiRequest(`/accounts/${acct}/users/${id}/roles`))?.body?.roles || [];
    return textResult(`User ${id} on account ${acct} has ${roles.length ? `the roles: ${roles.join(", ")}` : "no roles"}.`);
  }
);

server.registerTool(
  "createUser",
  {
    description: "Create a user on an account (organization administrators only). By default this only validates the input and creates nothing; set validateOnly to false to create the user.",
    inputSchema: {
      accountId: accountIdSchema,
      validateOnly: z.boolean().optional().default(true).describe("Only validate the input (default true); false creates the user"),
      username: z.string().min(1).describe("Username for the new user"),
      firstName: z.string().min(1).describe("First name"),
      lastName: z.string().min(1).describe("Last name"),
      email: z.string().describe("Email address"),
      salutation: z.string().optional().describe("Salutation (e.g. Mr., Ms.)"),
      phone: z.string().optional().describe("Phone number"),
      address: addressSchema,
      permissions: permissionsSchema.describe(`Permissions: ${PERMISSIONS.join(", ")}`),
      roles: rolesSchema.describe("Roles to assign"),
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ accountId, validateOnly, ...user }) => {
    const acct = await resolveAccountId(accountId);
    const body = compact({ ...user, username: normalizeLogin(user.username), email: normalizeEmail(user.email) });
    const data = await apiRequest(`/accounts/${acct}/users`, { method: "POST", query: { validateUser: validateOnly }, body });
    if (validateOnly) {
      return textResult(`Validation passed for ${body.username} on account ${acct}; nothing was created. Call again with validateOnly: false to create the user.`);
    }
    return textResult(`Created user ${body.username} on account ${acct}.\n\n${formatUser(data?.body || body)}`);
  }
);

server.registerTool(
  "updateUser",
  {
    description: "Update a user. Organization administrators can change another user's email, roles, and permissions; name, salutation, phone, and address can be changed only by the user themselves. Roles and permissions replace the current lists.",
    inputSchema: {
      accountId: accountIdSchema,
      userId: userIdSchema,
      salutation: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: addressSchema,
      permissions: permissionsSchema.describe(`Full list of permissions: ${PERMISSIONS.join(", ")}`),
      roles: rolesSchema.describe("Full list of roles"),
    },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ accountId, userId, ...fields }) => {
    const acct = await resolveAccountId(accountId);
    const id = normalizeUserId(userId);
    const body = compact({ ...fields, email: fields.email ? normalizeEmail(fields.email) : undefined });
    if (Object.keys(body).length === 0) throw new Error("No fields to update");
    const data = await apiRequest(`/accounts/${acct}/users/${id}`, { method: "POST", body });
    return textResult(`Updated user ${id} (${Object.keys(body).join(", ")}).\n\n${formatUser(data?.body || {})}`);
  }
);

server.registerTool(
  "updateUserStatus",
  {
    description: "Enable or disable a user (organization administrators only). A disabled user cannot log in.",
    inputSchema: {
      accountId: accountIdSchema,
      userId: userIdSchema,
      status: z.enum(["enabled", "disabled"]).describe("New status"),
    },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ accountId, userId, status }) => {
    const acct = await resolveAccountId(accountId);
    const id = normalizeUserId(userId);
    const data = await apiRequest(`/accounts/${acct}/users/${id}/status`, { method: "POST", body: { status } });
    return textResult(`User ${id} on account ${acct} is now ${data?.body?.status || status}.`);
  }
);

server.registerTool(
  "assignUserRole",
  {
    description: "Give a user a role (organization administrators only).",
    inputSchema: { accountId: accountIdSchema, userId: userIdSchema, role: z.enum(ROLES).describe("Role to assign") },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ accountId, userId, role }) => {
    const acct = await resolveAccountId(accountId);
    const id = normalizeUserId(userId);
    const roles = (await apiRequest(`/accounts/${acct}/users/${id}/roles`, { method: "POST", body: { role } }))?.body?.roles || [];
    return textResult(`Assigned ${role} to user ${id}. Roles now: ${roles.join(", ") || "none"}.`);
  }
);

server.registerTool(
  "removeUserRole",
  {
    description: "Remove a role from a user (organization administrators only).",
    inputSchema: { accountId: accountIdSchema, userId: userIdSchema, role: z.enum(ROLES).describe("Role to remove") },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ accountId, userId, role }) => {
    const acct = await resolveAccountId(accountId);
    const id = normalizeUserId(userId);
    const roles = (await apiRequest(`/accounts/${acct}/users/${id}/roles`, { method: "DELETE", body: { role } }))?.body?.roles || [];
    return textResult(`Removed ${role} from user ${id}. Roles now: ${roles.join(", ") || "none"}.`);
  }
);

server.registerTool(
  "inviteUsers",
  {
    description: "Email invitations to join an account (organization administrators only), optionally with permissions and roles for the new users.",
    inputSchema: {
      accountId: accountIdSchema,
      emails: z.array(z.string()).min(1).max(100).describe("Email addresses to invite"),
      localeCode: z.string().optional().describe("Language of the invitation email (e.g. 'en', 'ja')"),
      permissions: permissionsSchema.describe(`Permissions for the invited users: ${PERMISSIONS.join(", ")}`),
      roles: rolesSchema.describe("Roles for the invited users"),
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ accountId, emails, localeCode, permissions, roles }) => {
    const acct = await resolveAccountId(accountId);
    const body = compact({ emails: emails.map(normalizeEmail), localeCode, permissions, roles });
    const data = await apiRequest(`/accounts/${acct}/users/invite`, { method: "POST", body });
    return textResult(`Invited ${body.emails.length} user(s) to account ${acct}${data?.body?.status ? `: ${data.body.status}` : ""}.`);
  }
);

// --- Start server ---

const transport = new StdioServerTransport();
await server.connect(transport);
