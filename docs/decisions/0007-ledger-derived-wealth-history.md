# 0007: Reconstruct wealth from the recorded ledger

Status: Accepted

A single wealth observation leaves the requested chart empty even when the ledger
already contains months of dated transactions. The user authorized reconstructing
that existing history. No spreadsheet import or bank data retrieval is involved.

Opening balance is the base before recorded transactions, matching the existing
balance formula. For a nonzero opening, the earliest supported date is the earlier
of the first dated entry and account creation (UTC). Earlier transaction dates
can precede app creation because the ledger supports backdated recording/import.
The complete wealth series begins only when all nonzero openings are covered.
A missing account's balance is never treated as zero to fabricate a partial total.
Zero-opening accounts contribute their cumulative dated entries. Without any dated
activity, return today's balance alone instead of inventing a flat historical curve.

Reconstruct each day as opening balances plus income/transfer-in minus expenses/
transfer-out through that date. Include archived accounts. Same-currency linked
transfers cancel. Exclude future-dated entries and schedules not yet posted.
The account list keeps its existing all-recorded-entry formula; future entries may
therefore make it differ from today's wealth. Backdated entries restate history.

Use the same latest reference rates for all days, preserving the accepted currency
valuation rule and labeling conversion as estimated. The signed 30-day difference
therefore excludes market FX movements. Unsupported history has no signed delta.
This is recorded-ledger history, not a claim of reconciled bank statement balances.

The endpoint is read-only and does not create synthetic observations. Preserve the
old observation table/data without mixing its all-entry snapshots into this series.
No schema migration or change to recorded financial data is required.
