(() => {
  "use strict";

  const SETTINGS_KEY = "financeTracker-flexible-settings-v3";
  const LEGACY_SETTINGS_KEY = "financeTracker502525-settings-v2";
  const SESSION_KEY = "financeTracker502525-currentStatement-v1";
  const CATEGORY_OPTIONS = [
    "Food & Drinks", "Groceries", "Transport", "Shopping", "Health & Personal",
    "Insurance", "Subscriptions", "Cash", "PayNow / QR", "Other Spending",
    "Reserve Transfer", "Income", "Refund", "Interest", "Other Inflow"
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
      description: "Keeps the tracker’s original split, but now each category can be renamed, removed, or expanded.",
      categories: [
        { name: "Spending", percent: 50, spendable: true },
        { name: "Savings", percent: 25, spendable: false },
        { name: "Investing", percent: 25, spendable: false }
      ]
    }
  ];

  const defaultSettings = { categories: createCategories(PRESETS[3].categories) };
  let state = {
    settings: loadSettings(),
    transactions: [],
    statement: null,
    sheetRows: [],
    maskRules: []
  };
  let activePeriod = "all";
  let draftCategories = [];

  const $ = id => document.getElementById(id);
  const uploadInput = $("statementUpload");

  function categoryId() {
    if (globalThis.crypto?.randomUUID) return `allocation-${crypto.randomUUID()}`;
    return `allocation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function createCategories(categories) {
    return categories.map(category => ({
      id: category.id || categoryId(),
      name: String(category.name || "").trim(),
      percent: Number(category.percent || 0),
      spendable: Boolean(category.spendable)
    }));
  }

  function validSettings(settings) {
    if (!Array.isArray(settings?.categories) || !settings.categories.length) return false;
    const total = settings.categories.reduce((sum, category) => sum + Number(category?.percent || 0), 0);
    return Math.abs(total - 100) < 0.001 && settings.categories.every(category =>
      String(category?.name || "").trim() && Number.isFinite(Number(category?.percent)) && Number(category.percent) >= 0
    );
  }

  function loadSettings() {
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

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  function allocationCategories() {
    return state.settings.categories || [];
  }

  function spendablePercent() {
    return allocationCategories().filter(category => category.spendable).reduce((sum, category) => sum + category.percent, 0);
  }

  function reservePercent() {
    return allocationCategories().filter(category => !category.spendable).reduce((sum, category) => sum + category.percent, 0);
  }

  function currencyCode() {
    return state.statement?.currencyCode || "SGD";
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
    return new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${iso}T00:00:00`));
  }

  function monthFmt(ym) {
    if (!ym || ym === "all") return "All";
    return new Intl.DateTimeFormat("en-SG", { month: "short", year: "2-digit" }).format(new Date(`${ym}-01T00:00:00`));
  }

  function months() {
    return [...new Set(state.transactions.map(t => t.date.slice(0, 7)))].sort();
  }

  function inActivePeriod(t) {
    return activePeriod === "all" || t.date.startsWith(activePeriod);
  }

  function periodTransactions() {
    return state.transactions.filter(inActivePeriod);
  }

  function isDebit(t) { return t.amount < 0; }
  function isCredit(t) { return t.amount > 0; }
  function isPayroll(t) { return t.category === "Income" || t.isPayroll; }
  function countsAsSpend(t) { return isDebit(t) && !t.excludeFromSpending; }
  function isReserve(t) { return isDebit(t) && t.excludeFromSpending; }

  function metrics(list) {
    const payroll = list.filter(t => isCredit(t) && isPayroll(t)).reduce((sum, t) => sum + t.amount, 0);
    const spending = list.filter(countsAsSpend).reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const reserve = list.filter(isReserve).reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const spendTarget = payroll * spendablePercent() / 100;
    const reserveTarget = payroll * reservePercent() / 100;
    const targets = allocationCategories().map(category => ({
      ...category,
      target: payroll * category.percent / 100
    }));
    return { payroll, spending, reserve, spendTarget, reserveTarget, targets, remaining: spendTarget - spending };
  }

  function renderPeriodOptions() {
    const allMonths = months();
    const current = activePeriod;
    $("periodSelect").innerHTML = `<option value="all">All statement data</option>` + allMonths.slice().reverse().map(month => `<option value="${month}">${monthFmt(month)}</option>`).join("");
    $("periodSelect").value = allMonths.includes(current) || current === "all" ? current : "all";
  }

  function renderStatementMeta() {
    const txs = state.transactions;
    const first = txs[0]?.date;
    const last = txs[txs.length - 1]?.date;
    const st = state.statement || {};
    $("rangeMeta").textContent = first && last ? `${dateFmt(first)} – ${dateFmt(last)}` : "—";
    $("availableMeta").textContent = st.availableBalance != null ? money(st.availableBalance) : "—";
    $("statementDateMeta").textContent = dateFmt(st.statementDate);
    $("snapshotBalance").textContent = st.availableBalance != null ? money(st.availableBalance) : "—";
    $("snapshotDate").textContent = st.statementDate ? `as at ${dateFmt(st.statementDate)}` : "No statement date found";
    $("footerMeta").textContent = first && last
      ? `Imported statement range: ${dateFmt(first)} – ${dateFmt(last)}. Source rows and transactions stay only in this tab session.`
      : "No statement loaded in this tab session.";
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
      ? `${diff >= 0 ? money(diff) + " above" : money(Math.abs(diff)) + " below"} non-spendable target`
      : "No non-spendable allocation target";
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
    if (spendablePercent() === 0) {
      message.textContent = "No allocation categories are marked as spendable. Edit the plan and mark one or more categories as spendable to track an allowance.";
    } else if (m.payroll === 0 && m.spending > 0) {
      message.textContent = "There is spending in this month but no payroll credit in the same month. Use the all-data view for a rolling picture, or manually add income if it was paid elsewhere.";
    } else if (m.remaining < 0) {
      message.textContent = `Spending is ${money(Math.abs(m.remaining))} above the selected period's combined spendable allocation.`;
    } else {
      message.textContent = `${money(m.remaining)} remains from the selected period's combined spendable allocation.`;
    }
  }

  function renderMonthlyChart() {
    const allMonths = months();
    const data = allMonths.map(month => {
      const list = state.transactions.filter(t => t.date.startsWith(month));
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
    }).join("") + `<div class="chart-legend" style="grid-column:1/-1"><span><i class="legend-dot allowance-dot"></i>Spendable allowance</span><span><i class="legend-dot spending-dot"></i>Spending</span></div>` : `<div class="empty">Upload a statement to see monthly trends.</div>`;
  }

  function payrollSource(description) {
    return description.replace(/^Payroll\s*—\s*/i, "") || "Payroll";
  }

  function renderPaychecks() {
    const categories = allocationCategories();
    const paychecks = periodTransactions().filter(t => isCredit(t) && isPayroll(t)).sort((a, b) => b.date.localeCompare(a.date));
    $("paycheckCount").textContent = `${paychecks.length} paycheck${paychecks.length === 1 ? "" : "s"}`;
    $("paycheckTable").style.minWidth = `${Math.max(780, 390 + categories.length * 135)}px`;
    $("paycheckHeader").innerHTML = `<th>Date</th><th>Payroll source</th><th>Gross</th>` + categories.map(category => `<th>${escapeHtml(category.name)}</th>`).join("");
    $("paycheckRows").innerHTML = paychecks.length ? paychecks.map(t => `<tr>
      <td>${dateFmt(t.date)}</td><td>${escapeHtml(payrollSource(t.description))}</td><td class="amount positive">${money(t.amount)}</td>
      ${categories.map(category => `<td>${money(t.amount * category.percent / 100)}</td>`).join("")}
    </tr>`).join("") : `<tr><td colspan="${3 + categories.length}" class="empty">No payroll credits detected in this period.</td></tr>`;
  }

  function renderManualCategoryOptions() {
    const used = [...new Set([...CATEGORY_OPTIONS, ...state.transactions.map(t => t.category)])].sort();
    $("newCategory").innerHTML = used.map(category => `<option value="${escapeAttr(category)}">${escapeHtml(category)}</option>`).join("");
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
      return values.includes("transactiondate") && values.includes("description") && (values.includes("debitamount") || values.includes("creditamount"));
    });
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
    const rows = Array.isArray(state.sheetRows) ? state.sheetRows : [];
    if (!rows.length) {
      $("sheetDimensions").textContent = "Preview unavailable";
      $("sheetTable").innerHTML = `<tbody><tr><td class="sheet-empty">Re-upload the statement once to populate the source spreadsheet preview. Older tab sessions created before this viewer was added do not contain the original worksheet rows.</td></tr></tbody>`;
      return;
    }

    const maxColumns = Math.max(1, ...rows.map(row => Array.isArray(row) ? row.length : 0));
    const headerIndex = sheetHeaderIndex(rows);
    const headerRow = headerIndex >= 0 ? rows[headerIndex] : [];
    const dateColumns = new Set(headerRow.map((value, index) => normalizeSheetHeader(value).includes("date") ? index : -1).filter(index => index >= 0));
    $("sheetDimensions").textContent = `${rows.length} rows · ${maxColumns} columns`;

    const columnHeaders = Array.from({ length: maxColumns }, (_, index) => `<th scope="col" class="sheet-column-letter">${excelColumnName(index)}</th>`).join("");
    const body = rows.map((row, rowIndex) => {
      const cells = Array.from({ length: maxColumns }, (_, colIndex) => {
        const text = formattedSheetCell(row?.[colIndex], rowIndex, colIndex, headerIndex, dateColumns, row);
        const className = rowIndex === headerIndex ? "sheet-data-header" : "";
        return `<td class="${className}"><span>${text ? escapeHtml(text) : "&nbsp;"}</span></td>`;
      }).join("");
      return `<tr class="${rowIndex === headerIndex ? "sheet-source-header" : ""}"><th scope="row" class="sheet-row-number">${rowIndex + 1}</th>${cells}</tr>`;
    }).join("");

    $("sheetTable").innerHTML = `<thead><tr><th class="sheet-corner" aria-label="Row and column headings"></th>${columnHeaders}</tr></thead><tbody>${body}</tbody>`;
  }

  function renderAll() {
    renderPeriodOptions();
    renderStatementMeta();
    renderKpis();
    renderAllocation();
    renderMonthlyChart();
    renderPaychecks();
    renderManualCategoryOptions();
    renderSheet();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function formatPercent(value, includeSymbol = true) {
    const n = Number(value || 0);
    const text = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
    return includeSymbol ? `${text}%` : text;
  }

  function persistCurrentSession() {
    if (!state.transactions.length) return;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      statement: state.statement,
      transactions: state.transactions,
      sheetRows: state.sheetRows || [],
      maskRules: state.maskRules || []
    }));
  }

  function loadImportedStatement() {
    try {
      const imported = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (!imported?.transactions?.length) throw new Error("No uploaded statement found.");
      state.transactions = imported.transactions;
      state.statement = imported.statement || null;
      state.sheetRows = imported.sheetRows || [];
      state.maskRules = imported.maskRules || [];
      activePeriod = months().slice(-1)[0] || "all";
      renderAll();
      requestAnimationFrame(() => document.documentElement.classList.add("app-ready"));
    } catch (_) {
      window.location.replace("index.html");
    }
  }

  async function handleReplacementFile(file) {
    if (!file) return;
    try {
      const { readStatementRows, importStatementFromRows } = window.FinanceStatementParser;
      const rows = await readStatementRows(file);
      const imported = importStatementFromRows(rows, file.name, state.maskRules || []);
      if (!imported.transactions.length) throw new Error("No transactions were found.");
      imported.maskRules = state.maskRules || [];
      state.transactions = imported.transactions;
      state.statement = imported.statement || null;
      state.sheetRows = imported.sheetRows || [];
      activePeriod = months().slice(-1)[0] || "all";
      persistCurrentSession();
      renderAll();
      flashRefresh();
    } catch (error) {
      console.error(error);
      alert(error?.message || "Could not read this file. Try exporting the statement as CSV.");
    } finally {
      uploadInput.value = "";
    }
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

  uploadInput.addEventListener("change", event => handleReplacementFile(event.target.files?.[0]));
  $("uploadAnotherBtn").addEventListener("click", () => { window.location.href = "index.html"; });
  $("clearStatementBtn").addEventListener("click", () => {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = "index.html";
  });
  $("periodSelect").addEventListener("change", event => {
    activePeriod = event.target.value;
    renderAll();
    flashRefresh();
  });

  const txDialog = $("transactionDialog");
  $("addTransactionBtn").addEventListener("click", () => {
    $("newDate").value = new Date().toISOString().slice(0, 10);
    $("newType").value = "expense";
    $("newCategory").value = "Other Spending";
    txDialog.showModal();
  });
  $("newType").addEventListener("change", event => {
    const type = event.target.value;
    $("newCategory").value = type === "income" ? "Income" : type === "reserve" ? "Reserve Transfer" : "Other Spending";
  });
  $("transactionForm").addEventListener("submit", event => {
    event.preventDefault();
    const type = $("newType").value;
    const raw = Number($("newAmount").value);
    const amount = type === "income" ? raw : -raw;
    state.transactions.push({
      id: `manual-${Date.now()}`,
      date: $("newDate").value,
      description: $("newDescription").value.trim(),
      amount,
      category: $("newCategory").value,
      excludeFromSpending: type === "reserve",
      isPayroll: type === "income" && $("newCategory").value === "Income",
      sourceCode: "MANUAL",
      currency: currencyCode()
    });
    state.transactions.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    txDialog.close();
    $("transactionForm").reset();
    persistCurrentSession();
    renderAll();
    flashRefresh();
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
  $("settingsForm").addEventListener("submit", event => {
    event.preventDefault();
    syncDraftFromEditor();
    const total = draftCategories.reduce((sum, category) => sum + Number(category.percent || 0), 0);
    const invalid = !draftCategories.length || Math.abs(total - 100) > 0.001 || draftCategories.some(category => !category.name || !Number.isFinite(category.percent) || category.percent < 0 || category.percent > 100);
    if (invalid) {
      $("splitError").hidden = false;
      return;
    }
    state.settings = { categories: createCategories(draftCategories) };
    saveSettings();
    $("settingsDialog").close();
    renderAll();
    flashRefresh();
  });

  document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));

  loadImportedStatement();
})();
