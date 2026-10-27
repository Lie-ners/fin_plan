(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const uploadInput = $("statementUpload");
  const dropZone = $("dropZone");
  const maskRows = $("maskRows");
  const addMaskBtn = $("addMaskBtn");
  const mainAccountIdentifier = $("mainAccountIdentifier");
  const savingsAccountIdentifier = $("savingsAccountIdentifier");
  const proceedImportBtn = $("proceedImportBtn");
  const importStep = $("importStep");
  const continueBtn = $("continueSessionBtn");
  const dashboardLink = $("dashboardLink");
  const signOutBtn = $("signOutBtn");
  const importProgress = $("importProgress");
  const importProgressTitle = $("importProgressTitle");
  const importProgressValue = $("importProgressValue");
  const importProgressBar = $("importProgressBar");
  const importProgressDetail = $("importProgressDetail");

  function setUploadError(message) {
    const el = $("uploadError");
    el.hidden = !message;
    el.textContent = message || "";
  }


  function setImportProgress(update = null) {
    if (!importProgress) return;
    if (!update) {
      importProgress.hidden = true;
      importProgressBar.style.width = "0%";
      importProgressValue.textContent = "0%";
      return;
    }

    const progress = Math.max(0, Math.min(1, Number(update.progress ?? 0)));
    const percent = Math.round(progress * 100);
    importProgress.hidden = false;
    importProgressTitle.textContent = update.message || "Reading statement…";
    importProgressValue.textContent = `${percent}%`;
    importProgressBar.style.width = `${percent}%`;
    importProgressDetail.textContent = update.detail || "Your statement is being processed on this device.";
  }

  function createMaskRow(needle = "", replacement = "") {
    const row = document.createElement("div");
    row.className = "mask-row";
    row.innerHTML = `
      <label>Text to hide
        <input class="mask-needle" type="text" autocomplete="off" placeholder="e.g. card fragment or name" value="${escapeAttr(needle)}" />
      </label>
      <label>Replace with
        <input class="mask-replacement" type="text" autocomplete="off" placeholder="e.g. [Card]" value="${escapeAttr(replacement)}" />
      </label>
      <button class="icon-button mask-remove" type="button" aria-label="Remove mask rule">×</button>
    `;
    row.querySelector(".mask-remove").addEventListener("click", () => row.remove());
    maskRows.appendChild(row);
  }

  function addMaskRow() {
    createMaskRow("", "");
  }

  function normalizeAccountIdentifier(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function getAccountDefinitions() {
    const mainAccount = mainAccountIdentifier?.value.trim() || "";
    const savingsAccount = savingsAccountIdentifier?.value.trim() || "";
    const normalizedMain = normalizeAccountIdentifier(mainAccount);
    const normalizedSavings = normalizeAccountIdentifier(savingsAccount);

    if (mainAccount && normalizedMain.length < 4) {
      throw new Error("Main account identifier is too short. Enter at least 4 letters or digits, or leave it blank.");
    }
    if (savingsAccount && normalizedSavings.length < 4) {
      throw new Error("Savings account identifier is too short. Enter at least 4 letters or digits, or leave it blank.");
    }
    if (normalizedMain && normalizedSavings && normalizedMain === normalizedSavings) {
      throw new Error("Main account and savings account identifiers must be different.");
    }

    return { mainAccount, savingsAccount };
  }

  function getMaskRules(accountDefinitions) {
    const rules = [];
    if (accountDefinitions.mainAccount) {
      rules.push({
        needle: accountDefinitions.mainAccount,
        replacement: "[Main Account]",
        matchMode: "account"
      });
    }
    if (accountDefinitions.savingsAccount) {
      rules.push({
        needle: accountDefinitions.savingsAccount,
        replacement: "[Savings Account]",
        matchMode: "account"
      });
    }

    rules.push(...Array.from(maskRows.querySelectorAll(".mask-row"))
      .map(row => ({
        needle: row.querySelector(".mask-needle")?.value.trim() || "",
        replacement: row.querySelector(".mask-replacement")?.value.trim() || "",
        matchMode: "exact"
      }))
      .filter(rule => rule.needle && rule.replacement));

    return rules;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));
  }
  function escapeAttr(value) { return escapeHtml(value); }

  async function handleFile(file) {
    if (!file) return;
    setUploadError("");
    dropZone.classList.remove("dragover");
    dropZone.classList.add("is-importing");

    try {
      const { readStatementRows, importStatementFromRows } = window.FinanceStatementParser;
      const accountDefinitions = getAccountDefinitions();
      const maskRules = getMaskRules(accountDefinitions);
      setImportProgress({
        progress: 0.02,
        message: `Opening ${file.name}`,
        detail: file.name.toLowerCase().endsWith(".pdf")
          ? "PDF pages stay on this device. Image-only pages are OCRed locally in your browser."
          : "Reading your statement locally before saving parsed data."
      });
      const rows = await readStatementRows(file, setImportProgress);
      setImportProgress({
        progress: 0.94,
        message: "Organising transactions…",
        detail: accountDefinitions.savingsAccount
          ? "Matching transfers to your defined savings account, then applying masking rules."
          : "No savings account was defined, so debits will be treated as spending unless another rule categorises them."
      });
      const imported = importStatementFromRows(rows, file.name, {
        maskRules,
        accountDefinitions
      });
      if (!imported.transactions.length) {
        throw new Error("No transactions were found. This statement layout may not be supported yet.");
      }
      // Do not persist the raw account identifiers or masking needles. They are
      // used only during this import; only already-masked rows/transactions are saved.
      imported.maskRules = [];
      const reserveCount = Number(imported.accountDetection?.reserveTransferCount || 0);
      setImportProgress({
        progress: 0.97,
        message: "Saving to your account…",
        detail: accountDefinitions.savingsAccount
          ? `${imported.transactions.length} transactions found · ${reserveCount} savings transfer${reserveCount === 1 ? "" : "s"} detected.`
          : `${imported.transactions.length} transactions found · savings detection not enabled.`
      });
      await window.FinanceData.importStatement(imported);
      setImportProgress({
        progress: 1,
        message: "Import complete",
        detail: `${imported.transactions.length} transactions saved. Opening your dashboard…`
      });
      window.location.href = "console.html";
    } catch (error) {
      console.error(error);
      setImportProgress(null);
      setUploadError(error?.message || "Could not import this statement. Try another export format or a clearer PDF.");
    } finally {
      dropZone.classList.remove("is-importing");
      uploadInput.value = "";
    }
  }

  function proceedToImport() {
    try {
      getAccountDefinitions();
      setUploadError("");
      importStep.hidden = false;
      proceedImportBtn.textContent = "Ready";
      proceedImportBtn.classList.add("is-complete");
      importStep.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => { proceedImportBtn.textContent = "Proceed"; }, 1200);
    } catch (error) {
      setUploadError(error?.message || "Check your account details.");
    }
  }

  async function init() {
    try {
      const { user, profile } = await window.FinanceData.getAccountIdentity();
      const savedTheme = String(user?.user_metadata?.theme || "").toLowerCase();
      if ((savedTheme === "dark" || savedTheme === "light") && window.FinanceTheme) {
        window.FinanceTheme.apply(savedTheme);
      }
      const accountName = String(profile?.username || user.user_metadata?.username || user.user_metadata?.display_name || "").trim() || String(user.email || "").split("@")[0] || "User";
      $("accountName").textContent = accountName;
      const hasData = await window.FinanceData.hasTransactions();
      const importingAnother = new URLSearchParams(location.search).get("import") === "1";
      if (hasData && !importingAnother) {
        location.replace("console.html");
        return;
      }
      continueBtn.hidden = !hasData;
      dashboardLink.hidden = !hasData;
      if (hasData) {
        $("uploadTitle").textContent = "Import another statement";
      }
    } catch (error) {
      if (error?.message !== "Authentication required.") {
        setUploadError(error?.message || "Could not load your account.");
      }
    }
  }

  uploadInput.addEventListener("change", event => handleFile(event.target.files?.[0]));
  dropZone.addEventListener("dragover", event => {
    event.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", event => {
    event.preventDefault();
    handleFile(event.dataTransfer.files?.[0]);
  });
  addMaskBtn.addEventListener("click", addMaskRow);
  proceedImportBtn.addEventListener("click", proceedToImport);
  continueBtn.addEventListener("click", () => { window.location.href = "console.html"; });
  signOutBtn.addEventListener("click", () => window.FinanceData.signOut());

  init();
})();
