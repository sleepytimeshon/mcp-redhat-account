#!/usr/bin/env node
// Offline tests of src/lib.js: validation, account defaulting, the API client and its error
// handling, and the Markdown formatters, with a stubbed fetch and synthetic data. Never put
// real user data (names, emails, phone numbers, addresses) in these fixtures.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as lib from "../src/lib.js";

const realFetch = globalThis.fetch;
const realToken = process.env.REDHAT_TOKEN;

beforeEach(() => {
  process.env.REDHAT_TOKEN = "offline";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realToken === undefined) delete process.env.REDHAT_TOKEN;
  else process.env.REDHAT_TOKEN = realToken;
  lib.clearTokenCache();
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubFetch(handler) {
  const calls = [];
  let issued = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u === lib.TOKEN_URL) {
      issued += 1;
      return json({ access_token: `access-${issued}`, expires_in: 900 });
    }
    return handler(u, init);
  };
  return calls;
}

describe("validation", () => {
  it("accepts numeric IDs, logins, and emails, and rejects path tricks", () => {
    assert.equal(lib.normalizeAccountId(" 5551234 "), "5551234");
    assert.throws(() => lib.normalizeAccountId("12a"), /Invalid account ID/);
    assert.equal(lib.normalizeUserId("12345678"), "12345678");
    assert.throws(() => lib.normalizeUserId("../1"), /Invalid user ID/);
    assert.equal(lib.normalizeLogin("pat-example"), "pat-example");
    assert.throws(() => lib.normalizeLogin("a/b"), /Invalid username/);
    assert.equal(lib.normalizeEmail("pat@example.com"), "pat@example.com");
    assert.throws(() => lib.normalizeEmail("pat@example"), /Invalid email address/);
  });
});

describe("account defaulting", () => {
  it("uses the token user's only account, and requires a choice when there are several", async () => {
    let accounts = [{ id: 5551234, name: "Example Corp", type: "Organization" }];
    const calls = stubFetch((url) => (url.includes("/accounts") ? json({ body: accounts }) : json({})));
    assert.equal(await lib.resolveAccountId(undefined), "5551234");
    assert.equal(await lib.resolveAccountId(""), "5551234");
    assert.equal(calls.filter((c) => c.url.includes("/accounts")).length, 1, "accounts are cached");
    assert.equal(await lib.resolveAccountId("777"), "777");

    lib.clearTokenCache();
    accounts = [{ id: 1 }, { id: 2 }];
    await assert.rejects(lib.resolveAccountId(undefined), /belongs to 2 accounts \(1, 2\); pass accountId/);
  });

  it("explains an empty listing for an account the user does not belong to", async () => {
    stubFetch(() => json({ body: [{ id: 5551234 }] }));
    assert.match(await lib.emptyResultNote("1"), /You do not belong to account 1; the API returns an empty list instead of an error\. Your accounts: 5551234\./);
    assert.equal(await lib.emptyResultNote("5551234"), "");
  });
});

describe("apiRequest", () => {
  it("sends the token and query, and retries once on 401", async () => {
    let first = true;
    const calls = stubFetch(() => {
      if (first) { first = false; return json({ title: "Unauthorized", status: 401 }, 401); }
      return json({ body: { status: "enabled" } });
    });
    assert.deepEqual(await lib.apiRequest("/accounts/1/users/2/status", { query: { a: "b", empty: undefined } }), { body: { status: "enabled" } });
    assert.equal(calls.at(-1).url, `${lib.API_BASE}/accounts/1/users/2/status?a=b`);
    assert.equal(calls.at(-1).init.headers.Authorization, "Bearer access-2");
  });

  it("turns problem documents into one line and explains 403s", async () => {
    stubFetch(() => json({ type: "https://user.api.redhat.com/problems/read-of-user-data-forbidden", title: "Forbidden", status: 403, detail: "Read of user data is forbidden" }, 403));
    await assert.rejects(lib.apiRequest("/accounts/1/users"), (err) =>
      err instanceof lib.ApiError && err.status === 403 && err.problemType.endsWith("read-of-user-data-forbidden")
      && err.message.startsWith("Red Hat Account API error 403: Forbidden: Read of user data is forbidden. Only organization administrators"));

    stubFetch(() => json({ title: "Not Found", status: 404, detail: "User 1 does not exist", properties: { userId: "1" } }, 404));
    await assert.rejects(lib.apiRequest("/accounts/1/users/1"), /error 404: Not Found: User 1 does not exist \(userId: 1\)\.$/);
  });

  it("returns null for an empty 204 body", async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    assert.equal(await lib.apiRequest("/accounts/1/users", { method: "POST", body: {} }), null);
  });

  it("needs REDHAT_TOKEN", async () => {
    delete process.env.REDHAT_TOKEN;
    await assert.rejects(lib.apiRequest("/user"), /REDHAT_TOKEN environment variable is required/);
  });
});

describe("formatters", () => {
  const user = { id: "12345678", username: "pexample", salutation: "Ms.", firstName: "Pat", lastName: "Example", email: "pat@example.com", phone: "", status: "enabled", roles: ["organization_administrator"], permissions: ["portal_download", "portal_manage_cases"], address: { streets: ["1 Main St"], city: "Raleigh", state: "NC", country: "US", zipCode: "27601" } };

  it("formats a user with only the fields it has", () => {
    assert.equal(lib.formatUser(user), [
      "# User: pexample",
      "**User ID:** 12345678",
      "**Username:** pexample",
      "**Name:** Ms. Pat Example",
      "**Email:** pat@example.com",
      "**Status:** enabled",
      "**Roles:** organization_administrator",
      "**Permissions:** portal_download, portal_manage_cases",
      "**Address:** 1 Main St, Raleigh, NC, 27601, US",
    ].join("\n"));
  });

  it("formats user listings with a next-page hint", () => {
    const list = [{ user: { ...user, permissions: undefined }, permissions: ["portal_download"] }];
    const out = lib.formatUserList(list, { accountId: "1", startAt: 0, limit: 1 });
    assert.match(out, /^## Users on account 1: 1\n\n\| Username \| User ID \| Name \| Email \| Status \| Permissions \|/);
    assert.match(out, /\| pexample \| 12345678 \| Ms\. Pat Example \| pat@example\.com \| enabled \| portal_download \|/);
    assert.match(out, /more users may exist: call again with startAt=1/);
    assert.equal(lib.formatUserList([], { accountId: "1" }), "No users found on account 1.");
  });

  it("formats accounts and paginates by characters", () => {
    assert.match(lib.formatAccounts([{ id: 1, name: "Example | Corp", type: "Organization" }]), /\| 1 \| Example \\\| Corp \| Organization \|/);
    assert.match(lib.paginate("abcdef", 0, 4, "t"), /\[truncated: showing chars 0-4 of 6\. Call again with offset=4/);
  });
});
