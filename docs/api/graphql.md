
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

`flowHistory(grouping: String!, weekEnd: Int = 0, before: String,
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

The legacy grouped endpoints remain available for existing consumers, including
four-month grouping. New Overview screens use the calendar endpoints below.
The original `overview(month:)` and bounded `analytics(start:, end:)` contracts
also remain available. Reporting uses the bundled Europe/Dublin timezone rules.

## Calendar Analytics

`cashFlowPage(period: String!, weekStart: Int = 1, anchor: String, start: String,
end: String, selected: String, categoryId: String, offset: Int = 0): FinanceData` returns one
calendar page. Periods are `week`, `month`, `quarter`, `halfYear`, `year`,
`fiveYears`, `all`, and `custom`. `anchor` defaults to today in Europe/Dublin
and must be a real date from 1900-01-01 through today. Weeks start Monday (1)
or Sunday (0). Custom uses ordered inclusive dates through today. All starts
at the earliest owned income or expense, without a five-year cap.

The response includes `start`, `end`, `today`, `grouping`, `previous`, `next`,
`buckets`, `flows`, `totals`, `incoming`, `outgoing`, `selectedStart`,
`selectedEnd`, `entries`, `trendBuckets`, `trendFlows`, `comparisonBuckets`,
`comparisonFlows`, and `comparisonTotals`. Empty series are arrays. Previous
and next are anchors, empty at the 1900 or current-period boundary. All and
Custom have no adjacent-page navigation. Preset pages include empty future
slots, but financial queries exclude future transactions.

A week contains seven daily bars, a month one monthly bar, a quarter three
monthly bars, a semester six, a year twelve, and five years five annual bars.
All/Custom use days through 63 dates, months through approximately five years,
then years. Trend series provide daily observations through 63 dates, monthly
observations through approximately five years, then annual observations. Each flow contains its bucket start as
`month`, native currency, income and expense integer-cent strings. Trend rows
also contain backend-computed `cumulativeIncome` and `cumulativeExpense`.

Each total has currency, income, expense, signed net, `incomeAverage` and
`expenseAverage` per visible bar (nearest cent, half up). When a previous page
is available, `incomeChange` and `expenseChange` compare the selected range
with the corresponding previous range. An unrepresentable difference is
omitted. If the previous series exceeds signed int64 cents,
`comparisonUnavailable` is true and comparison arrays are empty; supported
current-period values remain available. Comparison trend observations cover the preceding complete period.

Incoming/outgoing category rows contain categoryId, path name, saved color,
currency, kind, amount, count and percentage. Categories sort by amount,
descending within each currency. Percentages round to whole numbers, with
positive shares below one percent shown as `<1%`. Each direct category amount
is counted once. `selected` must match an available visible bucket start;
selecting one changes totals, category lists and entries, while the complete
bar chart remains available. `categoryId` filters the chart and selected range
to that exact owned category. Entries are returned only for a category detail,
in descending date order, with id/date/description/amount/kind/currency/account.
Category entries use 50-row pages. Pass `nextOffset` back as `offset` to read
older entries; zero means the final page. Offset must be nonnegative and a
multiple of 50. Totals and counts always cover the full selected range.

The read uses a repeatable-read, read-only transaction and server-derived
ownership. SQL sums remain numeric until checked against signed int64 cents.
Currencies stay separate. Linked internal transfers, opening balances,
unposted schedules and other owners never become income or expense.

Overview opens a dark summary dashboard for the current month. Its cards open
Spent, Income, Net cash flow and Total Wealth. Spent and Income offer line,
bar and category charts; category rows open dated transactions. Money In and
Money Out show amounts, counts and shares, with See all for longer rankings.
The primary selector is 1W/1M/6M/1Y with a sliding indicator. Three dots open
Quarter, five years, All, Custom and Monday/Sunday week settings. The week
preference is saved locally when browser storage is available. Custom opens
a centered modal with a dimmed backdrop; Cancel/Escape preserves the prior
range and focus returns to the three-dot button. Reduced-motion settings
disable animation. Failed requests offer retry, and stale responses are ignored.

`wealthCalendar(period: String!, weekStart: Int = 1, anchor: String,
start: String, end: String): FinanceData` shares these calendar-page controls.
It returns the existing wealth history/conversion contract plus start/end and
previous/next anchors. Observations sample days through 63 dates, then month
ends, clipping the current observation range through today. Current wealth
and the account list retain their existing balance and 30-day-change contracts.
Unknown historical balances remain unavailable. The local rate cache and
conversion rules above apply without changes. The dashboard and wealth detail
always label a converted current total as estimated with its own rate date and
cache status, independently of the selected history range.

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
are unavailable. The Analytics dashboard opens Total Wealth from its asset summary,
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

The legacy wealth-history component defaults to Week. The Analytics screen
uses `wealthCalendar` and defaults to Month. Its loading, retries and
late-response handling remain independent of the other Analytics details. The total and account balances remain current, with their existing
30-day changes explicitly labeled; selecting chart history does not restate those
figures. The original `overview(month:)` contract remains compatible.
