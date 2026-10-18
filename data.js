(() => {
  "use strict";

  function client() {
    if (!window.FinanceSupabaseConfig?.configured || !window.financeSupabase) {
      throw new Error("Supabase is not configured. Update supabase-config.js first.");
    }
    return window.financeSupabase;
  }

  function loginUrl() {
    const current = `${location.pathname.split("/").pop() || "index.html"}${location.search || ""}`;
    return `login.html?returnTo=${encodeURIComponent(current)}`;
  }

  async function currentUser() {
    const { data, error } = await client().auth.getUser();
    if (error) throw error;
    return data.user || null;
  }

  async function requireUser() {
    const user = await currentUser();
    if (!user) {
      location.replace(loginUrl());
      throw new Error("Authentication required.");
    }
    return user;
  }

  function mapTransaction(row) {
    return {
      id: row.id,
      date: row.transaction_date,
      description: row.description || "Transaction",
      amount: Number(row.amount || 0),
      category: row.category || "Other Spending",
      excludeFromSpending: Boolean(row.exclude_from_spending),
      isPayroll: Boolean(row.is_payroll),
      sourceCode: row.source_code || "",
      currency: row.currency || "SGD",
      sourceKind: row.source_kind || "imported",
      statementId: row.statement_id || null,
      createdAt: row.created_at || null
    };
  }

  function mapStatement(row) {
    if (!row) return null;
    return {
      id: row.id,
      fileName: row.file_name || "Statement",
      currencyCode: row.currency_code || "SGD",
      statementDate: row.statement_date || null,
      availableBalance: row.available_balance == null ? null : Number(row.available_balance),
      ledgerBalance: row.ledger_balance == null ? null : Number(row.ledger_balance),
      sheetRows: Array.isArray(row.sheet_rows) ? row.sheet_rows : [],
      maskRules: Array.isArray(row.mask_rules) ? row.mask_rules : [],
      importedAt: row.imported_at || null
    };
  }

  function mapGoal(row) {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      targetAmount: Number(row.target_amount || 0),
      currentAmount: Number(row.current_amount || 0),
      targetDate: row.target_date || null,
      notes: row.notes || "",
      status: row.status || "active",
      createdAt: row.created_at || null
    };
  }

  async function hasTransactions() {
    const user = await requireUser();
    const { count, error } = await client()
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    if (error) throw error;
    return Number(count || 0) > 0;
  }

  async function loadDashboardData() {
    const user = await requireUser();
    const db = client();

    const [transactionResult, settingsResult, statementResult, goalsResult] = await Promise.all([
      db.from("transactions")
        .select("*")
        .eq("user_id", user.id)
        .order("transaction_date", { ascending: true })
        .order("created_at", { ascending: true }),
      db.from("finance_settings")
        .select("categories")
        .eq("user_id", user.id)
        .maybeSingle(),
      db.from("statements")
        .select("*")
        .eq("user_id", user.id)
        .order("statement_date", { ascending: false })
        .order("imported_at", { ascending: false })
        .limit(1),
      db.from("saving_goals")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
    ]);

    for (const result of [transactionResult, settingsResult, statementResult, goalsResult]) {
      if (result.error) throw result.error;
    }

    const statement = mapStatement(statementResult.data?.[0] || null);

    return {
      user,
      transactions: (transactionResult.data || []).map(mapTransaction),
      settings: settingsResult.data?.categories ? { categories: settingsResult.data.categories } : null,
      statement,
      sheetRows: statement?.sheetRows || [],
      maskRules: statement?.maskRules || [],
      goals: (goalsResult.data || []).map(mapGoal)
    };
  }

  async function saveSettings(categories) {
    const user = await requireUser();
    const { error } = await client()
      .from("finance_settings")
      .upsert({
        user_id: user.id,
        categories,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id" });
    if (error) throw error;
  }

  async function importStatement(imported) {
    const user = await requireUser();
    const db = client();
    const st = imported.statement || {};

    const { data: statement, error: statementError } = await db
      .from("statements")
      .insert({
        user_id: user.id,
        file_name: st.fileName || "Statement",
        currency_code: st.currencyCode || "SGD",
        statement_date: st.statementDate || null,
        available_balance: st.availableBalance ?? null,
        ledger_balance: st.ledgerBalance ?? null,
        sheet_rows: imported.sheetRows || [],
        mask_rules: imported.maskRules || []
      })
      .select("id")
      .single();

    if (statementError) throw statementError;

    const rows = (imported.transactions || []).map(transaction => ({
      user_id: user.id,
      statement_id: statement.id,
      transaction_date: transaction.date,
      description: transaction.description || "Transaction",
      amount: Number(transaction.amount || 0),
      category: transaction.category || "Other Spending",
      exclude_from_spending: Boolean(transaction.excludeFromSpending),
      is_payroll: Boolean(transaction.isPayroll),
      source_code: transaction.sourceCode || "",
      currency: transaction.currency || st.currencyCode || "SGD",
      source_kind: "imported",
      source_ref: String(transaction.id || "")
    }));

    try {
      for (let start = 0; start < rows.length; start += 500) {
        const { error } = await db.from("transactions").insert(rows.slice(start, start + 500));
        if (error) throw error;
      }
    } catch (error) {
      await db.from("statements").delete().eq("id", statement.id).eq("user_id", user.id);
      throw error;
    }

    return statement.id;
  }

  async function addManualTransaction(transaction) {
    const user = await requireUser();
    const { data, error } = await client()
      .from("transactions")
      .insert({
        user_id: user.id,
        statement_id: null,
        transaction_date: transaction.date,
        description: transaction.description,
        amount: Number(transaction.amount),
        category: transaction.category,
        exclude_from_spending: Boolean(transaction.excludeFromSpending),
        is_payroll: Boolean(transaction.isPayroll),
        source_code: "MANUAL",
        currency: transaction.currency || "SGD",
        source_kind: "manual"
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapTransaction(data);
  }

  async function createGoal(goal) {
    const user = await requireUser();
    const { data, error } = await client()
      .from("saving_goals")
      .insert({
        user_id: user.id,
        name: goal.name,
        category: goal.category,
        target_amount: Number(goal.targetAmount),
        current_amount: Number(goal.currentAmount || 0),
        target_date: goal.targetDate || null,
        notes: goal.notes || "",
        status: "active"
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapGoal(data);
  }

  async function setGoalProgress(goalId, currentAmount) {
    const user = await requireUser();
    const { data, error } = await client()
      .from("saving_goals")
      .update({
        current_amount: Number(currentAmount),
        updated_at: new Date().toISOString()
      })
      .eq("id", goalId)
      .eq("user_id", user.id)
      .select("*")
      .single();
    if (error) throw error;
    return mapGoal(data);
  }

  async function deleteGoal(goalId) {
    const user = await requireUser();
    const { error } = await client()
      .from("saving_goals")
      .delete()
      .eq("id", goalId)
      .eq("user_id", user.id);
    if (error) throw error;
  }

  async function signOut() {
    const { error } = await client().auth.signOut();
    if (error) throw error;
    location.replace("login.html");
  }

  window.FinanceData = {
    currentUser,
    requireUser,
    hasTransactions,
    loadDashboardData,
    saveSettings,
    importStatement,
    addManualTransaction,
    createGoal,
    setGoalProgress,
    deleteGoal,
    signOut
  };
})();
