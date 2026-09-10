(() => {
  "use strict";

  const SESSION_KEY = "financeTracker502525-currentStatement-v1";
  const $ = id => document.getElementById(id);
  const uploadInput = $("statementUpload");
  const dropZone = $("dropZone");
  const maskRows = $("maskRows");
  const addMaskBtn = $("addMaskBtn");
  const continueBtn = $("continueSessionBtn");

  function setUploadError(message) {
    const el = $("uploadError");
    el.hidden = !message;
    el.textContent = message || "";
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
    try {
      const { readStatementRows, importStatementFromRows } = window.FinanceStatementParser;
      const maskRules = getMaskRules();
      const rows = await readStatementRows(file);
      const imported = importStatementFromRows(rows, file.name, maskRules);
      if (!imported.transactions.length) {
        throw new Error("No transactions were found. Check that the file includes debit and credit amount columns.");
      }
      imported.maskRules = maskRules;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(imported));
      window.location.href = "console.html";
    } catch (error) {
      console.error(error);
      setUploadError(error?.message || "Could not read this file. Try exporting the statement as CSV.");
    } finally {
      uploadInput.value = "";
    }
  }

  uploadInput.addEventListener("change", e => handleFile(e.target.files?.[0]));
  dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", e => {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0]);
  });
  addMaskBtn.addEventListener("click", () => addMaskRow());
  if (continueBtn) continueBtn.addEventListener("click", () => { window.location.href = "console.html"; });

  createMaskRow("", "[Bank Account]");
  createMaskRow("", "[Savings Account]");

  if (sessionStorage.getItem(SESSION_KEY) && continueBtn) {
    continueBtn.hidden = false;
  }
})();
