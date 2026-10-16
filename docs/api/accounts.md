# Account GraphQL API

Use the signed-in browser session at `POST http://localhost:5173/graphql`, with `Content-Type: application/json` and the matching Origin. The backend port is internal in Docker.

## Create an account

```graphql
mutation CreateAccount {
  createAccount(input: {
    name: "Everyday account"
    type: CURRENT
    currency: "EUR"
    initialBalance: "42550"
  }) {
    id name type currency initialBalance archived createdAt updatedAt
  }
}
```

`initialBalance` uses the custom `Cents!` scalar: a canonical signed integer string in the range -9223372036854775808 through 9223372036854775807. `"42550"` means EUR 425.50. Fractions, exponent notation, leading zeros, negative zero, JSON numeric values, and out-of-range integers are rejected. This differs from the former decimal-major-unit contract; update both client and server together. The UI converts decimal text to cents exactly using `BigInt`.

Names are trimmed and must contain 1–100 Unicode characters. Supported currencies are EUR, GBP, USD, and BRL. Supported account types are CURRENT, SAVINGS, CASH, and CREDIT_CARD. The backend assigns UUIDs, UTC timestamps, ownership, and the initial unarchived state. Ownership cannot be supplied by the client.

## List accounts

```graphql
query Accounts {
  accounts { id name type currency initialBalance archived }
}
```

Results are scoped to the current server-side user, ordered by creation time then UUID. An empty result is an empty array.

## Authentication

All account operations require the verified local cookie session. Ownership comes from the server context; no client-supplied owner is accepted. See the [finance/authentication contract](finance.md).
