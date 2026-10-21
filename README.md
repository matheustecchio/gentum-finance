# Gentum Finance

A personal-finance app that runs on your computer. Track accounts, transactions and monthly spending without an online account.

## Features

- Accounts and categories for income and expenses.
- Transfers, monthly budgets and recurring transactions.
- Wealth, cash-flow and category spending reports, with balances and changes by account.
- CSV import and export.
- A local wallet with optional PIN protection.

## Start locally

Install Docker Engine with Docker Compose v2, then run:

```bash
./gentum start
```

Open [http://localhost:5173](http://localhost:5173) and choose whether to protect your wallet with a PIN. Save the recovery code if you enable protection.

This is an early MVP for trusted local use. Use fictional data while evaluating it. The PIN does not encrypt the database.

## Documentation

- [Development and local operation](docs/development.md)
- [Architecture](docs/architecture.md)
- [API and CSV contract](docs/api/finance.md)
- [Contributing](CONTRIBUTING.md)
- [Git workflow](docs/workflow.md)
