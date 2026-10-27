# Flexible Finance Tracker

A simple personal finance dashboard for tracking spending, income, budget allocations, and savings goals in one place.

The app is designed for people who want a clearer view of their money without having to reconnect a bank account every time they use it.

## What you can do

- Create an account with a unique username and keep your finance data available across sessions.
- Open your account panel to manage your username, email, password, appearance, or account.
- Switch between dark and bright themes from the account panel. Bright mode uses a royal-blue accent palette.
- Import a bank statement from PDF, `.xlsx`, `.csv`, or `.tsv`.
- Define a main account and optional savings account during import so transfers to that savings account can be identified explicitly.
- Mask defined account identifiers automatically, and optionally mask names, card fragments, references, or other sensitive text before imported data is saved.
- Add transactions manually whenever needed.
- Clear imported statement data without deleting manual transactions, savings goals, or your budget plan.
- View your finances across one month, several months, or your full saved history.
- Track income, spending, reserve transfers, and remaining spending allowance.
- Build a custom paycheck allocation plan using your own percentages and categories.
- Use starter budget presets such as 50/30/20 or create your own structure.
- Create savings goals and track progress over time.
- Preview your latest imported statement data and export a simplified CSV of your transactions.
- Open `demo.html` to explore an interactive dashboard sandbox with example data without signing in.

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
3. On your first visit, open the import page and optionally define your main account and savings account identifiers.
4. If you define a savings account, outgoing transactions are treated as reserve transfers only when the statement text contains that savings-account identifier. If you leave it blank, those debits remain expenses.
5. Add any additional privacy masking rules you want before selecting the file. Defined account identifiers are masked automatically.
6. Once the statement is imported, the dashboard will save your parsed finance data to your account.
7. From then on, you can return to the dashboard without uploading the same statement again.
8. Add manual transactions or import newer statements whenever you want to update your history.

Live site: https://lie-ners.github.io/fin_plan/

Public demo: `demo.html` (or `/fin_plan/demo.html` when deployed to GitHub Pages). The demo uses local example data only and does not connect to Supabase, require authentication, or offer statement imports.

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

### Account settings

Tap your account badge in the dashboard header to open the account panel. Each account has a permanent Supabase Auth UUID shown as its **Account ID**. From the panel you can change your unique username, request an email change, update your password, sign out from the main dashboard, or permanently delete your account.

Usernames are unique without regard to letter case, so `Linus`, `linus`, and `LINUS` cannot belong to different accounts.

Deleting an account also deletes finance records tied to that Supabase Auth user through the database's cascading foreign keys. Account deletion is irreversible.

## Statement imports

Supported formats:

- PDF `.pdf` — including image-only statements that require on-device OCR
- Excel `.xlsx`
- CSV `.csv`
- TSV `.tsv`

For spreadsheets, the importer looks for a transaction table containing common fields such as transaction date, description, debit amount, credit amount, currency, and statement code. For PDFs, it first uses any embedded text and falls back to on-device OCR for image-based bank statements.

### Defining bank accounts and reserve transfers

On the import page, the user can optionally enter a **main account identifier** and a **savings account identifier**. The main account identifier is used for masking. The savings account identifier controls automatic reserve-transfer detection.

A debit is classified as a **Reserve Transfer** only when the unmasked transaction text contains the savings-account identifier supplied for that import. If no savings account is supplied, the tracker does not infer savings from generic transfer wording: the debit remains ordinary spending unless another transaction rule categorises it differently.

This depends on the bank statement exposing the destination identifier. If the bank hides or truncates it differently, or OCR misreads it, the tracker cannot safely know that the transfer went to savings and will treat it as spending. Account definitions are used during the import and their raw values are not saved to Supabase.

You can import additional statements later using **Import statement** on the dashboard. Overlapping statement periods are compared with your existing imported history so matching transactions are skipped.

If an older import left you with duplicated or unwanted statement data, use **Clear statement** from the dashboard header or statement panel. This removes statement-derived transactions and saved statement snapshots while keeping transactions you added manually, saving goals, and your budget plan.


## Public demo

`demo.html` is a public, no-login sandbox of the main dashboard. It uses example finance data and never connects to Supabase. Visitors can change the date range and theme, add temporary manual transactions, add/update/delete saving goals, edit the paycheck allocation plan, clear the example statement, and export demo transactions. Importing statements and account-security actions are intentionally unavailable. All demo edits are in memory and reset when the page is refreshed.

## Privacy and data storage

The original statement file itself is not uploaded by the app. PDF OCR, when needed, runs in the browser on the user's device.

Your browser reads the file first, uses any bank-account definitions to classify transfers, applies masking, and converts the statement into parsed transaction data. Defined account identifiers and custom masking needles are used only during that import and are not saved in raw form. The resulting masked data is then saved to Supabase so it remains available when you sign out, close the browser, or use another device.

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
- Reserve-transfer detection is intentionally conservative: it requires a user-defined savings account identifier to appear in the transaction text. Without that definition, outgoing transfers count as spending.
- Imported statement layouts vary between banks, so some exports may need adjustment before they can be recognised.
- Image-only PDFs use on-device OCR, so long statements can take noticeably longer to import on older phones.
- Overlapping statement imports are checked against existing imported transactions so matching rows are skipped instead of being counted twice.
- Saving-goal progress is updated manually and is not automatically linked to a separate bank or investment account.
- This is a personal finance tracking tool, not financial advice.

## For contributors

This project is a static HTML/CSS/JavaScript application hosted on GitHub Pages and uses Supabase for authentication and persistent data storage.

Main files:

- `index.html` / `login.html` — authentication entry points
- `signup.html` — account creation
- `console.html` — authenticated finance dashboard
- `demo.html` / `demo-data.js` — public interactive dashboard sandbox with example data
- `auth.js` — sign-up and login behaviour
- `data.js` — Supabase data access
- `parser.js` — PDF/Excel/CSV/TSV parsing, on-device PDF OCR, and masking
- `upload.js` — statement import flow
- `console.js` — dashboard behaviour
- `styles.css` — application styling
- `supabase-schema.sql` — database tables, unique account profiles, and Row Level Security policies
- `supabase-username-migration.sql` — one-time migration for existing projects to add unique usernames and profile rows
- `supabase/functions/delete-account/index.ts` — authenticated server-side account deletion function

For a new Supabase project, run `supabase-schema.sql` in the Supabase SQL Editor and configure the browser-safe project URL and publishable key in `supabase-config.js`. Never place a Supabase secret or service-role key in this repository.

For an **existing** Finance Tracker project, run `supabase-username-migration.sql` once before deploying the updated frontend. It creates the `profiles` table, backfills current Auth users, resolves any pre-existing duplicate usernames, and adds the case-insensitive unique username constraint. Existing finance records already use each Supabase Auth user UUID as their `user_id`, so transaction ownership does not need to be migrated.

### Deploy the account-deletion function

Changing usernames, email addresses, and passwords uses the signed-in Supabase client. Permanently deleting an Auth user requires privileged server-side access, so the browser calls the included `delete-account` Supabase Edge Function instead of exposing a secret key.

Deploy it once to the same Supabase project used by the site. With the Supabase CLI linked to your project:

```bash
supabase functions deploy delete-account
```

You can also create/deploy the function from **Supabase Dashboard → Edge Functions** by using the contents of `supabase/functions/delete-account/index.ts`. Keep the function authenticated; it is intended to be called only by signed-in users.

The unique-username update does require the profile migration above. The account-deletion Edge Function does not require an additional database schema change.
