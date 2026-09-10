# Flexible Finance Tracker

A local-first finance dashboard that imports Excel, CSV, or TSV bank statements, masks sensitive account references before import, and keeps the active console session available until the tab/window is closed.

## Current dashboard

- Flexible paycheck allocations: add, remove, rename, and rebalance any number of allocation categories.
- Allocation categories can be marked **Spendable** so multiple categories can combine into the tracked spending allowance.
- Built-in starter presets: Balanced 50 / 30 / 20, Pay Yourself First 80 / 20, Savings Focus 60 / 20 / 20, and Classic 50 / 25 / 25.
- Three compact statement metadata cards: imported period, available balance, and statement date.
- KPI cards for allowance remaining, payroll received, actual spending, and reserve transfers.
- Monthly allowance-vs-spending chart.
- Dynamic paycheck planner whose columns follow the user's allocation categories.
- Source spreadsheet viewer showing the masked uploaded worksheet in a spreadsheet-style table with row/column headings, sticky headers, wrapped text, and scrolling for large sheets.
- Manual transactions are appended to the source-sheet preview using the detected statement columns. Date, description, currency, debit/credit, and optional category/type fields are filled when available; bank-only fields remain blank.
- **Simplify & export** downloads an Excel-compatible CSV with Date, Description, Category, Type, Amount, Currency, Counts as Spend, and Source columns, including both imported and manually entered transactions.
- Motion and hover feedback across buttons, cards, allocation bars, charts, dialogs, and page entry, with `prefers-reduced-motion` support.

## Privacy model

The statement file is read by the browser using local file APIs. Parsed transactions and the masked source worksheet rows are stored in this tab's `sessionStorage` after upload. Refreshing `console.html` keeps the current console session, but statement data is not written to `localStorage`. Closing the tab/window clears the active statement under normal browser behavior.

The app does not connect to your bank, does not call a server, and does not upload your statement.

Only the user's flexible budget allocation settings are saved long-term in `localStorage`.

## Run it

Open `index.html` directly in a modern browser.

For best `.xlsx` support, use a current Chrome, Edge, or Safari browser. CSV and TSV imports do not need Excel parsing support.

## Supported spreadsheet shape

The importer looks for a transaction table containing headers such as:

- `Transaction Date`
- `Statement Code`
- `Description`
- `Supplementary Code`
- `Supplementary Code Description`
- `Client Reference`
- `Additional Reference`
- `Currency`
- `Debit Amount`
- `Credit Amount`

The importer automatically detects the header row, so the transaction table does not need to start on row 1. The full masked source rows are retained for the spreadsheet viewer.

## Financial assumptions

- Credits with statement code `GR` and descriptions beginning with `PAY` are treated as payroll.
- Transfers to the censored other bank account are treated as reserve transfers and excluded from spending by default.
- Interest credits are categorized as interest.
- PayNow and NETS QR transactions are grouped under `PayNow / QR` unless they are detected as reserve transfers or inflows.
- Merchant categories are heuristic.
- Spendable allocation categories are combined into the allowance used for actual-spending comparisons.
- Non-spendable allocation categories are targets; the statement cannot confirm destination balances after funds leave the uploaded account.

## Files

- `index.html` — upload and masking page.
- `console.html` — finance dashboard and source spreadsheet viewer.
- `styles.css` — black/orange responsive design, spreadsheet-viewer styles, and motion effects.
- `parser.js` — local Excel/CSV/TSV import, masking, transaction categorization, and masked source-row retention.
- `upload.js` — upload-page behavior and tab-scoped handoff to the console.
- `console.js` — dashboard rendering, flexible allocation planner, manual entries, spreadsheet viewer, and simplified CSV export.

- Manual spreadsheet rows are merged into the transaction block by date, preserving the newest-to-oldest display order.
