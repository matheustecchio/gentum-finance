
## Overview

`overview(month: String!): FinanceData` accepts a month from 1900-01 through
9998-12. It returns `currency`, `today` (UTC), `wealth` (date/amount integer-cent
observations), `flows` (six months ending in the requested month, with native
currency income/expense/signed net), `converted`, `rateDate`, `rateError`, `change30` (empty when unavailable), and `changeError`
(an explanation when the signed difference exceeds the supported range).
Missing flow months have zero activity. Missing wealth days are unknown.

`executeFinance(action: "primaryCurrency", input: {currency: "EUR"})` saves the
current profile's primary currency. EUR, GBP, USD and BRL are supported.

Opening Overview records or refreshes today's native-currency observation under
the authenticated owner. No pre-release wealth history is inferred. Daily totals
include all account balances, including archived accounts and recorded future
entries, matching the account balance contract. A missing observation 30 days ago
means the 30-day delta is unavailable. Missing days stay disconnected in the chart.
Both endpoints are revalued at the same latest rates, so the delta measures changes
in recorded balances and excludes currency-market movements.

Converted totals use ECB reference rates from Frankfurter's public HTTPS API,
cached in memory for one hour, accepted only when all supported quotes share a
date within the last seven days. Weekends and publication delays are visible in
the rate date. On failure or stale/missing rates, no partial wealth total is shown.
Only currency codes leave the local backend. No account data is sent. This service
is needed only for conversion; native-currency wealth remains available offline.
Conversion uses rational arithmetic and rounds the combined total once to cents,
ties away from zero. Values outside signed int64 cents are unavailable.
