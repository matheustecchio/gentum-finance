// Run only against an explicitly disposable local installation.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

if (process.env.GENTUM_VERIFICATION_FIXTURE !== "1") {
  throw new Error("Set GENTUM_VERIFICATION_FIXTURE=1 and use a disposable stack.");
}
const base = process.env.GENTUM_E2E_URL ?? "http://localhost:5173";
function client() {
  const cookies = new Map();
  let databaseId;
  return async (path, body, expectedStatus = 200, selectedId = databaseId) => {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: base,
        Connection: "close",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(selectedId ? { "X-Gentum-Database": selectedId } : {}),
        Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const index = pair.indexOf("=");
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    assert.equal(response.status, expectedStatus, await response.clone().text());
    if (expectedStatus !== 200) return;
    const result = await response.json();
    assert.equal(result.errors, undefined, JSON.stringify(result));
    if (path === "/auth/status") databaseId = result.databaseId;
    return result;
  };
}
const call = client();
const initial = await call("/auth/status");
if (initial.setupRequired) await call("/auth/setup", { mode: "open", source: "new" });
else if (!initial.unlocked) await call("/auth/open", {});
const original = await call("/auth/status");
assert.ok(original.databaseId);
const unique = Date.now();
const name = `Persistence ${unique}`;
const created = await call("/databases/create", { name, mode: "pin", pin: "2468" });
assert.ok(created.recoveryCode);
assert.equal((await call("/auth/status")).databaseId, original.databaseId);
const list = await call("/databases");
const target = list.databases.find((item) => item.name === name);
assert.ok(target);
assert.notEqual(target.id, original.databaseId);
await call("/databases/select", { id: target.id, pin: "0000" }, 401);
assert.equal((await call("/auth/status")).databaseId, original.databaseId);
await call("/databases/select", { id: target.id, pin: "2468" });
assert.equal((await call("/auth/status")).databaseId, target.id);
const account = await call("/graphql", {
  query: 'mutation{createAccount(input:{name:"Database persistence fixture",type:CASH,currency:"EUR",initialBalance:"29"}){id initialBalance}}',
});
const accountId = account.data.createAccount.id;
const renamed = `${name} renamed`;
await call("/databases/rename", { id: target.id, name: renamed });
const other = client();
const otherStatus = await other("/auth/status");
assert.equal(otherStatus.databaseId, original.databaseId);
await call("/graphql", { query: "{accounts{id}}" }, 409, original.databaseId);

execFileSync("./gentum", ["status"], { stdio: "inherit" });
execFileSync("./gentum", ["stop"], { stdio: "inherit" });
execFileSync("./gentum", ["start"], { stdio: "inherit" });

const restored = await call("/auth/status");
assert.equal(restored.databaseId, target.id);
assert.equal(restored.databaseName, renamed);
assert.equal(restored.pinEnabled, true);
if (!restored.unlocked) await call("/auth/unlock", { pin: "2468" });
const result = await call("/graphql", { query: "{accounts{id initialBalance}}" });
assert.deepEqual(result.data.accounts.find((item) => item.id === accountId), {
  id: accountId,
  initialBalance: "29",
});
await call("/databases/select", { id: original.databaseId });
await call("/auth/status");
const previous = await call("/graphql", { query: "{accounts{id}}" });
assert.equal(previous.data.accounts.some((item) => item.id === accountId), false);
console.log("Databases persistence PASS: physical database selection, names, protection, and isolated exact cents survive a launcher restart.");
