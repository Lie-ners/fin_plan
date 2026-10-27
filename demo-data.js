(() => {
  "use strict";

  const transactions = [
    { id: "demo-001", date: "2026-07-03", description: "Payroll — Northstar Studio", amount: 3000, category: "Income", excludeFromSpending: false, isPayroll: true, sourceCode: "GR", currency: "SGD", sourceKind: "imported" },
    { id: "demo-002", date: "2026-07-04", description: "Transfer to [Savings Account]", amount: -600, category: "Reserve Transfer", excludeFromSpending: true, isPayroll: false, sourceCode: "ADV", currency: "SGD", sourceKind: "imported" },
    { id: "demo-003", date: "2026-07-06", description: "FairPrice", amount: -128.45, category: "Groceries", excludeFromSpending: false, isPayroll: false, sourceCode: "POS", currency: "SGD", sourceKind: "imported" },
    { id: "demo-004", date: "2026-07-10", description: "SimplyGo Transit", amount: -62.30, category: "Transport", excludeFromSpending: false, isPayroll: false, sourceCode: "POS", currency: "SGD", sourceKind: "imported" },
    { id: "demo-005", date: "2026-07-14", description: "Lunch & coffee", amount: -74.20, category: "Food & Drinks", excludeFromSpending: false, isPayroll: false, sourceCode: "POS", currency: "SGD", sourceKind: "imported" },
    { id: "demo-006", date: "2026-07-21", description: "Utilities", amount: -118.60, category: "Other Spending", excludeFromSpending: false, isPayroll: false, sourceCode: "ADV", currency: "SGD", sourceKind: "imported" },
    { id: "demo-007", date: "2026-07-26", description: "Cinema", amount: -38, category: "Shopping", excludeFromSpending: false, isPayroll: false, sourceCode: "POS", currency: "SGD", sourceKind: "imported" },

    { id: "demo-008", date: "2026-08-05", description: "Payroll — Northstar Studio", amount: 3000, category: "Income", excludeFromSpending: false, isPayroll: true, sourceCode: "GR", currency: "SGD", sourceKind: "imported" },
    { id: "demo-009", date: "2026-08-06", description: "Transfer to [Savings Account]", amount: -600, category: "Reserve Transfer", excludeFromSpending: true, isPayroll: false, sourceCode: "ADV", currency: "SGD", sourceKind: "imported" },
    { id: "demo-010", date: "2026-08-08", description: "Cold Storage", amount: -156.80, category: "Groceries", excludeFromSpending: false, isPayroll: false, sourceCode: "POS", currency: "SGD", sourceKind: "imported" },
    { id: "demo-011", date: "2026-08-11", description: "SimplyGo Transit", amount: -71.40, category: "Transport", excludeFromSpending: false, isPayroll: false, sourceCode: "POS", currency: "SGD", sourceKind: "imported" },
    { id: "demo-012", date: "2026-08-15", description: "Restaurant", amount: -92.70, category: "Food & Drinks", excludeFromSpending: false, isPayroll: false, sourceCode: "POS", currency: "SGD", sourceKind: "imported" },
    { id: "demo-013", date: "2026-08-20", description: "Phone bill", amount: -55, category: "Other Spending", excludeFromSpending: false, isPayroll: false, sourceCode: "ADV", currency: "SGD", sourceKind: "imported" },
    { id: "demo-014", date: "2026-08-27", description: "Running shoes", amount: -139, category: "Shopping", excludeFromSpending: false, isPayroll: false, sourceCode: "POS", currency: "SGD", sourceKind: "imported" },

    { id: "demo-015", date: "2026-09-04", description: "Payroll — Northstar Studio", amount: 3150, category: "Income", excludeFromSpending: false, isPayroll: true, sourceCode: "GR", currency: "SGD", sourceKind: "imported" },
    { id: "demo-016", date: "2026-09-05", description: "Transfer to [Savings Account]", amount: -630, category: "Reserve Transfer", excludeFromSpending: true, isPayroll: false, sourceCode: "ADV", currency: "SGD", sourceKind: "imported" },
    { id: "demo-017", date: "2026-09-07", description: "FairPrice", amount: -141.25, category: "Groceries", excludeFromSpending: false, isPayroll: false, sourceCode: "POS", currency: "SGD", sourceKind: "imported" },
    { id: "demo-018", date: "2026-09-12", description: "SimplyGo Transit", amount: -69.80, category: "Transport", excludeFromSpending: false, isPayroll: false, sourceCode: "POS", currency: "SGD", sourceKind: "imported" },
    { id: "demo-019", date: "2026-09-15", description: "Dinner with friends", amount: -126.40, category: "Food & Drinks", excludeFromSpending: false, isPayroll: false, sourceCode: "POS", currency: "SGD", sourceKind: "imported" },
    { id: "demo-020", date: "2026-09-19", description: "Streaming subscriptions", amount: -31.96, category: "Subscriptions", excludeFromSpending: false, isPayroll: false, sourceCode: "POS", currency: "SGD", sourceKind: "imported" },
    { id: "demo-021", date: "2026-09-25", description: "Household items", amount: -88.90, category: "Shopping", excludeFromSpending: false, isPayroll: false, sourceCode: "POS", currency: "SGD", sourceKind: "imported" },

    { id: "demo-022", date: "2026-10-05", description: "Payroll — Northstar Studio", amount: 3150, category: "Income", excludeFromSpending: false, isPayroll: true, sourceCode: "GR", currency: "SGD", sourceKind: "imported" },
    { id: "demo-023", date: "2026-10-06", description: "Transfer to [Savings Account]", amount: -630, category: "Reserve Transfer", excludeFromSpending: true, isPayroll: false, sourceCode: "ADV", currency: "SGD", sourceKind: "imported" },
    { id: "demo-024", date: "2026-10-08", description: "FairPrice", amount: -134.60, category: "Groceries", excludeFromSpending: false, isPayroll: false, sourceCode: "POS", currency: "SGD", sourceKind: "imported" },
    { id: "demo-025", date: "2026-10-10", description: "SimplyGo Transit", amount: -48.20, category: "Transport", excludeFromSpending: false, isPayroll: false, sourceCode: "POS", currency: "SGD", sourceKind: "imported" },
    { id: "demo-026", date: "2026-10-12", description: "Lunch", amount: -58.40, category: "Food & Drinks", excludeFromSpending: false, isPayroll: false, sourceCode: "POS", currency: "SGD", sourceKind: "imported" },
    { id: "demo-027", date: "2026-10-14", description: "AIA Insurance", amount: -104.30, category: "Insurance", excludeFromSpending: false, isPayroll: false, sourceCode: "ADV", currency: "SGD", sourceKind: "imported" },
    { id: "demo-028", date: "2026-10-16", description: "Game purchase", amount: -79.90, category: "Shopping", excludeFromSpending: false, isPayroll: false, sourceCode: "POS", currency: "SGD", sourceKind: "imported" },
    { id: "demo-029", date: "2026-10-18", description: "Interest earned", amount: 2.14, category: "Interest", excludeFromSpending: false, isPayroll: false, sourceCode: "ATINT", currency: "SGD", sourceKind: "imported" }
  ];

  const sheetRows = [
    ["Statement as at", "2026-10-20"],
    ["Currency", "SGD"],
    ["Available Balance", 6425.47],
    ["Ledger Balance", 6425.47],
    ["Source", "demo_statement_oct_2026.pdf"],
    [],
    ["Transaction Date", "Statement Code", "Description", "Currency", "Debit Amount", "Credit Amount"],
    ["2026-10-18", "ATINT", "Interest earned", "SGD", "", 2.14],
    ["2026-10-16", "POS", "Game purchase", "SGD", 79.90, ""],
    ["2026-10-14", "ADV", "AIA Insurance", "SGD", 104.30, ""],
    ["2026-10-12", "POS", "Lunch", "SGD", 58.40, ""],
    ["2026-10-10", "POS", "SimplyGo Transit", "SGD", 48.20, ""],
    ["2026-10-08", "POS", "FairPrice", "SGD", 134.60, ""],
    ["2026-10-06", "ADV", "Transfer to [Savings Account]", "SGD", 630, ""],
    ["2026-10-05", "GR", "Payroll — Northstar Studio", "SGD", "", 3150]
  ];

  const payload = {
    user: {
      id: "demo-user-0000-0000-0000",
      email: "demo@example.com",
      user_metadata: { username: "Demo User", display_name: "Demo User" }
    },
    profile: { userId: "demo-user-0000-0000-0000", username: "Demo User" },
    settings: {
      categories: [
        { id: "demo-spend", name: "Living & Lifestyle", percent: 80, spendable: true },
        { id: "demo-save", name: "Savings", percent: 20, spendable: false }
      ]
    },
    transactions,
    statement: {
      id: "demo-statement",
      fileName: "demo_statement_oct_2026.pdf",
      currencyCode: "SGD",
      statementDate: "2026-10-20",
      availableBalance: 6425.47,
      ledgerBalance: 6425.47,
      sheetRows,
      maskRules: [],
      importedAt: "2026-10-20T12:00:00Z"
    },
    sheetRows,
    maskRules: [],
    goals: [
      { id: "demo-goal-1", name: "Emergency fund", category: "Emergency Fund", targetAmount: 6000, currentAmount: 3600, targetDate: "2027-03-31", notes: "Build a three-month buffer.", status: "active", createdAt: "2026-07-01" },
      { id: "demo-goal-2", name: "Japan trip", category: "Travel", targetAmount: 2500, currentAmount: 1450, targetDate: "2027-06-01", notes: "Flights, hotel and spending money.", status: "active", createdAt: "2026-07-15" },
      { id: "demo-goal-3", name: "New laptop", category: "Electronics & Gaming", targetAmount: 2200, currentAmount: 900, targetDate: "2027-02-01", notes: "Replace the current laptop.", status: "active", createdAt: "2026-08-10" }
    ]
  };

  function clone(value) {
    if (globalThis.structuredClone) return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  let demoState = clone(payload);
  let manualSequence = 0;
  let goalSequence = 0;

  function nowIso() { return new Date().toISOString(); }

  window.FinanceDemoData = {
    loadDashboardData() {
      return clone(demoState);
    }
  };

  // In-memory stand-in for the real Supabase data layer. The shared dashboard
  // can therefore exercise its normal editing flows without authentication.
  window.FinanceData = {
    async saveSettings(categories) {
      demoState.settings = { categories: clone(categories || []) };
    },

    async addManualTransaction(transaction) {
      manualSequence += 1;
      const saved = {
        id: `demo-manual-${manualSequence}`,
        date: transaction.date,
        description: transaction.description || "Transaction",
        amount: Number(transaction.amount || 0),
        category: transaction.category || "Other Spending",
        excludeFromSpending: Boolean(transaction.excludeFromSpending),
        isPayroll: Boolean(transaction.isPayroll),
        sourceCode: "MANUAL",
        currency: transaction.currency || "SGD",
        sourceKind: "manual",
        statementId: null,
        createdAt: nowIso()
      };
      demoState.transactions.push(saved);
      return clone(saved);
    },

    async createGoal(goal) {
      goalSequence += 1;
      const saved = {
        id: `demo-created-goal-${goalSequence}`,
        name: goal.name,
        category: goal.category,
        targetAmount: Number(goal.targetAmount || 0),
        currentAmount: Number(goal.currentAmount || 0),
        targetDate: goal.targetDate || null,
        notes: goal.notes || "",
        status: "active",
        createdAt: nowIso()
      };
      demoState.goals.push(saved);
      return clone(saved);
    },

    async setGoalProgress(goalId, currentAmount) {
      const goal = demoState.goals.find(item => item.id === goalId);
      if (!goal) throw new Error("Goal not found.");
      goal.currentAmount = Number(currentAmount || 0);
      goal.status = goal.currentAmount >= goal.targetAmount ? "completed" : "active";
      return clone(goal);
    },

    async deleteGoal(goalId) {
      demoState.goals = demoState.goals.filter(item => item.id !== goalId);
    },

    async clearImportedData() {
      demoState.transactions = demoState.transactions.filter(item => item.sourceKind !== "imported");
      demoState.statement = null;
      demoState.sheetRows = [];
      demoState.maskRules = [];
    },

    async updateUsername(username) {
      demoState.profile.username = String(username || "").trim() || demoState.profile.username;
      demoState.user.user_metadata.username = demoState.profile.username;
      demoState.user.user_metadata.display_name = demoState.profile.username;
      return { user: clone(demoState.user), profile: clone(demoState.profile) };
    },

    async updateEmail(email) {
      demoState.user.email = String(email || demoState.user.email);
      return clone(demoState.user);
    },

    async updatePassword() {
      return clone(demoState.user);
    },

    async deleteAccount() {
      throw new Error("Account deletion is disabled in demo mode.");
    },

    async signOut() {
      location.href = "index.html";
    }
  };
})();
