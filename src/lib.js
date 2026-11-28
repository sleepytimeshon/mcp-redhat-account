// Red Hat Account Management API client, input validation, and Markdown formatters for
// mcp-redhat-account. Kept separate from src/index.js, which starts the stdio transport, so
// tests can import it.

export const TOKEN_URL = "https://sso.redhat.com/auth/realms/redhat-external/protocol/openid-connect/token";
export const API_BASE = "https://api.access.redhat.com/account/v1";
const CLIENT_ID = "rhsm-api";

export const FETCH_TIMEOUT_MS = 30000;

// --- HTTP ---

export async function fetchWithTimeout(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err?.name === "TimeoutError") {
      throw new Error(`Request to ${new URL(url).host} timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  }
}

// --- Authentication ---

let cachedToken = null;
let tokenExpiry = 0;
let cachedAccounts = null;

export function clearTokenCache() {
  cachedToken = null;
  tokenExpiry = 0;
  cachedAccounts = null;
}

export async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const offlineToken = process.env.REDHAT_TOKEN;
  if (!offlineToken) {
    throw new Error("REDHAT_TOKEN environment variable is required (Red Hat offline API token)");
  }

  const res = await fetchWithTimeout(TOKEN_URL, {
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
  if (!data.access_token) {
    throw new Error("Token exchange returned no access_token");
  }
  const lifetime = Number.isFinite(data.expires_in) ? data.expires_in : 300;
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + Math.max(lifetime - 60, 0) * 1000;
  return cachedToken;
}

// --- Errors ---

export class ApiError extends Error {
  constructor(status, message, problemType) {
    super(`Red Hat Account API error ${status}: ${message}`);
    this.status = status;
    this.problemType = problemType;
  }
}

// The API answers with RFC 7807 problem documents: { type, title, status, detail, properties }
function parseProblem(text) {
  try {
    const j = JSON.parse(text);
    const detail = [j.title, j.detail].filter((x) => typeof x === "string" && x);
    const props = j.properties && typeof j.properties === "object"
      ? Object.entries(j.properties).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
      : [];
    return { message: [...new Set(detail)].join(": ") + (props.length ? ` (${props.join("; ")})` : ""), type: j.type };
  } catch {
    return { message: text.trim().slice(0, 500), type: undefined };
  }
}

export const FORBIDDEN_HINT = "Only organization administrators can list, search, or change other users on an account. Without that role you can still read your own user with getCurrentUser, getUserDetails, getUserStatus, and getUserRoles.";

// --- API ---

// Call the API; retries once with a fresh access token on 401. Returns parsed JSON or null.
export async function apiRequest(path, { method = "GET", body, query } = {}) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const attempt = async () => {
    const token = await getAccessToken();
    return fetchWithTimeout(url.href, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res = await attempt();
  if (res.status === 401) {
    cachedToken = null;
    tokenExpiry = 0;
    res = await attempt();
  }

  const text = await res.text();
  if (!res.ok) {
    const { message, type } = parseProblem(text);
    const hint = res.status === 403 ? ` ${FORBIDDEN_HINT}` : "";
    throw new ApiError(res.status, `${String(message || res.statusText).replace(/\.$/, "")}.${hint}`, type);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// The token user's accounts (cached)
export async function getMyAccounts() {
  if (!cachedAccounts) cachedAccounts = (await apiRequest("/accounts", { query: { maxResults: 100 } }))?.body || [];
  return cachedAccounts;
}

// Default an account ID to the token user's only account
export async function resolveAccountId(accountId) {
  if (accountId !== undefined && accountId !== null && String(accountId).trim() !== "") return normalizeAccountId(accountId);
  const accounts = await getMyAccounts();
  if (accounts.length === 1) return String(accounts[0].id);
  if (accounts.length === 0) throw new Error("The REDHAT_TOKEN user belongs to no account");
  throw new Error(`The REDHAT_TOKEN user belongs to ${accounts.length} accounts (${accounts.map((a) => a.id).join(", ")}); pass accountId`);
}

// An empty listing for an account the user does not belong to is an access problem, not an empty account
export async function emptyResultNote(accountId) {
  const accounts = await getMyAccounts().catch(() => []);
  if (accounts.length && !accounts.some((a) => String(a.id) === String(accountId))) {
    return `\n\n> You do not belong to account ${accountId}; the API returns an empty list instead of an error. Your accounts: ${accounts.map((a) => a.id).join(", ")}.`;
  }
  return "";
}

// --- Validation ---

function check(value, pattern, what, example) {
  const v = String(value ?? "").trim();
  if (!pattern.test(v)) throw new Error(`Invalid ${what} "${value}": expected ${example}`);
  return v;
}

export const normalizeAccountId = (v) => check(v, /^\d{1,15}$/, "account ID", "digits only (see listAccounts)");
export const normalizeUserId = (v) => check(v, /^\d{1,20}$/, "user ID", "digits only (see getCurrentUser or listUsers)");
export const normalizeLogin = (v) => check(v, /^[^\s/\\?#%]{1,100}$/, "username", "a Red Hat login name");
export const normalizeEmail = (v) => check(v, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, "email address", "name@example.com");

export const PERMISSIONS = ["portal_download", "portal_system_management", "portal_manage_subscriptions", "portal_manage_cases"];
export const ROLES = ["organization_administrator"];
export const MAX_USERS_PAGE = 1000;

// --- Formatting ---

const present = (v) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
const oneLine = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const cell = (v) => oneLine(v).replace(/\|/g, "\\|");
const fullName = (u) => [u.salutation, u.firstName, u.lastName].filter(Boolean).join(" ");

function table(headers, rows) {
  return `| ${headers.join(" | ")} |\n|${" --- |".repeat(headers.length)}\n${rows.map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n")}`;
}

function fields(pairs) {
  return pairs.filter(([, v]) => present(v)).map(([k, v]) => `**${k}:** ${Array.isArray(v) ? v.join(", ") : v}`).join("\n");
}

export function formatAccounts(list) {
  if (!list?.length) return "The REDHAT_TOKEN user belongs to no account.";
  return `## Accounts (${list.length})\n\n${table(["Account ID", "Name", "Type"], list.map((a) => [a.id, a.name, a.type]))}`;
}

export function formatAddress(a) {
  if (!a) return "";
  const parts = [...(a.streets || []), a.city, a.county, a.state, a.zipCode, a.country].filter(Boolean);
  return parts.join(", ");
}

export function formatUser(u, { title = "User" } = {}) {
  return [
    `# ${title}: ${u.username || u.id}`,
    fields([
      ["User ID", u.id], ["Username", u.username], ["Name", fullName(u)], ["Email", u.email], ["Phone", u.phone],
      ["Status", u.status], ["Roles", u.roles], ["Permissions", u.permissions], ["Address", formatAddress(u.address)],
    ]),
  ].join("\n");
}

export function formatUserList(list, { accountId, startAt = 0, limit, title = "Users" } = {}) {
  const items = (list || []).map((s) => ({ ...(s.user || s), permissions: s.permissions ?? s.user?.permissions }));
  if (!items.length) return `No users found on account ${accountId}.`;
  const rows = items.map((u) => [u.username, u.id, fullName(u), u.email, u.status, (u.permissions || []).join(", ")]);
  const range = startAt ? ` (from #${startAt + 1})` : "";
  const more = limit && items.length >= limit ? `\n\nThis page is full, so more users may exist: call again with startAt=${startAt + items.length}.` : "";
  return `## ${title} on account ${accountId}${range}: ${items.length}\n\n${table(["Username", "User ID", "Name", "Email", "Status", "Permissions"], rows)}${more}`;
}

// --- Character pagination ---

export const DEFAULT_CHUNK = 30000;

export function paginate(text, offset, limit, label) {
  const total = text.length;
  const start = Math.min(offset, total);
  const end = Math.min(start + limit, total);
  const slice = text.slice(start, end);
  const header = `# ${label}\n# chars ${start}-${end} of ${total}\n\n`;
  let footer = "";
  if (end < total) {
    footer = `\n\n[truncated: showing chars ${start}-${end} of ${total}. Call again with offset=${end} for the next chunk.]`;
  } else if (offset > 0 && offset >= total) {
    footer = `[offset ${offset} is past the end of the ${total}-character response. Call again with a smaller offset.]`;
  }
  return `${header}${slice}${footer}`;
}
