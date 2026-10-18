(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const uploadInput = $("statementUpload");
  const dropZone = $("dropZone");
  const maskRows = $("maskRows");
  const addMaskBtn = $("addMaskBtn");
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
      <label>Sensitive text or account number
        <input class="mask-needle" type="text" autocomplete="off" placeholder="e.g. 123-456789-0" value="${escapeAttr(needle)}" />
      </label>
      <label>Show as
        <input class="mask-replacement" type="text" autocomplete="off" placeholder="e.g. [Bank Account]" value="${escapeAttr(replacement)}" />
      </label>
      <button class="icon-button mask-remove" type="button" aria-label="Remove mask rule">×</button>
    `;
    row.querySelector(".mask-remove").addEventListener("click", () => {
      row.remove();
      if (!maskRows.children.length) addMaskRow();
    });
    maskRows.appendChild(row);
  }

  function addMaskRow() {
    createMaskRow("", "");
  }

  function getMaskRules() {
    return Array.from(maskRows.querySelectorAll(".mask-row"))
      .map(row => ({
        needle: row.querySelector(".mask-needle")?.value.trim() || "",
        replacement: row.querySelector(".mask-replacement")?.value.trim() || ""
      }))
      .filter(rule => rule.needle && rule.replacement);
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
      const maskRules = getMaskRules();
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
        detail: "Applying your masking rules and preparing the statement for your account."
      });
      const imported = importStatementFromRows(rows, file.name, maskRules);
      if (!imported.transactions.length) {
        throw new Error("No transactions were found. This statement layout may not be supported yet.");
      }
      imported.maskRules = maskRules;
      setImportProgress({
        progress: 0.97,
        message: "Saving to your account…",
        detail: `${imported.transactions.length} transactions found.`
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

  async function init() {
    try {
      const { user, profile } = await window.FinanceData.getAccountIdentity();
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
  continueBtn.addEventListener("click", () => { window.location.href = "console.html"; });
  signOutBtn.addEventListener("click", () => window.FinanceData.signOut());

  createMaskRow("", "[Bank Account]");
  createMaskRow("", "[Savings Account]");
  init();
})();
