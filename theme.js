(() => {
  "use strict";

  const STORAGE_KEY = "financeTracker-theme-v1";
  const THEMES = new Set(["dark", "light"]);

  function normalize(theme) {
    return THEMES.has(String(theme || "").toLowerCase()) ? String(theme).toLowerCase() : "dark";
  }

  function apply(theme, persist = true) {
    const next = normalize(theme);
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, next); } catch (_) {}
    }
    return next;
  }

  function current() {
    let stored = "";
    try { stored = localStorage.getItem(STORAGE_KEY) || ""; } catch (_) {}
    return normalize(document.documentElement.dataset.theme || stored);
  }

  let saved = "dark";
  try { saved = localStorage.getItem(STORAGE_KEY) || "dark"; } catch (_) {}
  apply(saved, false);

  window.FinanceTheme = { apply, current, storageKey: STORAGE_KEY };
})();
