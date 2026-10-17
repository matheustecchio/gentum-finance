// Uses only fictional data and the real local launcher. Existing data is preserved.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { createClient } from "./persistence-client.mjs";
const base = process.env.GENTUM_E2E_URL ?? "http://localhost:5173";
if (process.env.GENTUM_VERIFICATION_FIXTURE !== "1") {
  throw new Error(
    "Use a disposable stack with GENTUM_VERIFICATION_FIXTURE=1; this check creates fictional ledger data.",
  );
}
const call = createClient(base);
const status = await fetch(base + "/auth/status").then((response) =>
  response.json(),
);
if (status.setupRequired) await call("/auth/setup", { mode: "open" });
else await call("/auth/open", {});
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
await call("/auth/open", {});
const result = await call("/graphql", {
  query: "{accounts{id initialBalance}}",
});
assert.deepEqual(
  result.data.accounts.find((account) => account.id === id),
  { id, initialBalance: "29" },
);
console.log(
  "Persistence PASS: launcher status/stop/start preserves local access and exact account cents.",
);
