// Uses only fictional data and the real local launcher. Existing data is preserved.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { createClient } from "./persistence-client.mjs";
const base = process.env.GENTUM_E2E_URL ?? "http://localhost:5173";
const credentials = {
  email: `persistence-${Date.now()}@example.test`,
  password: "fictional-persistence-password",
};
const call = createClient(base);
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
