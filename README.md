# Gentum Finance

A personal-finance app that runs on your computer. Track accounts, transactions and spending without an online account.

## Features

- Accounts and categories for income and expenses.
- Correct amounts, dates, descriptions and categories of non-recurring income and expenses in transaction history.
- Transfers, monthly budgets and recurring transactions.
- Revolut-style financial Analytics: summary cards open Spent, Income, Net cash flow and Total Wealth. Browse whole calendar periods by drag, swipe, keyboard or buttons. Weeks show seven days, semesters and years show months, and charts support exact-value inspection, category totals and dated transaction drill-down. The animated 1W/1M/6M/1Y selector keeps extra periods and the centered Custom modal in its three-dot menu.
- Select a period to see ranked category spending in its saved colors.
- Validated exchange rates saved locally for offline wealth estimates for up to seven days.
- Wealth, cash-flow and category spending reports, with balances and changes by account.
- CSV import previews with record errors and explicit confirmation, plus export.
- Separate local PostgreSQL databases with independent optional PIN protection.
- Create, rename and switch databases from Settings at the same local address.

## Start locally

Install Docker Engine with Docker Compose v2, then run:

```bash
./gentum start
```

Open [http://localhost:5173](http://localhost:5173) and choose whether to protect your wallet with a PIN. Save the recovery code if you enable protection. Settings lets you create independent databases and switch between them. Each has its own records, currency and optional PIN.

This is an early MVP for trusted local use. Use fictional data while evaluating it. The PIN does not encrypt the database.

## Documentation

- [Development and local operation](docs/development.md)
- [Architecture](docs/architecture.md)
- [Interface design](docs/design.md)
- [API and CSV contract](docs/api/finance.md)
- [Contributing](CONTRIBUTING.md)
- [Git workflow](docs/workflow.md)
