# ADR 0010: Separate recurring plans from recorded transactions

- Status: Accepted
- Date: 2026-10-24
- Supersedes: The explicit recurring execution workflow in ADR 0004

## Context

A global Run due command makes users operate a batch job. A due date also does not prove a payment happened. Imported statements can contain the same charges as generated entries.

## Decision

Store each processed schedule/date as an owned occurrence with a frozen account, category, kind, amount and description. Pending and skipped occurrences do not change ledger balances. Confirmation posts an entry; linking uses an existing entry. Automatic schedules post due occurrences without confirmation. Support weekly, fortnightly, monthly and yearly schedules, with original month-end and leap-day anchors.

The authenticated wallet requests processing on open, every visible minute and on focus/visibility return. A closed app catches up on its next open; no daemon or hosted scheduler is introduced. Process at most 1,000 occurrences per transaction and continue on later runs. Preserve the owner write lock, unique schedule/date records, exact cents and all-or-nothing range checks.

Editing a series changes unprocessed dates. Pending occurrences can be adjusted, confirmed, skipped or linked independently. Stop/resume preserves recorded and pending occurrences. Resume catches up from the saved next date. Existing schedules migrate to confirmation mode, and existing generated entries become posted occurrences without changing money.

Both CSV import paths associate a unique occurrence when account, category, kind, exact amount and nonempty trimmed case-insensitive description match within three days. A posted occurrence reuses its generated entry and adopts the imported date/details. A pending occurrence receives one new linked entry. Each occurrence can match at most once per file. Ambiguous matches reject the atomic import with an actionable message. Processing also looks for existing unlinked transactions before creating an automatic entry; ambiguous transactions leave a pending item for review.

Manual linking supports variable amounts or descriptions. It requires the same owned account and kind, retains the actual entry's details and replaces any generated entry atomically. It does not infer that similar unmatched records are duplicates.

## Consequences

Upcoming projections and pending items are separate from actual spending. UTC remains the financial scheduling day. Automatic does not mean a bank payment was executed. Preview and import use the same matching rules; insufficient matches require manual review. Matching is intentionally conservative, not general CSV deduplication. No notifications outside the running app, bank synchronization or background OS service are added.

## Product references

- [Wallet planned payments](https://support.budgetbakers.com/hc/en-us/articles/7149523920786-Setup-Planned-Payments)
- [Actual schedules](https://actualbudget.org/docs/schedules/)
- [YNAB scheduled transactions](https://support.ynab.com/scheduled-transactions-a-guide-BygrAIFA9)
- [Lunch Money recurring setup](https://support.lunchmoney.app/getting-started)

These references informed the interaction choices; this ADR defines Gentum's own contract.
