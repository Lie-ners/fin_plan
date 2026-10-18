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
    return `index.html?returnTo=${encodeURIComponent(current)}`;
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
    const amount = Number(row.amount || 0);
    const sourceKind = row.source_kind || "imported";
    const rawDescription = row.description || "Transaction";

    // Repair rows imported by the first PDF parser version. DBS/POSB's PDF
    // history exposes recurring base-account transfers as TRF FT...:IB (OCR
    // can render IB as 1B). Those rows were previously saved as spending.
    const legacyPdfReserve = sourceKind === "imported" && amount < 0 &&
      /^trf\s+ft[0-9a-z]+.*:\s*[i1]b\b/i.test(String(rawDescription));

    return {
      id: row.id,
      date: row.transaction_date,
      description: legacyPdfReserve ? "Transfer to other bank account" : rawDescription,
      amount,
      category: legacyPdfReserve ? "Reserve Transfer" : (row.category || "Other Spending"),
      excludeFromSpending: legacyPdfReserve || Boolean(row.exclude_from_spending),
      isPayroll: Boolean(row.is_payroll),
      sourceCode: row.source_code || "",
      currency: row.currency || "SGD",
      sourceKind,
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

  function mapProfile(row) {
    if (!row) return null;
    return {
      userId: row.user_id,
      username: String(row.username || "").trim(),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    };
  }

  async function getProfile(userId = null) {
    const user = userId ? null : await requireUser();
    const id = userId || user.id;
    const { data, error } = await client()
      .from("profiles")
      .select("user_id,username,created_at,updated_at")
      .eq("user_id", id)
      .maybeSingle();
    if (error) throw error;
    return mapProfile(data);
  }

  async function getAccountIdentity() {
    const user = await requireUser();
    const profile = await getProfile(user.id);
    return { user, profile };
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

    const [transactionResult, settingsResult, statementResult, goalsResult, profileResult] = await Promise.all([
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
        .order("created_at", { ascending: true }),
      db.from("profiles")
        .select("user_id,username,created_at,updated_at")
        .eq("user_id", user.id)
        .maybeSingle()
    ]);

    for (const result of [transactionResult, settingsResult, statementResult, goalsResult, profileResult]) {
      if (result.error) throw result.error;
    }

    const statement = mapStatement(statementResult.data?.[0] || null);

    return {
      user,
      profile: mapProfile(profileResult.data),
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

  function importedTransactionSignature(row) {
    const date = String(row.transaction_date ?? row.date ?? "").trim();
    const numericAmount = Number(row.amount || 0);
    let description = String(row.description || "Transaction").trim().replace(/\s+/g, " ").toLowerCase();
    if (numericAmount < 0 && /^trf\s+ft[0-9a-z]+.*:\s*[i1]b\b/i.test(description)) {
      description = "transfer to other bank account";
    }
    const amount = numericAmount.toFixed(2);
    const sourceCode = String(row.source_code ?? row.sourceCode ?? "").trim().toUpperCase();
    const currency = String(row.currency || "SGD").trim().toUpperCase();
    return [date, amount, currency, sourceCode, description].join("|");
  }

  async function existingImportedSignatureCounts(db, userId) {
    const counts = new Map();
    const pageSize = 1000;

    for (let start = 0; ; start += pageSize) {
      const { data, error } = await db
        .from("transactions")
        .select("transaction_date,description,amount,source_code,currency")
        .eq("user_id", userId)
        .eq("source_kind", "imported")
        .range(start, start + pageSize - 1);

      if (error) throw error;
      for (const row of data || []) {
        const signature = importedTransactionSignature(row);
        counts.set(signature, (counts.get(signature) || 0) + 1);
      }
      if (!data || data.length < pageSize) break;
    }

    return counts;
  }

  async function importStatement(imported) {
    const user = await requireUser();
    const db = client();
    const st = imported.statement || {};
    const existingCounts = await existingImportedSignatureCounts(db, user.id);

    const candidateRows = (imported.transactions || []).map(transaction => ({
      user_id: user.id,
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

    const rowsToInsert = [];
    let skippedDuplicates = 0;
    for (const row of candidateRows) {
      const signature = importedTransactionSignature(row);
      const existing = existingCounts.get(signature) || 0;
      if (existing > 0) {
        existingCounts.set(signature, existing - 1);
        skippedDuplicates++;
      } else {
        rowsToInsert.push(row);
      }
    }

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

    const rows = rowsToInsert.map(row => ({ ...row, statement_id: statement.id }));

    try {
      for (let start = 0; start < rows.length; start += 500) {
        const { error } = await db.from("transactions").insert(rows.slice(start, start + 500));
        if (error) throw error;
      }
    } catch (error) {
      await db.from("statements").delete().eq("id", statement.id).eq("user_id", user.id);
      throw error;
    }

    return { statementId: statement.id, insertedCount: rows.length, skippedDuplicates };
  }

  async function clearImportedData() {
    const user = await requireUser();
    const db = client();

    const { error: transactionError } = await db
      .from("transactions")
      .delete()
      .eq("user_id", user.id)
      .eq("source_kind", "imported");
    if (transactionError) throw transactionError;

    const { error: statementError } = await db
      .from("statements")
      .delete()
      .eq("user_id", user.id);
    if (statementError) throw statementError;
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

  async function updateUsername(username) {
    const user = await requireUser();
    const clean = String(username || "").trim();
    if (clean.length < 2 || clean.length > 40) {
      throw new Error("Username must be between 2 and 40 characters.");
    }

    const { data: profileRow, error: profileError } = await client()
      .from("profiles")
      .update({ username: clean, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .select("user_id,username,created_at,updated_at")
      .single();

    if (profileError) {
      if (profileError.code === "23505" || /unique|duplicate/i.test(profileError.message || "")) {
        throw new Error("That username is already in use. Choose another username.");
      }
      throw profileError;
    }

    // Keep Auth metadata in sync for compatibility with older screens. The
    // public profile row remains the source of truth for username uniqueness.
    let updatedUser = user;
    try {
      const metadata = {
        ...(user.user_metadata || {}),
        username: clean,
        display_name: clean
      };
      const { data, error } = await client().auth.updateUser({ data: metadata });
      if (!error && data.user) updatedUser = data.user;
    } catch (_) {}

    return { user: updatedUser, profile: mapProfile(profileRow) };
  }

  async function updateEmail(email) {
    await requireUser();
    const clean = String(email || "").trim().toLowerCase();
    if (!clean) throw new Error("Enter a valid email address.");
    const { data, error } = await client().auth.updateUser({ email: clean });
    if (error) throw error;
    return data.user || await currentUser();
  }

  async function updatePassword(currentPassword, newPassword) {
    await requireUser();
    const next = String(newPassword || "");
    if (next.length < 8) throw new Error("New password must be at least 8 characters.");

    const attributes = { password: next };
    const current = String(currentPassword || "");
    if (current) attributes.current_password = current;

    const { data, error } = await client().auth.updateUser(attributes);
    if (error) throw error;
    return data.user || await currentUser();
  }

  async function deleteAccount() {
    await requireUser();
    const { data, error } = await client().functions.invoke("delete-account", {
      body: { confirmation: "DELETE" }
    });

    if (error) {
      let message = error.message || "Could not delete account.";
      try {
        const body = await error.context?.json?.();
        if (body?.error) message = body.error;
      } catch (_) {}
      throw new Error(message);
    }
    if (!data?.deleted) throw new Error("Account deletion did not complete.");

    try { await client().auth.signOut({ scope: "local" }); } catch (_) {}
    location.replace("index.html?accountDeleted=1");
  }

  async function signOut() {
    const { error } = await client().auth.signOut();
    if (error) throw error;
    location.replace("index.html");
  }

  window.FinanceData = {
    currentUser,
    requireUser,
    getProfile,
    getAccountIdentity,
    hasTransactions,
    loadDashboardData,
    saveSettings,
    importStatement,
    clearImportedData,
    addManualTransaction,
    createGoal,
    setGoalProgress,
    deleteGoal,
    updateUsername,
    updateEmail,
    updatePassword,
    deleteAccount,
    signOut
  };
})();
