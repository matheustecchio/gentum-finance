# ADR 0011: Recurring spending limits

Date: 2026-10-24
Status: Accepted

## Context

Monthly category limits required manual recreation and could not target selected accounts. Users need spending limits with automatic renewal, visible remaining amounts, matching transactions and clear lifecycle controls. Wallet and Spendee document this tracking model; it does not require allocating account balances to envelopes.

## Decision

Store named budget plans with weekly, monthly, yearly or one-time periods. Empty category/account selections mean all expense categories/accounts in the selected currency. Selected parent categories include children; a transaction counts once even when parent and child are both selected. Accounts never mix currencies. Only posted expenses count, including imports and confirmed recurring entries. Transfers, income and pending occurrences do not count.

Periods use UTC dates and inclusive boundaries. Weekly periods last seven days. Monthly/yearly periods retain the original day anchor, clamping short months and leap years. The selected month shows every intersecting period; each card shows its entire period. Renewal is calculated on read, without generating transactions or monthly database records.

Changes apply from this or the next period. A later edit creates a revision and ends the earlier version immediately before it. Earlier periods retain their settings. Editing an older version with a later revision is rejected. The original frequency and date remain fixed; a different recurrence requires a new plan. Stop ends renewal at a period boundary and cancels later revisions. Delete removes the entire plan configuration and its revisions, preserving ledger entries.

Show independent limits, overlap warnings, exact spent/remaining/exceeded values, dates and in-app indicators at 75%, 90% and 100%. These are persistent indicators in the Budgets view, not OS notifications. Details resolve matching entry IDs against paginated transaction history. Overlapping limits are never added into a combined total.

Migration V14 converts each existing monthly budget into an equivalent one-time plan, preserving its ID, currency, category, month and amount. The old budget command remains compatible. No rollover, currency conversion, scheduled-spending forecast or background notification service is added.

## Consequences

Budget configuration does not affect balances. Spending is recalculated from ledger entries, so corrections and imports update the result. Per-owner write locking serializes revisions and lifecycle changes. Snapshots use repeatable-read isolation. Money remains integer cents, with numeric database sums and checked int64 output.

## Sources

- [Wallet setup budgets](https://support.budgetbakers.com/hc/en-us/articles/7076953735314-Setup-Budgets)
- [Wallet budget features](https://budgetbakers.com/en/products/wallet/features/budgets/)
- [Spendee budgets](https://help.spendee.com/article/131-budget-my-money)
- [Actual tracking budget](https://actualbudget.org/docs/getting-started/tracking-budget/)
