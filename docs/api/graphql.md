
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
refreshed after one hour and saved in the local ledger database. All supported quotes must share a date within the last seven days. Weekends and publication delays are visible in the rate date. If refresh fails, the last saved set is used only while it still passes these checks; `rateCached` marks fallback. Missing, invalid, future-dated or expired sets leave converted wealth unavailable.
Only currency codes leave the local backend. No account data is sent. This service
is needed only for conversion; native-currency wealth remains available offline.
Conversion uses rational arithmetic and rounds the combined total once to cents,
ties away from zero. Values outside signed int64 cents are unavailable.

## Grouped cash flow and selected category spending

The Overview uses `flowHistory(grouping: String!, weekEnd: Int = 0, before: String,
start: String, end: String): FinanceData`. Groupings are `week`, `month`, `quarter`,
`fourMonths`, `halfYear`, `year`, `fiveYears`, `all`, and `custom`.

The response contains `buckets` with inclusive `start`/`end` date strings, `flows`
with `month` (the bucket start), native `currency`, `income`, `expense`, `net`
integer-cent strings, and `hasEarlier`. Missing flow rows render as zero values.
Preset pages have at most eight buckets, stop today in Europe/Dublin and load older
pages using the first bucket's start as exclusive `before`. Month and larger
buckets align to the calendar; quarters start January/April/July/October,
four-month blocks January/May/September, half-years January/July, and five-year
blocks in years divisible by five (for example 2025–2029). `weekEnd` follows
Sunday=0 through Saturday=6. Current groups are clipped through today.

`all` returns one bucket from the earliest owned income/expense through today,
without a five-year limit. Custom requires inclusive, ordered dates from 1900-01-01
through today and uses daily groups for at most 63 dates, otherwise clipped months.
Empty histories still expose a current zero-activity group, not fictional amounts.
Transfers, opening balances, unposted schedules and foreign owners are excluded.
All SQL aggregates remain numeric until checked against signed int64 cents.

`categorySpending(start: String!, end: String!): FinanceData` returns `breakdown`
(categoryId/currency/direct integer-cent strings) for exactly the selected group.
It supports the same date bounds without a five-year cap, allowing All to show
complete spending. Each category's direct expenses are included once. Currencies
are separate. This query never loads transaction history.

Overview starts with the current configured week selected. Clicking any part of a
period group selects its dates and fades all other groups. Dragging, native touch,
trackpad and keyboard scroll loaded history; prepending preserves the viewport
anchor and scrolling does not change selection. Group changes select the current
bucket. Filters sit inside the Cash flow title row, aligned right with Custom last.
The UI omits four-month grouping, calls half-years Semester (S1/S2), and labels
quarters K1-K4. Custom opens a centered modal with a dimmed backdrop; Apply
commits the dates, while Cancel or Escape leaves the prior selection unchanged.
Focus returns to Custom after dismissal. The gear before Custom chooses the week-ending
day for the current Overview visit. Custom keeps its explicit dates until a bucket
is selected. Errors retain usable history; stale category responses are ignored.
The old Previous/Next date strip is removed. Month names and interval labels stay
readable because SVG width grows with the loaded groups instead of shrinking bars.

Categories is a descending horizontal ranking, separately per currency, with
persisted category colors. Exact amounts stay visible inside wide bars or outside
short bars. Total Wealth has independent grouped history controls, described below.
The original `overview(month:)` and bounded `analytics(start:, end:)` contracts
remain available for existing consumers. The backend bundles IANA timezone rules
so reporting dates also work in the minimal runtime container.

Wealth inspection is client-side and uses the exact supplied daily values.
Horizontal position selects the nearest calendar day across the full plot height;
missing days remain unavailable. Pointer, touch and keyboard share the same
selection. The old History details disclosure is replaced by this interaction;
ledger methodology remains documented here and in the chart accessibility text.

Overview also returns `accounts`, ordered by name, with `id`, `name`, `currency`,
`amount` (today's balance), and `change30` (the difference from 30 days earlier).
Amounts use integer-cent strings in each account's original currency. Changes
include dated transfers and exclude future entries, using the same balance
reconstruction as total wealth. An empty change means insufficient history or
an unsupported difference. Account balances remain available when exchange rates
are unavailable. The Overview displays Total Wealth after cash flow and categories,
with the account breakdown always visible below the combined total and chart.

### Exchange-rate fallback

Overview adds `rateCached` to its finance response. It is true when refresh fails and a previously validated local ECB quote set remains complete and at most seven days old. `rateDate` identifies that set. Missing, invalid, future-dated or expired sets leave converted wealth unavailable. Reference quotes persist locally across backend restarts; both wealth comparison dates use the same set and existing exact rounding rules. No ledger data is sent to the provider.

## Grouped Total Wealth history

`wealthHistory(grouping: String!, weekEnd: Int = 0, before: String, start: String,
end: String): FinanceData` returns `buckets` (inclusive start/end), `wealth`
(date/amount), `hasEarlier`, `currency`, `today` (Europe/Dublin), `historyNote`,
and the Overview conversion/rate fields. Supported groupings are week, month,
quarter, halfYear (Semester), year, fiveYears, all and custom. Presets return up to
eight calendar groups ending today. Each value is the balance at that group's
inclusive end, not the sum of daily balances. Older/Latest history buttons change
the displayed page; `before` is exclusive and does not affect the current total.

All starts at the earliest owned account creation or dated entry, without a
five-year cap. All/Custom sample daily through 63 dates, then at clipped month
ends. Custom validates real, ordered dates from 1900-01-01 through today.
Unsupported endpoints remain gaps; the chart does not carry values backward or
omit accounts to fabricate an earlier combined balance. No dated activity means
only today's endpoint can be returned. The opening-date coverage rules and exact
rational conversion from Overview apply to every sampled endpoint. Reads are
scoped to the authenticated owner in a repeatable-read transaction. Future entries
and unposted schedules are excluded; owned linked transfers are included in
balances and cancel when aggregated across accounts of the same currency.

Total Wealth defaults to Week. Its controls and centered Custom modal match Cash
flow, including Semester S1/S2 and quarter K1-K4 labels. Selections, week settings,
loading, retries and late-response handling are independent of Cash flow and
Categories. The total and account balances remain current, with their existing
30-day changes explicitly labeled; selecting chart history does not restate those
figures. The original `overview(month:)` contract remains compatible.
