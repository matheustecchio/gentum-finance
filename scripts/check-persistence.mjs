// Uses only fictional data and the real local launcher. Existing data is preserved.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const base = process.env.GENTUM_E2E_URL ?? "http://localhost:5173";
const credentials = {
  email: `persistence-${Date.now()}@example.test`,
  password: "fictional-persistence-password",
};
let cookie;
async function call(path, body) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, await response.clone().text());
  if (response.headers.get("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  const result = await response.json();
  assert.equal(result.errors, undefined, JSON.stringify(result));
  return result;
}
await call("/auth/register", credentials);
const account = await call("/graphql", {
  query:
    'mutation{createAccount(input:{name:"Persistence fixture",type:CASH,currency:EUR,initialBalance:"29"}){id initialBalance}}'.replace(
      "currency:EUR",
      'currency:"EUR"',
    ),
});
const id = account.data.createAccount.id;
execFileSync("./gentum", ["status"], { stdio: "inherit" });
execFileSync("./gentum", ["stop"], { stdio: "inherit" });
execFileSync("./gentum", ["start"], { stdio: "inherit" });
await call("/auth/login", credentials);
const result = await call("/graphql", {
  query: "{accounts{id initialBalance}}",
});
assert.deepEqual(result.data.accounts, [{ id, initialBalance: "29" }]);
await call("/auth/logout", {});
console.log(
  "Persistence PASS: launcher status/stop/start preserves profile and exact account cents.",
);
