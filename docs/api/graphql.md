
## Overview

`overview(month: String!): FinanceData` accepts a month from 1900-01 through
9998-12. It returns `currency`, `today` (UTC), `wealth` (date/amount integer-cent
daily ledger balances), `flows` (six months ending in the requested month, with native
currency income/expense/signed net), `converted`, `rateDate`, `rateError`, `change30` (empty when unavailable), and `changeError`
(an explanation when the signed difference exceeds the supported range).
Missing flow months have zero activity. Missing wealth days are unknown.

`executeFinance(action: "primaryCurrency", input: {currency: "EUR"})` saves the
current profile's primary currency. EUR, GBP, USD and BRL are supported.

Overview is read-only. It reconstructs end-of-day balances for the last 30 days
plus the comparison endpoint, using opening balances and all owned dated entries
through each UTC date. `historyNote` explains provenance. Opening balances are the
base before the first recorded transaction, as in the existing ledger calculation.
For nonzero openings, coverage begins at the earlier of the first dated transaction
or the account creation date (UTC). Before the latest such start across all accounts,
the complete total is unavailable; accounts are never silently omitted. With no dated
activity, only today's balance is returned, rather than a fabricated flat curve.
Archived accounts are included. Linked same-currency transfers cancel across accounts.
Future-dated entries and unposted recurring schedules are excluded. The account list
retains its existing all-recorded-entry balance contract and may include future entries.
The old wealth-observation table is preserved but not rewritten or mixed into the new
ledger-derived series. Backdated entries restate the series when requested.
Both endpoints use the same latest reference rates, excluding exchange-rate movements.
A 30-day delta is available only when the complete baseline is supported.

Converted totals use ECB reference rates from Frankfurter's public HTTPS API,
cached in memory for one hour, accepted only when all supported quotes share a
date within the last seven days. Weekends and publication delays are visible in
the rate date. On failure or stale/missing rates, no partial wealth total is shown.
Only currency codes leave the local backend. No account data is sent. This service
is needed only for conversion; native-currency wealth remains available offline.
Conversion uses rational arithmetic and rounds the combined total once to cents,
ties away from zero. Values outside signed int64 cents are unavailable.

The cash-flow UI retains loaded six-month ranges in a continuous horizontal
timeline. Prepending earlier months preserves the viewport anchor; loading failures
keep existing months visible and offer retry. Cash Flow requests and visible month
groups stop at the current calendar month in Europe/Dublin, including when a future
reporting month is selected. The boundary refreshes while the app is open and on
returning to the tab. Each bar has an amount-only tooltip above it, matching the
Income, Expenses or Net flow legend color. Pointer, touch and keyboard focus can
inspect positive, negative and zero values. The wealth card uses a compact
empty/single-observation state, with a low fixed-height chart only when multiple
supported daily balances exist. No curve is generated from a lone balance.

Wealth inspection is client-side and uses the exact supplied daily values.
Horizontal position selects the nearest calendar day across the full plot height;
missing days remain unavailable. Pointer, touch and keyboard share the same
selection. The old History details disclosure is replaced by this interaction;
ledger methodology remains documented here and in the chart accessibility text.
