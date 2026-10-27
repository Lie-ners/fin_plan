(() => {
  "use strict";

  const SETTINGS_KEY = "financeTracker-flexible-settings-v3";
  const LEGACY_SETTINGS_KEY = "financeTracker502525-settings-v2";
  const CATEGORY_OPTIONS = [
    "Food & Drinks", "Groceries", "Transport", "Shopping", "Health & Personal",
    "Insurance", "Subscriptions", "Cash", "PayNow / QR", "Other Spending",
    "Reserve Transfer", "Income", "Refund", "Interest", "Other Inflow"
  ];

  const GOAL_CATEGORIES = [
    "Emergency Fund",
    "Vehicle",
    "Electronics & Gaming",
    "Travel",
    "Home & Housing",
    "Education",
    "Health & Wellness",
    "Family & Gifts",
    "Debt Payoff",
    "Investing & Retirement",
    "Other"
  ];

  const PRESETS = [
    {
      id: "balanced-50-30-20",
      name: "Balanced 50 / 30 / 20",
      description: "A common starting point: 50% needs, 30% wants, and 20% for savings or debt goals.",
      categories: [
        { name: "Needs", percent: 50, spendable: true },
        { name: "Wants", percent: 30, spendable: true },
        { name: "Savings & Debt", percent: 20, spendable: false }
      ]
    },
    {
      id: "pay-yourself-first-80-20",
      name: "Pay Yourself First 80 / 20",
      description: "A simple two-bucket approach for people who want to automate 20% toward their future first.",
      categories: [
        { name: "Living & Lifestyle", percent: 80, spendable: true },
        { name: "Savings & Investing", percent: 20, spendable: false }
      ]
    },
    {
      id: "savings-focus-60-20-20",
      name: "Savings Focus 60 / 20 / 20",
      description: "Leaves 60% for current spending while giving savings and investing their own 20% targets.",
      categories: [
        { name: "Living", percent: 60, spendable: true },
        { name: "Savings", percent: 20, spendable: false },
        { name: "Investing", percent: 20, spendable: false }
      ]
    },
    {
      id: "classic-50-25-25",
      name: "Classic 50 / 25 / 25",
      description: "Keeps the tracker’s original split, but each category can be renamed, removed, or expanded.",
      categories: [
        { name: "Spending", percent: 50, spendable: true },
        { name: "Savings", percent: 25, spendable: false },
        { name: "Investing", percent: 25, spendable: false }
      ]
    }
  ];

  const $ = id => document.getElementById(id);
  const DEMO_MODE = document.body.dataset.demo === "true";

  function categoryId() {
    if (globalThis.crypto?.randomUUID) return `allocation-${crypto.randomUUID()}`;
    return `allocation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function createCategories(categories) {
    return (categories || []).map(category => ({
      id: category.id || categoryId(),
      name: String(category.name || "").trim(),
      percent: Number(category.percent || 0),
      spendable: Boolean(category.spendable)
    }));
  }

  const defaultSettings = { categories: createCategories(PRESETS[3].categories) };

  let state = {
    user: null,
    profile: null,
    settings: { categories: createCategories(defaultSettings.categories) },
    transactions: [],
    statement: null,
    sheetRows: [],
    maskRules: [],
    goals: []
  };
  let periodStartMonth = "";
  let periodEndMonth = "";
  let draftCategories = [];

  function validSettings(settings) {
    if (!Array.isArray(settings?.categories) || !settings.categories.length) return false;
    const total = settings.categories.reduce((sum, category) => sum + Number(category?.percent || 0), 0);
    return Math.abs(total - 100) < 0.001 && settings.categories.every(category =>
      String(category?.name || "").trim() &&
      Number.isFinite(Number(category?.percent)) &&
      Number(category.percent) >= 0
    );
  }

  function localSettingsFallback() {
    try {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (validSettings(stored)) return { categories: createCategories(stored.categories) };
    } catch (_) {}

    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_SETTINGS_KEY));
      const total = Number(legacy?.spend) + Number(legacy?.save) + Number(legacy?.invest);
      if (Math.abs(total - 100) < 0.001) {
        return {
          categories: createCategories([
            { name: "Spending", percent: Number(legacy.spend), spendable: true },
            { name: "Savings", percent: Number(legacy.save), spendable: false },
            { name: "Investing", percent: Number(legacy.invest), spendable: false }
          ])
        };
      }
    } catch (_) {}

    return { categories: createCategories(defaultSettings.categories) };
  }

  function allocationCategories() {
    return state.settings.categories || [];
  }

  function spendablePercent() {
    return allocationCategories()
      .filter(category => category.spendable)
      .reduce((sum, category) => sum + category.percent, 0);
  }

  function reservePercent() {
    return allocationCategories()
      .filter(category => !category.spendable)
      .reduce((sum, category) => sum + category.percent, 0);
  }

  function currencyCode() {
    return state.statement?.currencyCode || state.transactions.find(transaction => transaction.currency)?.currency || "SGD";
  }

  function money(n) {
    try {
      return new Intl.NumberFormat("en-SG", { style: "currency", currency: currencyCode() }).format(Number(n || 0));
    } catch (_) {
      return `${currencyCode()} ${Number(n || 0).toFixed(2)}`;
    }
  }

  function dateFmt(iso) {
    if (!iso) return "—";
    return new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric" })
      .format(new Date(`${iso}T00:00:00`));
  }

  function monthFmt(ym) {
    if (!ym) return "—";
    return new Intl.DateTimeFormat("en-SG", { month: "short", year: "numeric" })
      .format(new Date(`${ym}-01T00:00:00`));
  }

  function months() {
    return [...new Set(state.transactions.map(transaction => transaction.date?.slice(0, 7)).filter(Boolean))].sort();
  }

  function inActivePeriod(transaction) {
    const month = transaction.date?.slice(0, 7) || "";
    if (!month) return false;
    if (periodStartMonth && month < periodStartMonth) return false;
    if (periodEndMonth && month > periodEndMonth) return false;
    return true;
  }

  function periodTransactions() {
    return state.transactions.filter(inActivePeriod);
  }

  function isDebit(transaction) { return transaction.amount < 0; }
  function isCredit(transaction) { return transaction.amount > 0; }
  function isPayroll(transaction) { return transaction.category === "Income" || transaction.isPayroll; }
  function countsAsSpend(transaction) { return isDebit(transaction) && !transaction.excludeFromSpending; }
  function isReserve(transaction) { return isDebit(transaction) && transaction.excludeFromSpending; }

  function metrics(list) {
    const payroll = list.filter(transaction => isCredit(transaction) && isPayroll(transaction))
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const spending = list.filter(countsAsSpend)
      .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
    const reserve = list.filter(isReserve)
      .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
    const spendTarget = payroll * spendablePercent() / 100;
    const reserveTarget = payroll * reservePercent() / 100;
    const targets = allocationCategories().map(category => ({
      ...category,
      target: payroll * category.percent / 100
    }));
    return { payroll, spending, reserve, spendTarget, reserveTarget, targets, remaining: spendTarget - spending };
  }

  function initializePeriodRange() {
    const allMonths = months();
    if (!allMonths.length) {
      periodStartMonth = "";
      periodEndMonth = "";
      return;
    }
    // Preserve the original single-month dashboard behaviour by default.
    // Users can widen the range with the From/To controls or All history.
    periodEndMonth = allMonths[allMonths.length - 1];
    periodStartMonth = periodEndMonth;
  }

  function renderPeriodControls() {
    const allMonths = months();
    const min = allMonths[0] || "";
    const max = allMonths[allMonths.length - 1] || "";
    const from = $("periodFrom");
    const to = $("periodTo");
    from.min = min;
    from.max = max;
    to.min = min;
    to.max = max;
    from.value = periodStartMonth;
    to.value = periodEndMonth;

    const summary = $("periodSummary");
    if (!periodStartMonth && !periodEndMonth) summary.textContent = "No data";
    else if (periodStartMonth === periodEndMonth) summary.textContent = monthFmt(periodStartMonth);
    else summary.textContent = `${monthFmt(periodStartMonth)} – ${monthFmt(periodEndMonth)}`;
  }

  function renderStatementMeta() {
    const txs = state.transactions;
    const first = txs[0]?.date;
    const last = txs[txs.length - 1]?.date;
    const st = state.statement || {};
    const balances = adjustedStatementBalances();

    $("rangeMeta").textContent = first && last ? `${dateFmt(first)} – ${dateFmt(last)}` : "No transactions yet";
    $("availableMeta").textContent = balances.availableBalance != null ? money(balances.availableBalance) : "—";
    $("statementDateMeta").textContent = dateFmt(st.statementDate);
    $("snapshotBalance").textContent = balances.availableBalance != null ? money(balances.availableBalance) : "—";
    $("snapshotDate").textContent = st.statementDate ? `as at ${dateFmt(st.statementDate)}` : "No statement imported yet";
    $("footerMeta").textContent = first && last
      ? `Saved finance history: ${dateFmt(first)} – ${dateFmt(last)} · ${txs.length} transactions`
      : "No transactions saved yet.";
  }

  function renderKpis() {
    const m = metrics(periodTransactions());
    const spendPct = spendablePercent();
    $("remainingKpi").textContent = money(m.remaining);
    $("remainingKpi").style.color = m.remaining < 0 ? "var(--danger)" : "var(--text)";
    $("payrollKpi").textContent = money(m.payroll);
    $("spendingKpi").textContent = money(m.spending);
    $("reserveKpi").textContent = money(m.reserve);
    $("remainingHint").textContent = `${formatPercent(spendPct)} of payroll is marked spendable`;
    const diff = m.reserve - m.reserveTarget;
    $("reserveHint").textContent = m.reserveTarget > 0
      ? `${diff >= 0 ? money(diff) + " above" : money(Math.abs(diff)) + " below"} non-spendable target · only defined savings transfers count`
      : "Only transfers matched to a defined savings account count here";
  }

  function renderAllocation() {
    const m = metrics(periodTransactions());
    const categories = m.targets;
    $("allocationTitle").textContent = categories.length <= 5
      ? `${categories.map(category => formatPercent(category.percent, false)).join(" / ")} allocation`
      : `Custom allocation · ${categories.length} categories`;

    $("allocationBar").innerHTML = categories.map((category, index) => `
      <div class="segment tone-${index % 6}" style="width:${Math.max(0, category.percent)}%; animation-delay:${index * 45}ms" title="${escapeAttr(category.name)}: ${formatPercent(category.percent)}">
        <span>${escapeHtml(category.name)}</span>
      </div>
    `).join("");

    $("allocationCards").innerHTML = categories.map((category, index) => `
      <div class="allocation-card tone-border-${index % 6}" style="animation-delay:${index * 45}ms">
        <span>${formatPercent(category.percent)} · ${category.spendable ? "Spendable" : "Set aside"}</span>
        <strong>${money(category.target)}</strong>
        <small>${escapeHtml(category.name)}</small>
      </div>
    `).join("");

    const usage = m.spendTarget > 0 ? (m.spending / m.spendTarget) * 100 : 0;
    const visualUsage = Math.min(100, Math.max(0, usage));
    $("usageBar").style.width = `${visualUsage}%`;
    $("usageBar").style.background = usage > 100 ? "var(--danger)" : "linear-gradient(90deg, var(--accent), var(--accent-2))";
    $("usageBadge").textContent = m.spendTarget > 0 ? `${Math.round(usage)}%` : "—";
    $("usageBadge").style.color = usage > 100 ? "var(--danger)" : "var(--accent-2)";
    $("spentMeta").textContent = money(m.spending);
    $("leftMeta").textContent = money(m.remaining);

    const message = $("budgetMessage");
    message.classList.toggle("over", m.remaining < 0);
    if (!state.transactions.length) {
      message.textContent = "Import a statement to start.";
    } else if (spendablePercent() === 0) {
      message.textContent = "Mark at least one category as spendable.";
    } else if (m.payroll === 0 && m.spending > 0) {
      message.textContent = "Spending found, but no payroll was detected in this range.";
    } else if (m.remaining < 0) {
      message.textContent = `Spending is ${money(Math.abs(m.remaining))} above the selected range's combined spendable allocation.`;
    } else {
      message.textContent = `${money(m.remaining)} remains from the selected range's combined spendable allocation.`;
    }
  }

  function renderMonthlyChart() {
    const visibleMonths = months().filter(month =>
      (!periodStartMonth || month >= periodStartMonth) && (!periodEndMonth || month <= periodEndMonth)
    );
    const data = visibleMonths.map(month => {
      const list = state.transactions.filter(transaction => transaction.date.startsWith(month));
      const m = metrics(list);
      return { month, allowance: m.spendTarget, spending: m.spending };
    });
    const maxVal = Math.max(1, ...data.flatMap(item => [item.allowance, item.spending]));
    $("monthlyChart").style.gridTemplateColumns = `repeat(${Math.max(1, data.length)}, minmax(78px, 1fr))`;
    $("monthlyChart").innerHTML = data.length ? data.map((item, index) => {
      const allowanceHeight = Math.max(2, item.allowance / maxVal * 210);
      const spendingHeight = Math.max(2, item.spending / maxVal * 210);
      return `<div class="month-column" title="${monthFmt(item.month)} — allowance ${money(item.allowance)}, spending ${money(item.spending)}">
        <div class="month-bars">
          <div class="bar allowance" style="height:${allowanceHeight}px; animation-delay:${index * 55}ms"></div>
          <div class="bar spending" style="height:${spendingHeight}px; animation-delay:${index * 55 + 70}ms"></div>
        </div>
        <div class="month-label">${monthFmt(item.month)}</div>
      </div>`;
    }).join("") + `<div class="chart-legend" style="grid-column:1/-1"><span><i class="legend-dot allowance-dot"></i>Spendable allowance</span><span><i class="legend-dot spending-dot"></i>Spending</span></div>`
      : `<div class="empty">No transactions in this date range.</div>`;
  }

  function payrollSource(description) {
    return description.replace(/^Payroll\s*—\s*/i, "") || "Payroll";
  }

  function renderPaychecks() {
    const categories = allocationCategories();
    const paychecks = periodTransactions()
      .filter(transaction => isCredit(transaction) && isPayroll(transaction))
      .sort((a, b) => b.date.localeCompare(a.date));
    $("paycheckCount").textContent = `${paychecks.length} paycheck${paychecks.length === 1 ? "" : "s"}`;
    $("paycheckTable").style.minWidth = `${Math.max(780, 390 + categories.length * 135)}px`;
    $("paycheckHeader").innerHTML = `<th>Date</th><th>Payroll source</th><th>Gross</th>` +
      categories.map(category => `<th>${escapeHtml(category.name)}</th>`).join("");
    $("paycheckRows").innerHTML = paychecks.length ? paychecks.map(transaction => `<tr>
      <td>${dateFmt(transaction.date)}</td>
      <td>${escapeHtml(payrollSource(transaction.description))}</td>
      <td class="amount positive">${money(transaction.amount)}</td>
      ${categories.map(category => `<td>${money(transaction.amount * category.percent / 100)}</td>`).join("")}
    </tr>`).join("") : `<tr><td colspan="${3 + categories.length}" class="empty">No payroll credits detected in this range.</td></tr>`;
  }

  function renderManualCategoryOptions() {
    const used = [...new Set([...CATEGORY_OPTIONS, ...state.transactions.map(transaction => transaction.category)])].sort();
    $("newCategory").innerHTML = used.map(category => `<option value="${escapeAttr(category)}">${escapeHtml(category)}</option>`).join("");
  }

  function renderGoalCategoryOptions() {
    $("goalCategory").innerHTML = GOAL_CATEGORIES.map(category =>
      `<option value="${escapeAttr(category)}">${escapeHtml(category)}</option>`
    ).join("");
  }

  function goalStatus(goal) {
    if (goal.currentAmount >= goal.targetAmount) return "complete";
    return goal.status || "active";
  }

  function renderGoals() {
    const grid = $("goalGrid");
    if (!state.goals.length) {
      grid.innerHTML = `<div class="goal-empty"><strong>No saving goals yet.</strong><span>Create a goal for an emergency fund, car, PS5, trip, home deposit, or anything else you are working toward.</span></div>`;
      return;
    }

    grid.innerHTML = state.goals.map((goal, index) => {
      const rawProgress = goal.targetAmount > 0 ? goal.currentAmount / goal.targetAmount * 100 : 0;
      const progress = Math.min(100, Math.max(0, rawProgress));
      const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
      const complete = goalStatus(goal) === "complete";
      return `<article class="goal-card ${complete ? "goal-complete" : ""}" style="animation-delay:${index * 50}ms">
        <div class="goal-card-top">
          <span class="goal-category">${escapeHtml(goal.category)}</span>
          <span class="goal-percent">${Math.round(progress)}%</span>
        </div>
        <h3>${escapeHtml(goal.name)}</h3>
        <div class="goal-progress"><div style="width:${progress}%"></div></div>
        <div class="goal-money"><strong>${money(goal.currentAmount)}</strong><span>of ${money(goal.targetAmount)}</span></div>
        <div class="goal-meta">
          <span>${complete ? "Goal reached" : `${money(remaining)} remaining`}</span>
          <span>${goal.targetDate ? `Target ${dateFmt(goal.targetDate)}` : "No target date"}</span>
        </div>
        ${goal.notes ? `<p class="goal-notes">${escapeHtml(goal.notes)}</p>` : ""}
        ${DEMO_MODE ? "" : `<div class="goal-actions">
          <button class="button ghost compact-button" type="button" data-goal-progress="${escapeAttr(goal.id)}">Update progress</button>
          <button class="link-button goal-delete" type="button" data-goal-delete="${escapeAttr(goal.id)}">Delete</button>
        </div>`}
      </article>`;
    }).join("");
  }

  function normalizeSheetHeader(value) {
    return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function excelColumnName(index) {
    let n = index + 1;
    let label = "";
    while (n > 0) {
      const remainder = (n - 1) % 26;
      label = String.fromCharCode(65 + remainder) + label;
      n = Math.floor((n - 1) / 26);
    }
    return label;
  }

  function sheetHeaderIndex(rows) {
    return rows.findIndex(row => {
      const values = (row || []).map(normalizeSheetHeader);
      return values.includes("transactiondate") && values.includes("description") &&
        (values.includes("debitamount") || values.includes("creditamount"));
    });
  }

  function manualTransactions() {
    return state.transactions.filter(transaction => transaction.sourceKind === "manual");
  }

  function manualBalanceAdjustment() {
    const statementDate = state.statement?.statementDate || "";
    // The imported balance is already a snapshot as of statementDate. Only
    // manual entries after that snapshot should move the displayed balance;
    // otherwise historical manual entries get counted a second time.
    return manualTransactions()
      .filter(transaction => !statementDate || String(transaction.date || "") > statementDate)
      .reduce((total, transaction) => total + Number(transaction.amount || 0), 0);
  }

  function adjustedStatementBalances() {
    const statement = state.statement || {};
    const adjustment = manualBalanceAdjustment();
    return {
      availableBalance: statement.availableBalance != null
        ? Math.round((Number(statement.availableBalance) + adjustment) * 100) / 100
        : null,
      ledgerBalance: statement.ledgerBalance != null
        ? Math.round((Number(statement.ledgerBalance) + adjustment) * 100) / 100
        : null
    };
  }

  function sheetColumnIndex(headers, ...names) {
    const normalized = headers.map(normalizeSheetHeader);
    for (const name of names) {
      const index = normalized.indexOf(normalizeSheetHeader(name));
      if (index >= 0) return index;
    }
    return -1;
  }

  function manualSheetRow(transaction, headerRow, maxColumns) {
    const row = Array.from({ length: maxColumns }, () => "");
    const put = (value, ...names) => {
      const index = sheetColumnIndex(headerRow, ...names);
      if (index >= 0) row[index] = value;
    };

    put(transaction.date, "Transaction Date", "Date");
    put(transaction.description, "Description", "Transaction Description");
    put(transaction.currency || currencyCode(), "Currency");
    put(transaction.category || "", "Category");
    const type = transaction.amount > 0 ? "Income" : transaction.excludeFromSpending ? "Reserve transfer" : "Expense";
    put(type, "Type", "Transaction Type");
    put(countsAsSpend(transaction) ? "Yes" : "No", "Counts as Spend", "Counts as Spending");
    if (transaction.amount < 0) put(Math.abs(transaction.amount), "Debit Amount", "Debit");
    else if (transaction.amount > 0) put(transaction.amount, "Credit Amount", "Credit");
    return row;
  }

  function sheetRowsWithManualEntries() {
    const sourceRows = Array.isArray(state.sheetRows)
      ? state.sheetRows.map(row => Array.isArray(row) ? row.slice() : [])
      : [];
    if (!sourceRows.length) return { rows: [], manualRowIndexes: new Set(), manualCount: 0 };

    const balances = adjustedStatementBalances();
    sourceRows.forEach(row => {
      const label = String(row?.[0] ?? "").trim().toLowerCase();
      if (label.startsWith("available balance") && balances.availableBalance != null) row[1] = balances.availableBalance;
      if (label.startsWith("ledger balance") && balances.ledgerBalance != null) row[1] = balances.ledgerBalance;
    });

    while (sourceRows.length && !sourceRows[sourceRows.length - 1].some(value => value != null && String(value).trim() !== "")) {
      sourceRows.pop();
    }

    const headerIndex = sheetHeaderIndex(sourceRows);
    if (headerIndex < 0) return { rows: sourceRows, manualRowIndexes: new Set(), manualCount: 0 };

    const headerRow = sourceRows[headerIndex] || [];
    const maxColumns = Math.max(1, ...sourceRows.map(row => row.length), headerRow.length);
    const dateColumn = sheetColumnIndex(headerRow, "Transaction Date", "Date");
    const manuals = manualTransactions();
    if (!manuals.length || dateColumn < 0) return { rows: sourceRows, manualRowIndexes: new Set(), manualCount: 0 };

    const parser = window.FinanceStatementParser;
    const parseRowDate = row => parser?.parseDateCell ? parser.parseDateCell(row?.[dateColumn]) : null;
    let transactionEnd = headerIndex + 1;
    while (transactionEnd < sourceRows.length && parseRowDate(sourceRows[transactionEnd])) transactionEnd++;

    const importedEntries = sourceRows.slice(headerIndex + 1, transactionEnd).map((row, index) => ({
      row,
      date: parseRowDate(row) || "",
      manual: false,
      order: index
    }));
    const manualEntries = manuals.map((transaction, index) => ({
      row: manualSheetRow(transaction, headerRow, maxColumns),
      date: transaction.date || "",
      manual: true,
      order: index
    }));
    const mergedEntries = [...importedEntries, ...manualEntries].sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      if (byDate) return byDate;
      if (a.manual !== b.manual) return a.manual ? -1 : 1;
      return a.order - b.order;
    });

    const rows = [
      ...sourceRows.slice(0, headerIndex + 1),
      ...mergedEntries.map(entry => entry.row),
      ...sourceRows.slice(transactionEnd)
    ];
    const manualRowIndexes = new Set();
    mergedEntries.forEach((entry, index) => {
      if (entry.manual) manualRowIndexes.add(headerIndex + 1 + index);
    });
    return { rows, manualRowIndexes, manualCount: manuals.length };
  }

  function formattedSheetCell(value, rowIndex, colIndex, headerIndex, dateColumns, row) {
    if (value == null || value === "") return "";
    const parser = window.FinanceStatementParser;
    if (rowIndex > headerIndex && dateColumns.has(colIndex) && parser?.parseDateCell) {
      const iso = parser.parseDateCell(value);
      if (iso) return dateFmt(iso);
    }
    const firstLabel = String(row?.[0] ?? "").trim().toLowerCase();
    if (rowIndex < headerIndex && colIndex === 1 && firstLabel.startsWith("statement as at") && parser?.parseDateCell) {
      const iso = parser.parseDateCell(value);
      if (iso) return dateFmt(iso);
    }
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    return String(value);
  }

  function renderSheet() {
    const { rows, manualRowIndexes, manualCount } = sheetRowsWithManualEntries();
    if (!rows.length) {
      $("sheetDimensions").textContent = "No source data";
      $("sheetTable").innerHTML = `<tbody><tr><td class="sheet-empty">Import a statement to populate the source-data preview. Your dashboard can continue to use manually added transactions even without an imported file.</td></tr></tbody>`;
      return;
    }

    const maxColumns = Math.max(1, ...rows.map(row => Array.isArray(row) ? row.length : 0));
    const headerIndex = sheetHeaderIndex(rows);
    const headerRow = headerIndex >= 0 ? rows[headerIndex] : [];
    const dateColumns = new Set(headerRow.map((value, index) => normalizeSheetHeader(value).includes("date") ? index : -1).filter(index => index >= 0));
    $("sheetDimensions").textContent = `${rows.length} rows · ${maxColumns} columns${manualCount ? ` · ${manualCount} manual` : ""}`;

    const columnHeaders = Array.from({ length: maxColumns }, (_, index) => `<th scope="col" class="sheet-column-letter">${excelColumnName(index)}</th>`).join("");
    const body = rows.map((row, rowIndex) => {
      const isManual = manualRowIndexes.has(rowIndex);
      const cells = Array.from({ length: maxColumns }, (_, colIndex) => {
        const text = formattedSheetCell(row?.[colIndex], rowIndex, colIndex, headerIndex, dateColumns, row);
        const className = rowIndex === headerIndex ? "sheet-data-header" : "";
        return `<td class="${className}"><span>${text ? escapeHtml(text) : "&nbsp;"}</span></td>`;
      }).join("");
      const rowClasses = [rowIndex === headerIndex ? "sheet-source-header" : "", isManual ? "sheet-manual-row" : ""].filter(Boolean).join(" ");
      return `<tr class="${rowClasses}"><th scope="row" class="sheet-row-number"${isManual ? ` title="Manual entry"` : ""}>${rowIndex + 1}</th>${cells}</tr>`;
    }).join("");
    $("sheetTable").innerHTML = `<thead><tr><th class="sheet-corner" aria-label="Row and column headings"></th>${columnHeaders}</tr></thead><tbody>${body}</tbody>`;
  }

  function simplifiedTransactionRows() {
    return state.transactions.slice().sort((a, b) => b.date.localeCompare(a.date)).map(transaction => {
      const type = transaction.amount > 0 ? "Income" : transaction.excludeFromSpending ? "Reserve transfer" : "Expense";
      return [
        transaction.date || "",
        transaction.description || "",
        transaction.category || "",
        type,
        Number(transaction.amount || 0),
        transaction.currency || currencyCode(),
        countsAsSpend(transaction) ? "Yes" : "No",
        transaction.sourceKind === "manual" ? "Manual" : "Imported"
      ];
    });
  }

  function csvCell(value) {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    let text = String(value ?? "");
    if (/^[=+@]/.test(text) || /^-(?!\d+(?:\.\d+)?$)/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportSimplifiedTransactions() {
    const header = ["Date", "Description", "Category", "Type", "Amount", "Currency", "Counts as Spend", "Source"];
    const rows = simplifiedTransactionRows();
    const csv = [header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "finance-transactions-simplified.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    const button = $("simplifyExportBtn");
    const original = button.textContent;
    button.textContent = `Exported ${rows.length} rows`;
    button.classList.add("export-complete");
    window.setTimeout(() => {
      button.textContent = original;
      button.classList.remove("export-complete");
    }, 1500);
  }

  function renderAll() {
    renderPeriodControls();
    renderStatementMeta();
    renderKpis();
    renderAllocation();
    renderGoals();
    renderMonthlyChart();
    renderPaychecks();
    renderManualCategoryOptions();
    renderGoalCategoryOptions();
    renderSheet();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }

  function escapeAttr(value) { return escapeHtml(value); }

  function displayNameForUser(user, profile = state.profile) {
    const profileName = String(profile?.username || "").trim();
    if (profileName) return profileName;
    const metadataName = String(user?.user_metadata?.username || user?.user_metadata?.display_name || "").trim();
    if (metadataName) return metadataName;
    const emailPrefix = String(user?.email || "").split("@")[0].trim();
    return emailPrefix || "User";
  }

  function userInitial(name) {
    const first = String(name || "User").trim().charAt(0);
    return first ? first.toUpperCase() : "U";
  }

  function applyUserIdentity(user, profile = state.profile) {
    if (!user) return;
    state.user = user;
    if (profile) state.profile = profile;
    const accountName = displayNameForUser(user, profile);
    $("userName").textContent = accountName;
    $("userNameChip").textContent = accountName;
    $("userAvatar").textContent = userInitial(accountName);
  }

  function syncAccountPanelFields() {
    if (!state.user) return;
    $("accountUsername").value = displayNameForUser(state.user, state.profile);
    $("accountEmail").value = state.user.email || "";
    $("accountUserId").value = state.user.id || "";
  }

  function setAccountMessage(id, message, isError = false) {
    const el = $(id);
    el.textContent = message || "";
    el.hidden = !message;
    el.classList.toggle("error", Boolean(message) && isError);
    el.classList.toggle("success", Boolean(message) && !isError);
  }

  function formatPercent(value, includeSymbol = true) {
    const n = Number(value || 0);
    const text = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
    return includeSymbol ? `${text}%` : text;
  }

  function flashRefresh() {
    const view = $("appView");
    view.classList.remove("data-refreshed");
    void view.offsetWidth;
    view.classList.add("data-refreshed");
    window.setTimeout(() => view.classList.remove("data-refreshed"), 500);
  }

  function renderPresets() {
    $("presetGrid").innerHTML = PRESETS.map(preset => `
      <button type="button" class="preset-card" data-preset-id="${escapeAttr(preset.id)}">
        <strong>${escapeHtml(preset.name)}</strong>
        <span>${escapeHtml(preset.description)}</span>
        <small>${preset.categories.map(category => `${formatPercent(category.percent)} ${escapeHtml(category.name)}`).join(" · ")}</small>
      </button>
    `).join("");
  }

  function renderAllocationEditor() {
    $("allocationEditor").innerHTML = draftCategories.map((category, index) => `
      <div class="allocation-editor-row" data-allocation-id="${escapeAttr(category.id)}">
        <label>
          <span>Name</span>
          <input class="allocation-name" type="text" maxlength="40" required value="${escapeAttr(category.name)}" placeholder="e.g. Emergency fund" />
        </label>
        <label>
          <span>Percent</span>
          <div class="percent-input-wrap"><input class="allocation-percent" type="number" min="0" max="100" step="0.1" required value="${category.percent}" /><b>%</b></div>
        </label>
        <label class="spendable-toggle">
          <input class="allocation-spendable" type="checkbox" ${category.spendable ? "checked" : ""} />
          <span>Spendable</span>
        </label>
        <button type="button" class="icon-button allocation-remove" aria-label="Remove ${escapeAttr(category.name || `category ${index + 1}`)}">×</button>
      </div>
    `).join("");
    updateAllocationTotal();
  }

  function syncDraftFromEditor() {
    const rows = Array.from($("allocationEditor").querySelectorAll(".allocation-editor-row"));
    draftCategories = rows.map(row => ({
      id: row.dataset.allocationId,
      name: row.querySelector(".allocation-name").value.trim(),
      percent: Number(row.querySelector(".allocation-percent").value || 0),
      spendable: row.querySelector(".allocation-spendable").checked
    }));
  }

  function updateAllocationTotal() {
    syncDraftFromEditor();
    const total = draftCategories.reduce((sum, category) => sum + Number(category.percent || 0), 0);
    $("allocationTotal").textContent = formatPercent(total);
    $("allocationTotal").classList.toggle("invalid", Math.abs(total - 100) > 0.001);
    $("splitError").hidden = true;
  }

  function openSettingsDialog() {
    draftCategories = createCategories(allocationCategories());
    renderPresets();
    renderAllocationEditor();
    $("splitError").hidden = true;
    $("settingsDialog").showModal();
  }

  function setInlineError(id, message) {
    const el = $(id);
    el.textContent = message || "";
    el.hidden = !message;
  }

  async function bootstrap() {
    try {
      const loaded = DEMO_MODE
        ? window.FinanceDemoData.loadDashboardData()
        : await window.FinanceData.loadDashboardData();
      state.user = loaded.user;
      state.profile = loaded.profile;
      const savedTheme = String(loaded.user?.user_metadata?.theme || "").toLowerCase();
      if ((savedTheme === "dark" || savedTheme === "light") && window.FinanceTheme) {
        window.FinanceTheme.apply(savedTheme);
      }
      state.transactions = loaded.transactions;
      state.statement = loaded.statement;
      state.sheetRows = loaded.sheetRows;
      state.maskRules = loaded.maskRules;
      state.goals = loaded.goals;
      applyUserIdentity(loaded.user, loaded.profile);
      syncAccountPanelFields();

      if (loaded.settings && validSettings(loaded.settings)) {
        state.settings = { categories: createCategories(loaded.settings.categories) };
      } else {
        state.settings = localSettingsFallback();
        if (!DEMO_MODE) await window.FinanceData.saveSettings(state.settings.categories);
      }

      if (!DEMO_MODE && !state.transactions.length && !state.statement) {
        location.replace("import.html");
        return;
      }

      initializePeriodRange();
      if (DEMO_MODE) {
        const demoMonths = months();
        periodStartMonth = demoMonths[0] || "";
        periodEndMonth = demoMonths[demoMonths.length - 1] || "";
      }
      renderAll();
      requestAnimationFrame(() => document.documentElement.classList.add("app-ready"));
    } catch (error) {
      console.error(error);
      $("footerMeta").textContent = error?.message || "Could not load account data.";
      $("budgetMessage").textContent = "Could not load your finance data. Check Supabase configuration and database policies.";
      $("budgetMessage").classList.add("over");
    }
  }

  function openAccountPanel() {
    syncAccountPanelFields();
    $("themeToggle").checked = window.FinanceTheme?.current?.() === "light";
    ["usernameMessage", "emailMessage", "passwordMessage", "deleteAccountMessage"].forEach(id => setAccountMessage(id, ""));
    $("deleteAccountConfirm").value = "";
    $("deleteAccountBtn").disabled = true;
    $("accountPanelBackdrop").hidden = false;
    $("accountPanel").classList.add("is-open");
    $("accountPanel").setAttribute("aria-hidden", "false");
    $("accountPanelBtn").setAttribute("aria-expanded", "true");
    document.body.classList.add("account-panel-open");
    window.setTimeout(() => $(DEMO_MODE ? "themeToggle" : "accountUsername").focus(), 80);
  }

  function closeAccountPanel() {
    $("accountPanel").classList.remove("is-open");
    $("accountPanel").setAttribute("aria-hidden", "true");
    $("accountPanelBtn").setAttribute("aria-expanded", "false");
    document.body.classList.remove("account-panel-open");
    window.setTimeout(() => { $("accountPanelBackdrop").hidden = true; }, 220);
  }

  $("accountPanelBtn").addEventListener("click", openAccountPanel);
  $("accountPanelClose").addEventListener("click", closeAccountPanel);
  $("accountPanelBackdrop").addEventListener("click", closeAccountPanel);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && $("accountPanel").classList.contains("is-open")) closeAccountPanel();
  });

  $("themeToggle").addEventListener("change", async event => {
    const theme = event.target.checked ? "light" : "dark";
    window.FinanceTheme?.apply?.(theme);
    if (DEMO_MODE) return;
    try {
      const user = await window.FinanceData.updateTheme(theme);
      if (user) state.user = user;
    } catch (error) {
      console.error(error);
    }
  });

  $("usernameForm").addEventListener("submit", async event => {
    event.preventDefault();
    const submit = event.submitter;
    const username = $("accountUsername").value.trim();
    submit.disabled = true;
    setAccountMessage("usernameMessage", "");
    try {
      const updated = await window.FinanceData.updateUsername(username);
      state.profile = updated.profile;
      applyUserIdentity(updated.user, updated.profile);
      syncAccountPanelFields();
      setAccountMessage("usernameMessage", "Username updated.");
      flashRefresh();
    } catch (error) {
      setAccountMessage("usernameMessage", error?.message || "Could not update username.", true);
    } finally {
      submit.disabled = false;
    }
  });

  $("emailForm").addEventListener("submit", async event => {
    event.preventDefault();
    const submit = event.submitter;
    const requestedEmail = $("accountEmail").value.trim().toLowerCase();
    submit.disabled = true;
    setAccountMessage("emailMessage", "");
    try {
      const user = await window.FinanceData.updateEmail(requestedEmail);
      applyUserIdentity(user);
      if (String(user?.email || "").toLowerCase() === requestedEmail) {
        syncAccountPanelFields();
        setAccountMessage("emailMessage", "Email updated.");
      } else {
        $("accountEmail").value = requestedEmail;
        setAccountMessage("emailMessage", "Email change requested. Check your inbox and follow Supabase's confirmation link to finish the change.");
      }
    } catch (error) {
      setAccountMessage("emailMessage", error?.message || "Could not update email.", true);
    } finally {
      submit.disabled = false;
    }
  });

  $("passwordForm").addEventListener("submit", async event => {
    event.preventDefault();
    const submit = event.submitter;
    const currentPassword = $("accountCurrentPassword").value;
    const newPassword = $("accountNewPassword").value;
    const confirmation = $("accountConfirmPassword").value;
    setAccountMessage("passwordMessage", "");
    if (newPassword !== confirmation) {
      setAccountMessage("passwordMessage", "The new passwords do not match.", true);
      return;
    }
    submit.disabled = true;
    try {
      const user = await window.FinanceData.updatePassword(currentPassword, newPassword);
      if (user) applyUserIdentity(user);
      $("passwordForm").reset();
      setAccountMessage("passwordMessage", "Password updated.");
    } catch (error) {
      setAccountMessage("passwordMessage", error?.message || "Could not update password.", true);
    } finally {
      submit.disabled = false;
    }
  });

  $("deleteAccountConfirm").addEventListener("input", event => {
    $("deleteAccountBtn").disabled = event.target.value.trim().toUpperCase() !== "DELETE";
  });

  $("deleteAccountForm").addEventListener("submit", async event => {
    event.preventDefault();
    if ($("deleteAccountConfirm").value.trim().toUpperCase() !== "DELETE") return;
    if (!confirm("Permanently delete this account and all of its saved finance data? This cannot be undone.")) return;

    const submit = event.submitter;
    const original = submit.textContent;
    submit.disabled = true;
    submit.textContent = "Deleting account…";
    setAccountMessage("deleteAccountMessage", "");
    try {
      await window.FinanceData.deleteAccount();
    } catch (error) {
      console.error(error);
      const message = /function|404|not found/i.test(error?.message || "")
        ? "Account deletion is not available yet. Deploy the Supabase delete-account Edge Function included with the project, then try again."
        : (error?.message || "Could not delete account.");
      setAccountMessage("deleteAccountMessage", message, true);
      submit.disabled = false;
      submit.textContent = original;
    }
  });

  $("periodFrom").addEventListener("change", event => {
    periodStartMonth = event.target.value;
    if (periodEndMonth && periodStartMonth > periodEndMonth) periodEndMonth = periodStartMonth;
    renderAll();
    flashRefresh();
  });

  $("periodTo").addEventListener("change", event => {
    periodEndMonth = event.target.value;
    if (periodStartMonth && periodEndMonth < periodStartMonth) periodStartMonth = periodEndMonth;
    renderAll();
    flashRefresh();
  });

  $("periodAllBtn").addEventListener("click", () => {
    const allMonths = months();
    periodStartMonth = allMonths[0] || "";
    periodEndMonth = allMonths[allMonths.length - 1] || "";
    renderAll();
    flashRefresh();
  });

  $("importStatementBtn")?.addEventListener("click", () => { location.href = "import.html?import=1"; });
  $("signOutBtn")?.addEventListener("click", () => window.FinanceData.signOut());
  $("simplifyExportBtn").addEventListener("click", exportSimplifiedTransactions);

  async function clearImportedDataFromDashboard(button) {
    const importedCount = state.transactions.filter(transaction => transaction.sourceKind === "imported").length;
    if (!importedCount && !state.statement) {
      alert("No imported statement to clear.");
      return;
    }

    const message = importedCount
      ? `Clear ${importedCount} imported transaction${importedCount === 1 ? "" : "s"} and the saved statement?\n\nManual transactions, goals, and your budget plan will stay.`
      : "Clear the saved statement?\n\nManual transactions, goals, and your budget plan will stay.";
    if (!confirm(message)) return;

    const buttons = [$("clearImportedBtn"), $("clearStatementTopBtn")].filter(Boolean);
    const labels = new Map(buttons.map(item => [item, item.textContent]));
    buttons.forEach(item => { item.disabled = true; item.textContent = "Clearing…"; });

    try {
      await window.FinanceData.clearImportedData();
      state.transactions = state.transactions.filter(transaction => transaction.sourceKind !== "imported");
      state.statement = null;
      state.sheetRows = [];
      state.maskRules = [];
      initializePeriodRange();
      renderAll();
      flashRefresh();
      if (button) button.textContent = "Cleared";
    } catch (error) {
      console.error(error);
      alert(error?.message || "Could not clear the statement.");
    } finally {
      window.setTimeout(() => {
        buttons.forEach(item => {
          item.disabled = false;
          item.textContent = labels.get(item) || "Clear statement";
        });
      }, 900);
    }
  }

  $("clearImportedBtn").addEventListener("click", event => clearImportedDataFromDashboard(event.currentTarget));
  $("clearStatementTopBtn").addEventListener("click", event => clearImportedDataFromDashboard(event.currentTarget));

  const transactionDialog = $("transactionDialog");
  $("addTransactionBtn").addEventListener("click", () => {
    $("newDate").value = new Date().toISOString().slice(0, 10);
    $("newType").value = "expense";
    $("newCategory").value = "Other Spending";
    setInlineError("transactionError", "");
    transactionDialog.showModal();
  });

  $("newType").addEventListener("change", event => {
    const type = event.target.value;
    $("newCategory").value = type === "income" ? "Income" : type === "reserve" ? "Reserve Transfer" : "Other Spending";
  });

  $("transactionForm").addEventListener("submit", async event => {
    event.preventDefault();
    const submit = event.submitter;
    submit.disabled = true;
    setInlineError("transactionError", "");
    try {
      const type = $("newType").value;
      const raw = Number($("newAmount").value);
      const amount = type === "income" ? raw : -raw;
      const saved = await window.FinanceData.addManualTransaction({
        date: $("newDate").value,
        description: $("newDescription").value.trim(),
        amount,
        category: $("newCategory").value,
        excludeFromSpending: type === "reserve",
        isPayroll: type === "income" && $("newCategory").value === "Income",
        currency: currencyCode()
      });
      state.transactions.push(saved);
      state.transactions.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
      const newMonth = saved.date.slice(0, 7);
      if (!periodEndMonth || newMonth > periodEndMonth) periodEndMonth = newMonth;
      if (!periodStartMonth) periodStartMonth = newMonth;
      transactionDialog.close();
      $("transactionForm").reset();
      renderAll();
      flashRefresh();
    } catch (error) {
      setInlineError("transactionError", error?.message || "Could not save transaction.");
    } finally {
      submit.disabled = false;
    }
  });

  const goalDialog = $("goalDialog");
  $("addGoalBtn").addEventListener("click", () => {
    $("goalForm").reset();
    $("goalCurrentAmount").value = "0";
    renderGoalCategoryOptions();
    setInlineError("goalError", "");
    goalDialog.showModal();
  });

  $("goalForm").addEventListener("submit", async event => {
    event.preventDefault();
    const submit = event.submitter;
    submit.disabled = true;
    setInlineError("goalError", "");
    try {
      const targetAmount = Number($("goalTargetAmount").value);
      const currentAmount = Number($("goalCurrentAmount").value || 0);
      if (currentAmount > targetAmount) throw new Error("Already saved cannot be greater than the target amount when creating a goal.");
      const goal = await window.FinanceData.createGoal({
        name: $("goalName").value.trim(),
        category: $("goalCategory").value,
        targetAmount,
        currentAmount,
        targetDate: $("goalTargetDate").value || null,
        notes: $("goalNotes").value.trim()
      });
      state.goals.push(goal);
      goalDialog.close();
      renderGoals();
      flashRefresh();
    } catch (error) {
      setInlineError("goalError", error?.message || "Could not create goal.");
    } finally {
      submit.disabled = false;
    }
  });

  const goalProgressDialog = $("goalProgressDialog");
  $("goalGrid").addEventListener("click", async event => {
    const progressButton = event.target.closest("[data-goal-progress]");
    const deleteButton = event.target.closest("[data-goal-delete]");

    if (progressButton) {
      const goal = state.goals.find(item => item.id === progressButton.dataset.goalProgress);
      if (!goal) return;
      $("goalProgressId").value = goal.id;
      $("goalProgressTitle").textContent = `Update ${goal.name}`;
      $("goalProgressAmount").value = goal.currentAmount;
      setInlineError("goalProgressError", "");
      goalProgressDialog.showModal();
      return;
    }

    if (deleteButton) {
      const goal = state.goals.find(item => item.id === deleteButton.dataset.goalDelete);
      if (!goal) return;
      if (!confirm(`Delete the saving goal “${goal.name}”?`)) return;
      try {
        await window.FinanceData.deleteGoal(goal.id);
        state.goals = state.goals.filter(item => item.id !== goal.id);
        renderGoals();
      } catch (error) {
        alert(error?.message || "Could not delete goal.");
      }
    }
  });

  $("goalProgressForm").addEventListener("submit", async event => {
    event.preventDefault();
    const submit = event.submitter;
    submit.disabled = true;
    setInlineError("goalProgressError", "");
    try {
      const id = $("goalProgressId").value;
      const currentAmount = Number($("goalProgressAmount").value);
      const updated = await window.FinanceData.setGoalProgress(id, currentAmount);
      const index = state.goals.findIndex(goal => goal.id === id);
      if (index >= 0) state.goals[index] = updated;
      goalProgressDialog.close();
      renderGoals();
      flashRefresh();
    } catch (error) {
      setInlineError("goalProgressError", error?.message || "Could not update goal.");
    } finally {
      submit.disabled = false;
    }
  });

  $("settingsBtn").addEventListener("click", openSettingsDialog);
  $("presetGrid").addEventListener("click", event => {
    const button = event.target.closest("[data-preset-id]");
    if (!button) return;
    const preset = PRESETS.find(item => item.id === button.dataset.presetId);
    if (!preset) return;
    draftCategories = createCategories(preset.categories);
    renderAllocationEditor();
  });

  $("addAllocationBtn").addEventListener("click", () => {
    syncDraftFromEditor();
    draftCategories.push({ id: categoryId(), name: "New category", percent: 0, spendable: false });
    renderAllocationEditor();
    $("allocationEditor").querySelector(".allocation-editor-row:last-child .allocation-name")?.select();
  });

  $("allocationEditor").addEventListener("input", updateAllocationTotal);
  $("allocationEditor").addEventListener("change", updateAllocationTotal);
  $("allocationEditor").addEventListener("click", event => {
    const remove = event.target.closest(".allocation-remove");
    if (!remove) return;
    syncDraftFromEditor();
    const id = remove.closest(".allocation-editor-row").dataset.allocationId;
    draftCategories = draftCategories.filter(category => category.id !== id);
    if (!draftCategories.length) draftCategories.push({ id: categoryId(), name: "Spending", percent: 100, spendable: true });
    renderAllocationEditor();
  });

  $("settingsForm").addEventListener("submit", async event => {
    event.preventDefault();
    syncDraftFromEditor();
    const total = draftCategories.reduce((sum, category) => sum + Number(category.percent || 0), 0);
    const invalid = !draftCategories.length || Math.abs(total - 100) > 0.001 ||
      draftCategories.some(category => !category.name || !Number.isFinite(category.percent) || category.percent < 0 || category.percent > 100);
    if (invalid) {
      $("splitError").hidden = false;
      return;
    }

    const submit = event.submitter;
    submit.disabled = true;
    try {
      const categories = createCategories(draftCategories);
      await window.FinanceData.saveSettings(categories);
      state.settings = { categories };
      $("settingsDialog").close();
      renderAll();
      flashRefresh();
    } catch (error) {
      $("splitError").textContent = error?.message || "Could not save plan.";
      $("splitError").hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelectorAll("[data-close-dialog]").forEach(button =>
    button.addEventListener("click", () => button.closest("dialog").close())
  );

  bootstrap();
})();
