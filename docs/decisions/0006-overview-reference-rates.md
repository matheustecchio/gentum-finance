# 0006: Estimate wealth with dated reference rates

Status: Accepted; observation strategy superseded by [0007](0007-ledger-derived-wealth-history.md)

Overview needs one wealth total in the profile's primary currency. Account
balances and cash-flow reports retain their native currency. Supported currencies
are EUR, GBP, USD and BRL, all covered by ECB reference rates.

The local backend fetches ECB rates through Frankfurter's public HTTPS endpoint.
Only currency codes leave the machine. The optional request has a five-second
timeout, bounded response and one-hour in-memory refresh interval. Validated quote sets are persisted in each local ledger database and survive restarts. All quotes must have the
same publication date within seven days. If refresh fails, the last saved set is reused only while it still passes all currency, completeness, date and seven-day validity checks. The card marks cached fallback and shows its reference date. Missing, invalid, future-dated or expired sets hide converted wealth. There are no embedded rates.
The card names the source and publication date and labels conversion an estimate.

Conversion uses rational arithmetic, sums before rounding and rounds to integer
cents once, ties away from zero. Backend overflow checks also apply to chart totals.
The 30-day change uses the same latest rates for both observations. It measures
changes in recorded native balances, excluding exchange-rate movements.

Opening balances do not have effective dates, so they cannot establish historical
wealth. Store owner-scoped daily observations from this release onward, refreshing
today's observation when Overview is requested. Store native totals so changes to
the primary currency revalue the entire chart consistently. Missing observations
remain gaps. A 30-day change requires an observation on that exact UTC date.
No background process or invented pre-release history is introduced.

The dependency is optional: same-currency wealth and local ledger operations work
without internet. The local-first delivery model and loopback services remain as
specified in [0002](0002-local-first-web-application.md).
