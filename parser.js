(() => {
  "use strict";

  async function readStatementRows(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".csv") || name.endsWith(".tsv")) {
      const text = await file.text();
      return parseDelimited(text, name.endsWith(".tsv") ? "\t" : ",");
    }
    if (name.endsWith(".xlsx")) {
      return readXlsxRows(await file.arrayBuffer());
    }
    throw new Error("Unsupported file type. Upload an .xlsx, .csv, or .tsv statement export.");
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

  function importStatementFromRows(rows, fileName, maskRules = []) {
    const masks = normalizeMaskRules(maskRules);
    const cleanRows = rows.map(row => Array.isArray(row) ? row.map(cell => maskValue(cell, masks)) : []);
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

    for (let i = headerIndex + 1; i < cleanRows.length; i++) {
      const row = cleanRows[i];
      const rawDate = valueAt(row, dateCol);
      const rawDescription = valueAt(row, descCol);
      const debit = parseAmount(valueAt(row, debitCol));
      const credit = parseAmount(valueAt(row, creditCol));
      if (!rawDate && !rawDescription && !debit && !credit) continue;
      const date = parseDateCell(rawDate);
      if (!date) continue;
      const amount = roundMoney((credit || 0) - (debit || 0));
      if (amount === 0) continue;

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

      const description = simplifyDescription(record);
      const category = guessCategory(record, description);
      transactions.push({
        id: `import-${transactions.length + 1}`,
        date,
        description,
        amount,
        category,
        excludeFromSpending: amount < 0 && category === "Reserve Transfer",
        isPayroll: amount > 0 && category === "Income",
        sourceCode: record.sourceCode,
        currency: record.currency
      });
    }

    transactions.sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    if (!statement.currencyCode) {
      statement.currencyCode = transactions.find(t => t.currency)?.currency || "SGD";
    }
    return { statement, transactions, sheetRows: cleanRows };
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
        replacement: String(rule?.replacement || "").trim()
      }))
      .filter(rule => rule.needle && rule.replacement)
      .sort((a, b) => b.needle.length - a.needle.length);
  }

  function maskValue(value, rules) {
    if (!rules.length || value == null || value === "") return value;
    let text = String(value);
    for (const rule of rules) {
      text = text.replace(new RegExp(escapeRegExp(rule.needle), "gi"), rule.replacement);
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

  function simplifyDescription(record) {
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
    if (isReserveRecord(record)) return "Transfer to other bank account";
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

  function isReserveRecord(record) {
    const hay = `${record.rawDescription} ${record.supplementary} ${record.clientReference} ${record.additionalReference}`.toLowerCase();
    return record.amount < 0 && (/other bank account/.test(hay) || /savings account/.test(hay) || /reserve account/.test(hay) || /\[.*bank account.*\]:ib/.test(hay));
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

  function guessCategory(record, description) {
    const code = record.sourceCode.toUpperCase();
    const hay = `${record.rawDescription} ${record.supplementary} ${record.supplementaryDescription} ${record.clientReference} ${record.additionalReference} ${description}`.toUpperCase();

    if (isPayrollRecord(record)) return "Income";
    if (code === "ATINT" || hay.includes("INTEREST EARNED")) return "Interest";
    if (isReserveRecord(record)) return "Reserve Transfer";
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
    parseAmount
  };
})();
