# Flexible Finance Tracker

A simple personal finance dashboard for tracking spending, income, budget allocations, and savings goals in one place.

The app is designed for people who want a clearer view of their money without having to reconnect a bank account every time they use it.

## What you can do

- Create an account and keep your finance data available across sessions.
- Import a bank statement from `.xlsx`, `.csv`, or `.tsv`.
- Mask account numbers, names, card fragments, or other sensitive text before imported data is saved.
- Add transactions manually whenever needed.
- View your finances across one month, several months, or your full saved history.
- Track income, spending, reserve transfers, and remaining spending allowance.
- Build a custom paycheck allocation plan using your own percentages and categories.
- Use starter budget presets such as 50/30/20 or create your own structure.
- Create savings goals and track progress over time.
- Preview your latest imported spreadsheet and export a simplified CSV of your transactions.

## Savings goals

Goals are kept separate from everyday transaction categories so you can clearly track what you are working toward.

Available goal categories include:

- Emergency Fund
- Vehicle
- Electronics & Gaming
- Travel
- Home & Housing
- Education
- Health & Wellness
- Family & Gifts
- Debt Payoff
- Investing & Retirement
- Other

Examples include saving for a car, a PS5, a holiday, a home deposit, or an emergency fund.

## Getting started

1. Open the app and create an account.
2. Sign in with your account.
3. On your first visit, import a bank statement.
4. Add any masking rules you want before selecting the file.
5. Once the statement is imported, the dashboard will save your parsed finance data to your account.
6. From then on, you can return to the dashboard without uploading the same statement again.
7. Add manual transactions or import newer statements whenever you want to update your history.

Live site: https://lie-ners.github.io/fin_plan/

## Dashboard overview

### Finance summary

The top of the dashboard shows your selected date range, available balance, latest statement date, spending allowance remaining, payroll received, actual spending, and reserve transfers.

### Date range

Use the **From** and **To** month controls to view a specific period. You can compare several months at once or select **All** to view your entire saved history.

### Paycheck allocation

Your paycheck plan can be divided into any categories you want. Categories marked as **Spendable** are combined into your spending allowance, while the remaining categories can represent savings, investing, debt repayment, or other financial priorities.

### Saving goals

Create a goal with:

- a name
- a category
- a target amount
- the amount already saved
- an optional target date
- optional notes

You can update the saved amount at any time and the dashboard will show your progress.

### Manual transactions

Use **Add transaction** when you need to record something that was not included in an imported statement. Manual transactions are saved to your account and included in your dashboard totals.

## Statement imports

Supported formats:

- Excel `.xlsx`
- CSV `.csv`
- TSV `.tsv`

The importer looks for a transaction table containing common fields such as transaction date, description, debit amount, credit amount, currency, and statement code.

You can import additional statements later using **Import statement** on the dashboard.

> When importing overlapping statement periods, check your transaction history carefully. Importing the same transactions more than once may currently create duplicates.

## Privacy and data storage

The original statement file itself is not uploaded by the app.

Your browser reads the file first, applies any masking rules you entered, and converts it into parsed transaction and statement data. The parsed, masked data is then saved to Supabase so it remains available when you sign out, close the browser, or use another device.

Each user's saved finance data is tied to their authenticated account and protected using Supabase Row Level Security policies.

Do not use the masking feature as a substitute for reviewing what information you are comfortable storing online.

## Exporting your data

The **Simplify & export** button downloads your saved transactions as a CSV containing fields such as:

- Date
- Description
- Category
- Type
- Amount
- Currency
- Whether it counts as spending
- Whether it was imported or added manually

## Current limitations

- Transaction categorisation is based on rules and may not always classify a merchant correctly.
- Imported statement layouts vary between banks, so some exports may need adjustment before they can be recognised.
- Importing overlapping statements can result in duplicate transactions.
- Saving-goal progress is updated manually and is not automatically linked to a separate bank or investment account.
- This is a personal finance tracking tool, not financial advice.

## For contributors

This project is a static HTML/CSS/JavaScript application hosted on GitHub Pages and uses Supabase for authentication and persistent data storage.

Main files:

- `index.html` / `login.html` — authentication entry points
- `signup.html` — account creation
- `console.html` — finance dashboard
- `auth.js` — sign-up and login behaviour
- `data.js` — Supabase data access
- `parser.js` — Excel/CSV/TSV parsing and masking
- `upload.js` — statement import flow
- `console.js` — dashboard behaviour
- `styles.css` — application styling
- `supabase-schema.sql` — database tables and Row Level Security policies

For a new Supabase project, run `supabase-schema.sql` in the Supabase SQL Editor and configure the browser-safe project URL and publishable key in `supabase-config.js`. Never place a Supabase secret or service-role key in this repository.
