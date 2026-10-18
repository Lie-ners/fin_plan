# Flexible Finance Tracker

A GitHub Pages-friendly personal finance dashboard backed by Supabase Auth and Postgres. Users can create accounts, import a bank statement once, keep adding transactions manually, view arbitrary multi-month ranges, maintain flexible paycheck allocations, and track saving goals.

## What changed

- Supabase email/password account creation and login with an account username used throughout the UI.
- Transactions, statements, allocation settings, and saving goals persist to the signed-in user account.
- The original workbook file stays in the browser; the parser applies masking first, then the parsed masked rows are stored in Supabase.
- Returning users do not need to upload the same statement again.
- Manual transactions are saved immediately to Supabase.
- Month filtering is now a From/To range and can cover several months or the full history.
- Saving goals support: Emergency Fund, Vehicle, Electronics & Gaming, Travel, Home & Housing, Education, Health & Wellness, Family & Gifts, Debt Payoff, Investing & Retirement, and Other.
- Goal cards track current amount, target amount, target date, progress, and optional notes.
- Existing flexible budget presets remain available.
- The latest imported masked workbook can still be previewed and simplified/exported as CSV.

## Supabase setup

### 1. Create the database tables and policies

Open **Supabase Dashboard -> SQL Editor**, paste the contents of `supabase-schema.sql`, and run it once.

The SQL creates:

- `finance_settings`
- `statements`
- `transactions`
- `saving_goals`

All four tables use Row Level Security so an authenticated user can only access rows whose `user_id` matches their own Supabase Auth user ID.

### 2. Add your public Supabase configuration

Open `supabase-config.js` and replace:

```js
const SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL";
const SUPABASE_PUBLISHABLE_KEY = "YOUR_SUPABASE_PUBLISHABLE_KEY";
```

Use your **Project URL** and **Publishable key** from the Supabase Connect/API Keys screen.

Never place a secret key or service-role key in this repository or any browser-side file.

### 3. Configure authentication URLs

For the current GitHub Pages deployment, set the Supabase Auth **Site URL** to:

```text
https://lie-ners.github.io/fin_plan/
```

Add this production redirect URL:

```text
https://lie-ners.github.io/fin_plan/login.html
```

If you later use a custom domain, update these values in Supabase to match that domain.

### 4. Enable email/password auth

In **Authentication -> Providers**, make sure the Email provider is enabled. If email confirmation is enabled, new users will be asked to confirm their email before signing in.

### 5. Commit and publish

Commit the new/changed files and push to GitHub:

```bash
git add .
git commit -m "Add Supabase accounts, saving goals, and persistent finance data"
git push
```

GitHub Pages will redeploy the same site URL.

## Main files

- `login.html` — login page.
- `signup.html` — account creation page.
- `index.html` — authenticated statement import/onboarding page.
- `console.html` — authenticated finance dashboard.
- `supabase-config.js` — public project URL + publishable key.
- `data.js` — Supabase database/auth data-access helpers.
- `auth.js` — login and signup behavior.
- `supabase-schema.sql` — database schema, grants, indexes, and RLS policies.
- `parser.js` — local Excel/CSV/TSV parser and masking logic.
- `upload.js` — authenticated import flow.
- `console.js` — dashboard, date ranges, manual transactions, goals, allocations, workbook preview, and export.
- `styles.css` — application, auth, goal, spreadsheet, and responsive styles.

## Data model

### Statements

Stores metadata plus the masked source-sheet rows. The latest statement is used for the workbook preview and statement snapshot.

### Transactions

Stores both imported and manually entered transactions. `source_kind` distinguishes `imported` from `manual` rows.

### Finance settings

Stores the user's flexible allocation categories as JSON.

### Saving goals

Stores goal name, category, target amount, saved amount, optional target date, notes, and status.

## Privacy model

This version is no longer local-only. Account data is intentionally persisted in Supabase so users can return later without re-uploading their statement.

Masking still happens in the browser before parsed source rows are written to Supabase. The raw `.xlsx`, `.csv`, or `.tsv` file is not uploaded by this application.
