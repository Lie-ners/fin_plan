(() => {
  "use strict";

  const PDFJS_BASE = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
  const TESSERACT_SCRIPT = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  let pdfJsPromise = null;
  let tesseractPromise = null;

  async function readStatementRows(file, onProgress = () => {}) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".csv") || name.endsWith(".tsv")) {
      onProgress({ progress: 0.35, message: "Reading spreadsheet…", detail: "Parsing transaction rows on this device." });
      const text = await file.text();
      return parseDelimited(text, name.endsWith(".tsv") ? "\t" : ",");
    }
    if (name.endsWith(".xlsx")) {
      onProgress({ progress: 0.25, message: "Reading Excel statement…", detail: "Opening the workbook locally in your browser." });
      return readXlsxRows(await file.arrayBuffer());
    }
    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      return readPdfRows(await file.arrayBuffer(), file.name, onProgress);
    }
    throw new Error("Unsupported file type. Upload a PDF, .xlsx, .csv, or .tsv statement export.");
  }

  function loadScriptOnce(src, test) {
    if (test()) return Promise.resolve();
    const existing = Array.from(document.scripts).find(script => script.src === src);
    if (existing) {
      return new Promise((resolve, reject) => {
        if (test()) return resolve();
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", () => reject(new Error(`Could not load ${src}`)), { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensurePdfJs() {
    if (!pdfJsPromise) {
      pdfJsPromise = loadScriptOnce(`${PDFJS_BASE}/pdf.min.js`, () => Boolean(window.pdfjsLib?.getDocument))
        .then(() => {
          if (!window.pdfjsLib?.getDocument) throw new Error("PDF reader failed to initialise.");
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.js`;
        });
    }
    return pdfJsPromise;
  }

  async function ensureTesseract() {
    if (!tesseractPromise) {
      tesseractPromise = loadScriptOnce(TESSERACT_SCRIPT, () => Boolean(window.Tesseract?.createWorker))
        .then(() => {
          if (!window.Tesseract?.createWorker) throw new Error("PDF OCR failed to initialise.");
        });
    }
    return tesseractPromise;
  }

  async function readPdfRows(buffer, fileName, onProgress) {
    onProgress({ progress: 0.05, message: "Opening PDF…", detail: "Checking the statement for selectable text." });
    await ensurePdfJs();

    let pdf;
    try {
      pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    } catch (error) {
      if (/password/i.test(String(error?.message || error?.name || ""))) {
        throw new Error("This PDF is password-protected. Remove the password in your banking app or PDF viewer, then try again.");
      }
      throw new Error("Could not open this PDF. Try downloading the statement again from your banking app.");
    }

    if (!pdf.numPages) throw new Error("This PDF does not contain any readable pages.");

    const allLines = [];
    let ocrWorker = null;
    let usedOcr = false;

    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const pageBase = 0.08 + ((pageNumber - 1) / pdf.numPages) * 0.80;
        onProgress({
          progress: pageBase,
          message: `Reading PDF page ${pageNumber} of ${pdf.numPages}`,
          detail: usedOcr ? "Image text is being recognised locally on this device." : "Looking for transaction text."
        });

        let lines = await extractPdfTextLines(page);
        if (!looksLikeStatementText(lines)) {
          usedOcr = true;
          if (!ocrWorker) {
            onProgress({
              progress: pageBase,
              message: "Preparing on-device PDF OCR…",
              detail: "This statement is image-based. The OCR engine loads once, then processes pages one at a time."
            });
            await ensureTesseract();
            ocrWorker = await window.Tesseract.createWorker("eng", 1);
            try {
              await ocrWorker.setParameters({
                tessedit_pageseg_mode: "6",
                preserve_interword_spaces: "1"
              });
            } catch (_) {}
          }

          const canvas = await renderPdfPageForOcr(page);
          onProgress({
            progress: pageBase + (0.35 / pdf.numPages),
            message: `Scanning PDF page ${pageNumber} of ${pdf.numPages}`,
            detail: "OCR is running in your browser. Keeping this page open will let the import finish."
          });
          const result = await ocrWorker.recognize(canvas);
          lines = normalizePdfTextLines(result?.data?.text || "");
          canvas.width = 1;
          canvas.height = 1;
        }

        allLines.push(...lines, "__PAGE_BREAK__");
        page.cleanup?.();
        onProgress({
          progress: 0.08 + (pageNumber / pdf.numPages) * 0.80,
          message: `Processed page ${pageNumber} of ${pdf.numPages}`,
          detail: usedOcr ? "Recognised statement text locally on this device." : "Read embedded PDF text."
        });
      }
    } finally {
      if (ocrWorker) await ocrWorker.terminate();
      try { await pdf.destroy(); } catch (_) {}
    }

    onProgress({ progress: 0.90, message: "Building transaction history…", detail: "Converting the PDF into structured finance rows." });
    const rows = pdfTextLinesToRows(allLines, fileName);
    const headerIndex = rows.findIndex(row => row?.[0] === "Transaction Date");
    const transactionCount = headerIndex >= 0 ? rows.length - headerIndex - 1 : 0;
    if (transactionCount <= 0) {
      throw new Error("The PDF opened, but no transactions could be recognised. This bank's PDF layout may not be supported yet.");
    }
    return rows;
  }

  async function extractPdfTextLines(page) {
    const content = await page.getTextContent();
    const items = (content.items || [])
      .map(item => ({
        text: String(item.str || "").trim(),
        x: Number(item.transform?.[4] || 0),
        y: Number(item.transform?.[5] || 0)
      }))
      .filter(item => item.text);
    if (!items.length) return [];

    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const groups = [];
    for (const item of items) {
      const group = groups.find(candidate => Math.abs(candidate.y - item.y) <= 2.5);
      if (group) group.items.push(item);
      else groups.push({ y: item.y, items: [item] });
    }
    groups.sort((a, b) => b.y - a.y);
    return groups.map(group => group.items.sort((a, b) => a.x - b.x).map(item => item.text).join(" ").replace(/\s+/g, " ").trim()).filter(Boolean);
  }

  function looksLikeStatementText(lines) {
    const text = lines.join(" ");
    const amountCount = (text.match(/\b[A-Z]{3}\s*-?\s*[\d,]+(?:\.\d{1,2})?/g) || []).length;
    const dateCount = (text.match(/\b\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2}\b/g) || []).length;
    return text.length > 250 && amountCount >= 2 && dateCount >= 1;
  }

  async function renderPdfPageForOcr(page) {
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2.35, 1800 / Math.max(1, baseViewport.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas;
  }

  function normalizePdfTextLines(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map(line => normalizePdfLine(line))
      .filter(Boolean);
  }

  function normalizePdfLine(line) {
    return String(line || "")
      .replace(/[−–—]/g, "-")
      .replace(/\u00a0/g, " ")
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  const PDF_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const PDF_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function editDistance(a, b) {
    const x = String(a || "");
    const y = String(b || "");
    const row = Array.from({ length: y.length + 1 }, (_, i) => i);
    for (let i = 1; i <= x.length; i++) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= y.length; j++) {
        const before = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (x[i - 1] === y[j - 1] ? 0 : 1));
        previous = before;
      }
    }
    return row[y.length];
  }

  function fuzzyMonthIndex(token) {
    const clean = String(token || "")
      .toLowerCase()
      .replace(/0/g, "o")
      .replace(/1/g, "i")
      .replace(/[^a-z]/g, "")
      .slice(0, 3);
    if (!clean) return -1;
    let best = { index: -1, distance: 99 };
    PDF_MONTHS.forEach((month, index) => {
      const distance = editDistance(clean, month);
      if (distance < best.distance) best = { index, distance };
    });
    return best.distance <= 1 || (clean.length >= 2 && best.distance <= 2) ? best.index : -1;
  }

  function parsePdfMonthHeading(line) {
    const match = normalizePdfLine(line).match(/^([A-Za-z0-9]{2,12})\s+(20\d{2})$/i);
    if (!match) return null;
    const monthIndex = fuzzyMonthIndex(match[1]);
    if (monthIndex < 0) return null;
    return { month: monthIndex + 1, year: Number(match[2]) };
  }

  function weekdayIndexFromLine(line) {
    const token = String(line || "").trim().slice(0, 3).toLowerCase();
    return ({ sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 })[token] ?? null;
  }

  function parsePdfDateHeading(line, monthContext, previousDate) {
    const clean = normalizePdfLine(line);
    const withoutWeekday = clean.replace(/^[A-Za-z]{3,12}\s*,?\s*/i, "");
    const match = withoutWeekday.match(/^(\d{1,2})\s*[,./-]?\s*([A-Za-z0-9]{2,5})\s*[,./-]?\s*(20\d{2})\b/i);
    if (!match) return null;

    const rawDay = Number(match[1]);
    let monthIndex = fuzzyMonthIndex(match[2]);
    if (monthIndex < 0 && monthContext?.month) monthIndex = monthContext.month - 1;
    if (monthIndex < 0 || rawDay < 1 || rawDay > 31) return null;

    let year = Number(match[3]);
    if (monthContext?.year && monthContext?.month === monthIndex + 1 && Math.abs(year - monthContext.year) >= 1) {
      year = monthContext.year;
    }

    let day = rawDay;
    let candidate = new Date(Date.UTC(year, monthIndex, day));
    if (candidate.getUTCMonth() !== monthIndex || candidate.getUTCDate() !== day) return null;

    if (previousDate) {
      const previous = new Date(`${previousDate}T00:00:00Z`);
      if (candidate > previous && previous.getUTCFullYear() === year && previous.getUTCMonth() === monthIndex) {
        const weekday = weekdayIndexFromLine(clean);
        if (weekday != null) {
          const plausible = [];
          for (let d = 1; d <= previous.getUTCDate(); d++) {
            const test = new Date(Date.UTC(year, monthIndex, d));
            if (test.getUTCMonth() === monthIndex && test.getUTCDay() === weekday) plausible.push(d);
          }
          if (plausible.length) {
            day = plausible.sort((a, b) => Math.abs(a - rawDay) - Math.abs(b - rawDay))[0];
            candidate = new Date(Date.UTC(year, monthIndex, day));
          }
        }
      }
    }

    return candidate.toISOString().slice(0, 10);
  }

  function parsePdfMoney(value) {
    const numeric = Number(String(value || "").replace(/[\s,]/g, ""));
    return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : null;
  }

  function parsePdfAmountLine(line) {
    const clean = normalizePdfLine(line);
    const match = clean.match(/\b(S(?:G|6)D|[A-Z]{3})\s*([+\-]?)\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*$/i);
    if (!match) return null;
    const value = parsePdfMoney(match[3]);
    if (value == null) return null;
    return {
      description: clean.slice(0, match.index).trim(),
      currency: match[1].toUpperCase().replace("6", "G"),
      amount: match[2] === "-" ? -Math.abs(value) : Math.abs(value)
    };
  }

  function pdfSourceCode(line) {
    const clean = normalizePdfLine(line).toUpperCase();
    const match = clean.match(/\b(POS|ADV|ATINT|GR|ATM)\b\s*$/);
    return match?.[1] || "";
  }

  function shouldIgnorePdfLine(line) {
    const clean = normalizePdfLine(line);
    return !clean ||
      clean === "__PAGE_BREAK__" ||
      /^Page\s+\d+\s+of\s+\d+$/i.test(clean) ||
      /^Transaction Histor/i.test(clean) ||
      /^My Account$/i.test(clean) ||
      /^(DBS|POSB)\b/i.test(clean) ||
      /^April\s+20\d{2}\s*-\s*October\s+20\d{2}$/i.test(clean) ||
      /^Available Balance/i.test(clean) ||
      /^Ledger Balance/i.test(clean) ||
      /^Transactions\s*as\s*of/i.test(clean);
  }

  function extractPdfMetadata(lines, transactions) {
    const cleanLines = lines.filter(line => line !== "__PAGE_BREAK__").map(normalizePdfLine);
    let availableBalance = null;
    let ledgerBalance = null;
    let statementDate = null;

    const balanceHeaderIndex = cleanLines.findIndex(line => /Available Balance/i.test(line) && /Ledger Balance/i.test(line));
    if (balanceHeaderIndex >= 0) {
      const block = cleanLines.slice(balanceHeaderIndex, balanceHeaderIndex + 4).join(" ");
      const amounts = [...block.matchAll(/\bS(?:G|6)D\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi)].map(match => parsePdfMoney(match[1])).filter(value => value != null);
      if (amounts.length >= 1) availableBalance = amounts[0];
      if (amounts.length >= 2) ledgerBalance = amounts[1];
      const dates = [...block.matchAll(/\b(\d{1,2})\s+([A-Za-z0-9]{2,5})\s+(20\d{2})\b/gi)]
        .map(match => {
          const monthIndex = fuzzyMonthIndex(match[2]);
          if (monthIndex < 0) return null;
          const date = new Date(Date.UTC(Number(match[3]), monthIndex, Number(match[1])));
          return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
        })
        .filter(Boolean)
        .sort();
      if (dates.length) statementDate = dates[dates.length - 1];
    }

    if (!statementDate && transactions.length) {
      statementDate = transactions.map(transaction => transaction.date).filter(Boolean).sort().at(-1) || null;
    }

    return { availableBalance, ledgerBalance, statementDate, currency: "SGD" };
  }

  function pdfTextLinesToRows(lines, fileName = "Statement.pdf") {
    const transactions = [];
    let monthContext = null;
    let currentDate = null;
    let previousDate = null;
    let pending = null;
    let carryText = "";

    const flushPending = () => {
      if (!pending) return;
      transactions.push(pending);
      pending = null;
    };

    for (const rawLine of lines) {
      const line = normalizePdfLine(rawLine);
      if (!line) continue;
      if (line === "__PAGE_BREAK__") {
        flushPending();
        carryText = "";
        continue;
      }

      const monthHeading = parsePdfMonthHeading(line);
      if (monthHeading) {
        flushPending();
        monthContext = monthHeading;
        carryText = "";
        continue;
      }

      const dateHeading = parsePdfDateHeading(line, monthContext, previousDate);
      if (dateHeading) {
        flushPending();
        currentDate = dateHeading;
        previousDate = dateHeading;
        const d = new Date(`${dateHeading}T00:00:00Z`);
        monthContext = { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
        carryText = "";
        continue;
      }

      const amountLine = parsePdfAmountLine(line);
      if (amountLine && currentDate) {
        flushPending();
        let description = amountLine.description;
        if (description.length < 3 && carryText) description = carryText;
        pending = {
          date: currentDate,
          description: description || "Transaction",
          currency: amountLine.currency || "SGD",
          amount: amountLine.amount,
          sourceCode: ""
        };
        carryText = "";
        continue;
      }

      if (pending) {
        const sourceCode = pdfSourceCode(line);
        if (sourceCode) {
          pending.sourceCode = sourceCode;
          flushPending();
          continue;
        }
      }

      if (!shouldIgnorePdfLine(line) && !/\bS(?:G|6)D\b/i.test(line)) {
        carryText = line;
      }
    }
    flushPending();

    if (!transactions.length) return [];
    const metadata = extractPdfMetadata(lines, transactions);
    const rows = [
      ["Statement as at", metadata.statementDate || ""],
      ["Currency", metadata.currency],
      ["Available Balance", metadata.availableBalance ?? ""],
      ["Ledger Balance", metadata.ledgerBalance ?? ""],
      ["Source", fileName],
      [],
      ["Transaction Date", "Statement Code", "Description", "Currency", "Debit Amount", "Credit Amount"]
    ];

    transactions.forEach(transaction => {
      rows.push([
        transaction.date,
        transaction.sourceCode,
        transaction.description,
        transaction.currency,
        transaction.amount < 0 ? Math.abs(transaction.amount) : "",
        transaction.amount > 0 ? transaction.amount : ""
      ]);
    });
    return rows;
  }

  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let value = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (ch === '"') {
        if (inQuotes && next === '"') {
          value += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        row.push(value);
        value = "";
      } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && next === "\n") i++;
        row.push(value);
        if (row.some(cell => String(cell).trim() !== "")) rows.push(row);
        row = [];
        value = "";
      } else {
        value += ch;
      }
    }
    row.push(value);
    if (row.some(cell => String(cell).trim() !== "")) rows.push(row);
    return rows;
  }

  async function readXlsxRows(buffer) {
    const zip = createZipReader(buffer);
    const workbookXml = await zip.getText("xl/workbook.xml");
    const workbookRelsXml = await zip.getText("xl/_rels/workbook.xml.rels");
    const workbook = parseXml(workbookXml);
    const rels = parseXml(workbookRelsXml);
    const firstSheet = tags(workbook, "sheet")[0];
    if (!firstSheet) throw new Error("No worksheet was found inside this Excel file.");

    const relId = firstSheet.getAttribute("r:id") || firstSheet.getAttribute("id");
    const rel = tags(rels, "Relationship").find(item => item.getAttribute("Id") === relId);
    let sheetPath = rel?.getAttribute("Target") || "worksheets/sheet1.xml";
    if (!sheetPath.startsWith("xl/")) sheetPath = `xl/${sheetPath.replace(/^\//, "")}`;
    sheetPath = normalizeZipPath(sheetPath);

    let sharedStrings = [];
    if (zip.has("xl/sharedStrings.xml")) {
      const sharedDoc = parseXml(await zip.getText("xl/sharedStrings.xml"));
      sharedStrings = tags(sharedDoc, "si").map(si => tags(si, "t").map(t => t.textContent || "").join(""));
    }

    const sheet = parseXml(await zip.getText(sheetPath));
    const rows = [];
    for (const rowEl of tags(sheet, "row")) {
      const cells = [];
      for (const cellEl of tags(rowEl, "c")) {
        const ref = cellEl.getAttribute("r") || "";
        const colIndex = columnIndex(ref);
        cells[colIndex] = readCellValue(cellEl, sharedStrings);
      }
      rows.push(cells.map(v => v ?? ""));
    }
    return rows;
  }

  function createZipReader(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const entries = new Map();
    const decoder = new TextDecoder("utf-8");
    const eocdOffset = findEndOfCentralDirectory(view);
    const totalEntries = readU16(view, eocdOffset + 10);
    let pointer = readU32(view, eocdOffset + 16);

    for (let i = 0; i < totalEntries; i++) {
      if (readU32(view, pointer) !== 0x02014b50) throw new Error("Invalid Excel archive structure.");
      const method = readU16(view, pointer + 10);
      const compressedSize = readU32(view, pointer + 20);
      const localOffset = readU32(view, pointer + 42);
      const nameLength = readU16(view, pointer + 28);
      const extraLength = readU16(view, pointer + 30);
      const commentLength = readU16(view, pointer + 32);
      const name = decoder.decode(bytes.slice(pointer + 46, pointer + 46 + nameLength));
      entries.set(normalizeZipPath(name), { method, compressedSize, localOffset });
      pointer += 46 + nameLength + extraLength + commentLength;
    }

    return {
      has(name) { return entries.has(normalizeZipPath(name)); },
      async getText(name) {
        const data = await this.getBytes(name);
        return new TextDecoder("utf-8").decode(data);
      },
      async getBytes(name) {
        const entry = entries.get(normalizeZipPath(name));
        if (!entry) throw new Error(`Required file ${name} was not found inside the Excel workbook.`);
        const local = entry.localOffset;
        if (readU32(view, local) !== 0x04034b50) throw new Error("Invalid Excel worksheet entry.");
        const nameLength = readU16(view, local + 26);
        const extraLength = readU16(view, local + 28);
        const start = local + 30 + nameLength + extraLength;
        const compressed = bytes.slice(start, start + entry.compressedSize);
        if (entry.method === 0) return compressed;
        if (entry.method === 8) return new Uint8Array(await inflateRaw(compressed));
        throw new Error(`Unsupported Excel compression method: ${entry.method}. Try exporting the statement as CSV.`);
      }
    };
  }

  async function inflateRaw(bytes) {
    if (!("DecompressionStream" in window)) {
      throw new Error("This browser cannot read .xlsx files directly. Use a current Chrome, Edge, or Safari browser, or export the statement as CSV.");
    }
    let stream;
    try {
      stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    } catch (_) {
      stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    }
    return new Response(stream).arrayBuffer();
  }

  function findEndOfCentralDirectory(view) {
    const min = Math.max(0, view.byteLength - 65557);
    for (let i = view.byteLength - 22; i >= min; i--) {
      if (readU32(view, i) === 0x06054b50) return i;
    }
    throw new Error("This does not look like a valid .xlsx file.");
  }

  function readU16(view, offset) { return view.getUint16(offset, true); }
  function readU32(view, offset) { return view.getUint32(offset, true); }
  function normalizeZipPath(path) { return path.replace(/\\/g, "/").replace(/\/\.\//g, "/").replace(/^\//, ""); }
  function parseXml(text) { return new DOMParser().parseFromString(text, "application/xml"); }
  function tags(root, localName) { return Array.from(root.getElementsByTagNameNS("*", localName)); }

  function columnIndex(cellRef) {
    const letters = String(cellRef).match(/^[A-Z]+/i)?.[0] || "A";
    let index = 0;
    for (const letter of letters.toUpperCase()) index = index * 26 + letter.charCodeAt(0) - 64;
    return index - 1;
  }

  function readCellValue(cellEl, sharedStrings) {
    const type = cellEl.getAttribute("t");
    if (type === "inlineStr") return tags(cellEl, "t").map(t => t.textContent || "").join("");
    const valueEl = tags(cellEl, "v")[0];
    const raw = valueEl?.textContent ?? "";
    if (type === "s") return sharedStrings[Number(raw)] ?? "";
    if (type === "b") return raw === "1";
    if (raw !== "" && /^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    return raw;
  }

  function importStatementFromRows(rows, fileName, options = []) {
    // Backwards compatibility: older callers passed maskRules as the third
    // argument. New callers pass { maskRules, accountDefinitions }.
    const importOptions = Array.isArray(options)
      ? { maskRules: options, accountDefinitions: {} }
      : (options || {});
    const masks = normalizeMaskRules(importOptions.maskRules || []);
    const accountDefinitions = normalizeAccountDefinitions(importOptions.accountDefinitions);
    const sourceRows = rows.map(row => Array.isArray(row) ? row.slice() : []);
    const cleanRows = sourceRows.map(row => row.map(cell => maskValue(cell, masks)));
    const headerIndex = cleanRows.findIndex(row => {
      const values = row.map(normalizeHeader);
      return values.includes("transactiondate") && values.includes("description") && (values.includes("debitamount") || values.includes("creditamount"));
    });
    if (headerIndex < 0) throw new Error("Could not find the transaction table. Expected a header row with Transaction Date, Description, Debit Amount, and Credit Amount.");

    const headers = cleanRows[headerIndex].map(normalizeHeader);
    const col = (...names) => names.map(normalizeHeader).map(name => headers.indexOf(name)).find(idx => idx >= 0) ?? -1;
    const dateCol = col("Transaction Date", "Date");
    const codeCol = col("Statement Code", "Code");
    const descCol = col("Description", "Transaction Description");
    const suppCol = col("Supplementary Code");
    const suppDescCol = col("Supplementary Code Description");
    const clientRefCol = col("Client Reference");
    const addRefCol = col("Additional Reference");
    const currencyCol = col("Currency");
    const debitCol = col("Debit Amount", "Debit");
    const creditCol = col("Credit Amount", "Credit");

    const statement = extractStatementMeta(cleanRows, maskValue(fileName, masks));
    const transactions = [];
    let reserveTransferCount = 0;

    for (let i = headerIndex + 1; i < cleanRows.length; i++) {
      const row = cleanRows[i];
      const sourceRow = sourceRows[i] || [];
      const rawDate = valueAt(row, dateCol);
      const rawDescription = valueAt(row, descCol);
      // Bank exports are inconsistent about whether debit/credit columns carry
      // their own sign. Treat each column as a magnitude and let the column
      // itself determine direction so a negative debit cannot become a credit.
      const debit = Math.abs(parseAmount(valueAt(row, debitCol)) || 0);
      const credit = Math.abs(parseAmount(valueAt(row, creditCol)) || 0);
      if (!rawDate && !rawDescription && !debit && !credit) continue;
      const date = parseDateCell(rawDate);
      if (!date) continue;
      const amount = roundMoney(credit - debit);
      if (amount === 0) continue;

      // Reserve detection must happen against the unmasked source row. This
      // prevents a generic label such as "savings account" from deciding the
      // category and makes the user's explicit savings-account definition the
      // only automatic reserve-transfer rule.
      const sourceRecord = {
        rawDescription: String(valueAt(sourceRow, descCol) || ""),
        supplementary: String(valueAt(sourceRow, suppCol) || ""),
        supplementaryDescription: String(valueAt(sourceRow, suppDescCol) || ""),
        clientReference: String(valueAt(sourceRow, clientRefCol) || ""),
        additionalReference: String(valueAt(sourceRow, addRefCol) || ""),
        sourceCode: String(valueAt(sourceRow, codeCol) || "").trim(),
        currency: String(valueAt(sourceRow, currencyCol) || statement.currencyCode || "SGD").trim(),
        debit,
        credit,
        amount
      };
      const reserveTransfer = isReserveRecord(sourceRecord, accountDefinitions);
      if (reserveTransfer) reserveTransferCount++;

      const record = {
        rawDescription: String(rawDescription || ""),
        supplementary: String(valueAt(row, suppCol) || ""),
        supplementaryDescription: String(valueAt(row, suppDescCol) || ""),
        clientReference: String(valueAt(row, clientRefCol) || ""),
        additionalReference: String(valueAt(row, addRefCol) || ""),
        sourceCode: String(valueAt(row, codeCol) || "").trim(),
        currency: String(valueAt(row, currencyCol) || statement.currencyCode || "SGD").trim(),
        debit,
        credit,
        amount
      };

      const description = simplifyDescription(record, reserveTransfer);
      const category = guessCategory(record, description, reserveTransfer);
      transactions.push({
        id: `import-${transactions.length + 1}`,
        date,
        description,
        amount,
        category,
        excludeFromSpending: reserveTransfer,
        isPayroll: amount > 0 && category === "Income",
        sourceCode: record.sourceCode,
        currency: record.currency
      });
    }

    transactions.sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    if (!statement.currencyCode) {
      statement.currencyCode = transactions.find(t => t.currency)?.currency || "SGD";
    }
    return {
      statement,
      transactions,
      sheetRows: cleanRows,
      accountDetection: {
        savingsDefined: Boolean(accountDefinitions.savingsAccount),
        reserveTransferCount
      }
    };
  }

  function extractStatementMeta(rows, fileName) {
    const statement = { fileName, currencyCode: "SGD", currencyLabel: "SGD", statementDate: null, availableBalance: null, ledgerBalance: null };
    for (const row of rows) {
      const label = String(row[0] ?? "").trim().toLowerCase();
      const value = row[1];
      if (label.startsWith("statement as at")) statement.statementDate = parseDateCell(value);
      if (label.startsWith("currency")) {
        statement.currencyLabel = String(value || "SGD").trim();
        statement.currencyCode = (statement.currencyLabel.match(/[A-Z]{3}/)?.[0]) || "SGD";
      }
      if (label.startsWith("available balance")) statement.availableBalance = parseAmount(value);
      if (label.startsWith("ledger balance")) statement.ledgerBalance = parseAmount(value);
    }
    return statement;
  }


  function normalizeMaskRules(maskRules) {
    if (!Array.isArray(maskRules)) return [];
    return maskRules
      .map(rule => ({
        needle: String(rule?.needle || "").trim(),
        replacement: String(rule?.replacement || "").trim(),
        matchMode: rule?.matchMode === "account" ? "account" : "exact"
      }))
      .filter(rule => rule.needle && rule.replacement)
      .sort((a, b) => b.needle.length - a.needle.length);
  }

  function normalizeAccountIdentifier(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function normalizeAccountDefinitions(accountDefinitions) {
    const source = accountDefinitions && typeof accountDefinitions === "object" ? accountDefinitions : {};
    return {
      mainAccount: String(source.mainAccount || "").trim(),
      savingsAccount: String(source.savingsAccount || "").trim()
    };
  }

  function accountIdentifierMatches(text, identifier) {
    const needle = normalizeAccountIdentifier(identifier);
    if (needle.length < 4) return false;
    return normalizeAccountIdentifier(text).includes(needle);
  }

  function accountMaskRegex(identifier) {
    const chars = String(identifier || "").toLowerCase().replace(/[^a-z0-9]/g, "").split("");
    if (chars.length < 4) return null;
    return new RegExp(chars.map(char => escapeRegExp(char)).join("[^a-z0-9]*"), "gi");
  }

  function maskValue(value, rules) {
    if (!rules.length || value == null || value === "") return value;
    let text = String(value);
    for (const rule of rules) {
      const regex = rule.matchMode === "account"
        ? accountMaskRegex(rule.needle)
        : new RegExp(escapeRegExp(rule.needle), "gi");
      if (regex) text = text.replace(regex, rule.replacement);
    }
    return text;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeHeader(value) {
    return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function valueAt(row, index) {
    return index >= 0 ? row[index] : "";
  }

  function parseAmount(value) {
    if (value == null || value === "") return 0;
    if (typeof value === "number") return value;
    const text = String(value).trim();
    if (!text) return 0;
    const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
    const numeric = Number(text.replace(/[(),$A-Z\s]/gi, ""));
    if (!Number.isFinite(numeric)) return 0;
    return negative ? -Math.abs(numeric) : numeric;
  }

  function parseDateCell(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number" && Number.isFinite(value)) return excelSerialToIso(value);
    const text = String(value).trim();
    if (!text) return null;
    if (/^\d+(\.\d+)?$/.test(text) && Number(text) > 20000) return excelSerialToIso(Number(text));

    let match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (match) {
      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
      return isoFromParts(year, month, day);
    }

    match = text.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{2,4})$/);
    if (match) {
      const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
      const month = months.indexOf(match[2].slice(0,3).toLowerCase()) + 1;
      const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
      if (month > 0) return isoFromParts(year, month, Number(match[1]));
    }

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return isoFromParts(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
    }
    return null;
  }

  function excelSerialToIso(serial) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(serial)) * 86400000);
    return date.toISOString().slice(0, 10);
  }

  function isoFromParts(year, month, day) {
    if (!year || !month || !day) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date.toISOString().slice(0, 10);
  }

  function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function simplifyDescription(record, reserveTransfer = false) {
    const raw = compact(record.rawDescription);
    const supp = compact(record.supplementary);
    const client = compact(record.clientReference);
    const add = compact(record.additionalReference);
    const suppDesc = compact(record.supplementaryDescription);
    const code = record.sourceCode.toUpperCase();
    const hay = `${raw} ${supp} ${client} ${add} ${suppDesc}`;

    if (isPayrollRecord(record)) {
      const source = raw.replace(/^PAY\s+/i, "").replace(/\s+\d{5,}\b.*$/i, "").trim();
      return `Payroll — ${source || "Income"}`;
    }
    if (code === "ATINT" || /interest earned/i.test(hay)) return "Interest earned";
    if (reserveTransfer) return "Transfer to savings account";
    if (code === "ATM" || /\bATM\b/i.test(hay)) return "ATM cash withdrawal";

    if (record.amount > 0 && /paynow/i.test(hay)) {
      const name = extractNamedParty(hay, "from") || extractNamedParty(hay, "by");
      return `Incoming PayNow${name ? " — " + name : ""}`;
    }
    if (/nets\s*qr/i.test(hay)) {
      const name = extractNamedParty(hay, "to") || client.replace(/^TO:\s*/i, "");
      return `NETS QR${name ? " — " + name : ""}`;
    }
    if (/paynow/i.test(hay)) {
      const name = extractNamedParty(hay, "to") || extractNamedParty(hay, "from");
      return `${record.amount > 0 ? "Incoming PayNow" : "PayNow"}${name ? " — " + name : ""}`;
    }

    if (code === "POS") {
      return cleanPosMerchant(supp || raw);
    }

    if (suppDesc && !/^advice$/i.test(suppDesc)) return titleCaseLoose(suppDesc);
    return titleCaseLoose(raw || supp || "Transaction");
  }

  function isPayrollRecord(record) {
    return record.amount > 0 && record.sourceCode.toUpperCase() === "GR" && /^PAY\b/i.test(record.rawDescription.trim());
  }

  function isReserveRecord(record, accountDefinitions = {}) {
    if (record.amount >= 0) return false;
    const savingsAccount = String(accountDefinitions?.savingsAccount || "").trim();
    if (!savingsAccount) return false;

    return [
      record.rawDescription,
      record.supplementary,
      record.supplementaryDescription,
      record.clientReference,
      record.additionalReference
    ].filter(Boolean).some(value => accountIdentifierMatches(value, savingsAccount));
  }

  function extractNamedParty(text, direction) {
    const regex = new RegExp(`\\b${direction}:\\s*(.+?)(?:\\s+OTHR\\b|\\s+PayNow\\b|\\s+transfer\\b|\\s+Transfer\\b|$)`, "i");
    const match = text.match(regex);
    if (!match) return "";
    return compact(match[1]).replace(/\s+\d{5,}.*$/, "").trim();
  }

  function cleanPosMerchant(text) {
    let clean = compact(text)
      .replace(/^BAT\s+/i, "")
      .replace(/\s+SI\s+SGP\b.*$/i, "")
      .replace(/\s+SGP\b.*$/i, "")
      .replace(/\s+Singapore\b.*$/i, "")
      .replace(/\s+\d{4}-\d{4}-\d{4}-\d{4}\b.*$/i, "")
      .replace(/\s+\d{8,}\b.*$/i, "")
      .trim();
    return titleCaseLoose(clean || text || "POS transaction");
  }

  function titleCaseLoose(text) {
    const trimmed = compact(text);
    if (!trimmed) return "Transaction";
    return trimmed.replace(/\b([A-Z]{2,}|[a-z]{2,})\b/g, word => {
      if (/^(SG|SGD|NYP|MRT|AIA|KFC|NTUC|DBS|QR|ATM|POS|SAF|PTE|LTD|XBOX)$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
  }

  function compact(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function guessCategory(record, description, reserveTransfer = false) {
    const code = record.sourceCode.toUpperCase();
    const hay = `${record.rawDescription} ${record.supplementary} ${record.supplementaryDescription} ${record.clientReference} ${record.additionalReference} ${description}`.toUpperCase();

    if (isPayrollRecord(record)) return "Income";
    if (code === "ATINT" || hay.includes("INTEREST EARNED")) return "Interest";
    if (reserveTransfer) return "Reserve Transfer";
    if (record.amount > 0) return hay.includes("REFUND") ? "Refund" : "Other Inflow";
    if (code === "ATM" || /\bATM\b/.test(hay)) return "Cash";
    if (/PAYNOW|NETS QR|ICT PAYNOW/.test(hay)) return "PayNow / QR";
    if (/AIA/.test(hay)) return "Insurance";
    if (/CAPCUT|GOOGLE ONE|SUBSCRIPTION/.test(hay)) return "Subscriptions";
    if (/TRANSIT|MRT|BUS|SPC /.test(hay)) return "Transport";
    if (/WATSONS|GUARDIAN|PHARMACY|CLINIC|HEALTH/.test(hay)) return "Health & Personal";
    if (/FAIRPRICE|NTUC|COLD STORAGE|GIANT|SCARLETT|7-ELEVEN|HOCKHUA|K&N MART|SUPERMARKET|GROCERY/.test(hay)) return "Groceries";
    if (/SHOPEE|DAISO|DON DON DONKI|LIFESTYLEMART|PLAY E|POPULAR|BOOK|MALL/.test(hay)) return "Shopping";
    if (/MCDONALD|KFC|STUFF'D|TORI-Q|POTATO|CAFE|KOPI|VENDING|IJOOZ|COCA|DONCHA|DANLAO|KOLO|RU JI|MIZU|GORENG|NASI|NOODLE|FOOD|SNACK|BAKER|MUYOO|HOJIAK|ECONOMICAL|CRAFT'B/.test(hay)) return "Food & Drinks";
    return "Other Spending";
  }


  window.FinanceStatementParser = {
    readStatementRows,
    importStatementFromRows,
    parseDelimited,
    parseDateCell,
    parseAmount,
    pdfTextLinesToRows
  };
})();
