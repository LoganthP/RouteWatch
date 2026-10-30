/**
 * Robust Excel (.xlsx) reader for RouteWatch.
 * Shared by both dataset inspection (preview/describe) and dataset import.
 *
 * Capabilities:
 * - Single shared readExcel() for inspect & import.
 * - Non-streaming (ExcelJS readFile) for files <= 50 MB; streaming WorkbookReader for > 50 MB
 *   with non-streaming fallback if memory allows.
 * - Automatic header detection (first row with >= 2 non-empty text cells within the first 20 rows).
 * - Guaranteed unique headers (column, column_1, etc.).
 * - Cell normalization: formula results, rich text to plain text, hyperlinks to text,
 *   Excel date serials & Date objects to ISO strings, merged cells to top-left master value.
 * - Multi-sheet support: each non-empty visible sheet is returned as { name, headers, rows }.
 * - Empty and hidden sheets are skipped gracefully with user-facing warnings, never crashing.
 * - Clear HTTP 400 user errors for password-protected, legacy .xls, and corrupt files.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const ExcelJS = require('exceljs');

const STREAM_THRESHOLD = 50 * 1024 * 1024; // 50 MB

function userError(msg, status = 400) {
  const err = new Error(msg);
  err.status = status;
  err.code = 'DATASET_PARSE_ERROR';
  return err;
}

/** Check if a number format string corresponds to date or time. */
function isDateNumFmt(numFmt) {
  if (!numFmt || typeof numFmt !== 'string') return false;
  const lower = numFmt.toLowerCase();
  // Reject formats that are clearly currency, percentages, or plain numbers
  if (/(\$|€|£|¥|%|0\.00#)/.test(lower)) return false;
  return /yy|mm|dd|hh|ss|m\/d|d\/m/.test(lower);
}

/** Convert an Excel serial date number to an ISO date string. */
function excelSerialToIso(serial) {
  if (typeof serial !== 'number' || isNaN(serial) || serial < 1 || serial > 2958465) return null;
  // Excel incorrectly considers 1900 a leap year: days after 1900-02-28 offset by 25569, else 25568
  const utcDays = serial - (serial > 60 ? 25569 : 25568);
  const ms = Math.round(utcDays * 86400000);
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Normalize any cell value according to RouteWatch specifications. */
function normalizeCellValue(cell, colHeader = '') {
  if (cell === null || cell === undefined) return '';

  // Merged cells: resolve to master (top-left) cell
  const effectiveCell = (cell.isMerged && cell.master) ? cell.master : cell;
  let val = effectiveCell.value;

  if (val === null || val === undefined) return '';

  // 1. Formula: use calculated result
  if (typeof val === 'object' && val.formula) {
    val = val.result !== undefined ? val.result : '';
  }

  // 2. Rich text: extract plain concatenated text
  if (typeof val === 'object' && Array.isArray(val.richText)) {
    return val.richText.map((t) => t.text || '').join('').trim();
  }

  // 3. Hyperlink: use display text or target url
  if (typeof val === 'object' && (val.hyperlink || val.text)) {
    return String(val.text || val.hyperlink || '').trim();
  }

  // 4. Date object: convert to ISO string
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? '' : val.toISOString();
  }
  if (effectiveCell.type === 4 /* ExcelJS.ValueType.Date */) {
    const d = val instanceof Date ? val : new Date(val);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }

  // 5. Excel date serials
  if (typeof val === 'number') {
    const numFmt = effectiveCell.numFmt;
    const isDateFmt = isDateNumFmt(numFmt);
    const isDateCol = /date|time|timestamp|occurred|reported/i.test(colHeader);
    if ((isDateFmt || isDateCol) && val >= 1 && val <= 2958465) {
      const iso = excelSerialToIso(val);
      if (iso) return iso;
    }
    return val;
  }

  if (typeof val === 'object') {
    if (val.result !== undefined) return normalizeCellValue({ value: val.result }, colHeader);
    return JSON.stringify(val);
  }

  return val;
}

/** Deduplicate header names by appending _1, _2 etc. */
function makeUniqueHeaders(rawHeaders) {
  const seen = new Map();
  return rawHeaders.map((h, i) => {
    let name = String(h ?? '').trim();
    if (!name) name = `column_${i + 1}`;
    const lower = name.toLowerCase();
    if (seen.has(lower)) {
      const count = seen.get(lower) + 1;
      seen.set(lower, count);
      return `${name}_${count}`;
    }
    seen.set(lower, 0);
    return name;
  });
}

/** Detect the first row with >= 2 non-empty text cells within the first 20 rows. */
function detectHeaderRow(rowsValues) {
  for (let r = 0; r < Math.min(rowsValues.length, 20); r++) {
    const rowVals = rowsValues[r] || [];
    const textCells = rowVals.filter((v) => {
      if (v === null || v === undefined) return false;
      const s = String(v).trim();
      return s.length > 0 && isNaN(Number(s));
    });
    if (textCells.length >= 2) {
      return r;
    }
  }
  return -1;
}

/** Check file header magic bytes before parsing to reject password-protected or legacy .xls files. */
async function precheckExcelFile(filePath) {
  let fh = null;
  try {
    fh = await fsp.open(filePath, 'r');
    const buf = Buffer.alloc(8);
    const { bytesRead } = await fh.read(buf, 0, 8, 0);
    if (!bytesRead) throw userError('The Excel file is empty.');
    const hex = buf.subarray(0, 4).toString('hex').toLowerCase();
    if (hex === 'd0cf11e0') {
      // OLE Compound File (legacy .xls or password-protected Office OpenXML)
      throw userError('Password-protected Excel files or legacy .xls files are not supported. Save the workbook as unencrypted .xlsx or .csv.');
    }
  } finally {
    if (fh) await fh.close();
  }
}

/** Non-streaming reader (ExcelJS readFile) for files <= 50 MB. */
async function readExcelNonStreaming(filePath) {
  await precheckExcelFile(filePath);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch (err) {
    if (/password|encrypt/i.test(err.message)) {
      throw userError('Password-protected Excel files are not supported. Remove the password and try again.');
    }
    if (/corrupt|invalid|end of data|bad zip/i.test(err.message)) {
      throw userError(`Corrupt or damaged Excel file: ${err.message}`);
    }
    throw userError(`Failed to read Excel file: ${err.message}`);
  }

  const sheets = [];
  const warnings = [];

  for (const ws of workbook.worksheets) {
    // 1. Skip hidden sheets
    if (ws.state === 'hidden' || ws.state === 'veryHidden') {
      warnings.push(`Skipped sheet "${ws.name}": sheet is hidden.`);
      continue;
    }

    // 2. Skip empty sheets
    if (!ws.rowCount || ws.rowCount === 0) {
      warnings.push(`Skipped sheet "${ws.name}": sheet is empty.`);
      continue;
    }

    // Collect all rows and cells
    const rowsValues = [];
    const rowsCells = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const vals = [];
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        vals[colNumber - 1] = cell.value;
        cells[colNumber - 1] = cell;
      });
      rowsValues[rowNumber - 1] = vals;
      rowsCells[rowNumber - 1] = cells;
    });

    if (!rowsValues.length) {
      warnings.push(`Skipped sheet "${ws.name}": sheet has no rows.`);
      continue;
    }

    // 3. Header detection (within first 20 rows)
    let headerIdx = detectHeaderRow(rowsValues);
    if (headerIdx === -1) {
      // Fallback: look for the first non-empty row
      headerIdx = rowsValues.findIndex((r) => r && r.some((v) => v !== null && v !== undefined && String(v).trim().length > 0));
    }
    if (headerIdx === -1) {
      warnings.push(`Skipped sheet "${ws.name}": no data rows found.`);
      continue;
    }

    const rawHeaderVals = (rowsCells[headerIdx] || []).map((c) => (c ? c.value : ''));
    // Ensure at least one non-empty header or use defaults
    const headerCols = rawHeaderVals.length ? rawHeaderVals : ['column_1'];
    const headers = makeUniqueHeaders(headerCols);

    // 4. Data rows extraction
    const dataRows = [];
    for (let r = headerIdx + 1; r < rowsCells.length; r++) {
      const rowCells = rowsCells[r];
      if (!rowCells || !rowCells.length) continue;

      const obj = {};
      let hasData = false;
      headers.forEach((h, colIdx) => {
        const cell = rowCells[colIdx];
        const val = normalizeCellValue(cell, h);
        obj[h] = val;
        if (val !== '' && val !== null && val !== undefined) hasData = true;
      });

      if (hasData) {
        dataRows.push(obj);
      }
    }

    if (dataRows.length === 0) {
      warnings.push(`Skipped sheet "${ws.name}": sheet has headers but no data rows.`);
      continue;
    }

    sheets.push({
      name: ws.name,
      headers,
      rows: dataRows,
    });
  }

  if (sheets.length === 0) {
    throw userError(`The Excel file contains no readable sheets. ${warnings.join(' ')}`.trim());
  }

  return { sheets, warnings };
}

/** Streaming reader (WorkbookReader) for large files (> 50 MB), with fallback to non-streaming. */
async function readExcelStreaming(filePath, fileSize) {
  await precheckExcelFile(filePath);
  try {
    const stream = fs.createReadStream(filePath);
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(stream, {
      sharedStrings: 'cache',
      hyperlinks: 'ignore',
      styles: 'ignore',
      worksheets: 'emit',
      entries: 'emit',
    });

    const sheets = [];
    const warnings = [];

    for await (const sheetReader of reader) {
      const sheetName = sheetReader.name || `Sheet${sheets.length + 1}`;
      if (sheetReader.state === 'hidden' || sheetReader.state === 'veryHidden') {
        warnings.push(`Skipped sheet "${sheetName}": sheet is hidden.`);
        continue;
      }

      let headers = null;
      const initialRows = [];
      const rowsQueue = [];

      // Read sheet rows
      for await (const row of sheetReader) {
        const rawVals = Array.isArray(row.values) ? row.values.slice(1) : [];
        if (!headers) {
          initialRows.push(rawVals);
          if (initialRows.length >= 20 || rawVals.filter((v) => typeof v === 'string' && isNaN(Number(v))).length >= 2) {
            const hIdx = detectHeaderRow(initialRows);
            if (hIdx !== -1) {
              headers = makeUniqueHeaders(initialRows[hIdx]);
              // Push any data rows after the header from initialRows
              for (let k = hIdx + 1; k < initialRows.length; k++) {
                const rVals = initialRows[k];
                if (rVals.some((v) => v !== null && v !== undefined && String(v).trim().length > 0)) {
                  const obj = {};
                  headers.forEach((h, colIdx) => { obj[h] = normalizeCellValue({ value: rVals[colIdx] }, h); });
                  rowsQueue.push(obj);
                }
              }
            }
          }
          continue;
        }

        if (rawVals.some((v) => v !== null && v !== undefined && String(v).trim().length > 0)) {
          const obj = {};
          headers.forEach((h, colIdx) => { obj[h] = normalizeCellValue({ value: rawVals[colIdx] }, h); });
          rowsQueue.push(obj);
        }
      }

      if (!headers && initialRows.length > 0) {
        headers = makeUniqueHeaders(initialRows[0]);
        for (let k = 1; k < initialRows.length; k++) {
          const rVals = initialRows[k];
          if (rVals.some((v) => v !== null && v !== undefined && String(v).trim().length > 0)) {
            const obj = {};
            headers.forEach((h, colIdx) => { obj[h] = normalizeCellValue({ value: rVals[colIdx] }, h); });
            rowsQueue.push(obj);
          }
        }
      }

      if (!headers || rowsQueue.length === 0) {
        warnings.push(`Skipped sheet "${sheetName}": sheet has no valid data.`);
        continue;
      }

      sheets.push({
        name: sheetName,
        headers,
        rows: rowsQueue,
      });
    }

    if (sheets.length === 0) {
      throw userError(`The Excel file contains no readable sheets. ${warnings.join(' ')}`.trim());
    }

    return { sheets, warnings };
  } catch (err) {
    if (err.status === 400) throw err;
    // If streaming fails and memory allows, fallback to non-streaming
    const memUsage = process.memoryUsage().heapUsed;
    if (memUsage < 1024 * 1024 * 1024) {
      console.warn(`[excel] Streaming reader failed (${err.message}). Falling back to non-streaming reader.`);
      return readExcelNonStreaming(filePath);
    }
    throw userError(`Failed to process large Excel file (${Math.round(fileSize / (1024 * 1024))} MB): ${err.message}. Convert to CSV for optimal streaming.`);
  }
}

/**
 * Shared readExcel function for both inspection and import.
 * Returns { sheets: [{ name, headers, rows }], warnings: [] }
 */
async function readExcel(filePath) {
  let stats;
  try {
    stats = await fsp.stat(filePath);
  } catch (e) {
    throw userError(`Excel file not found: ${e.message}`, 404);
  }

  if (stats.size > STREAM_THRESHOLD) {
    return readExcelStreaming(filePath, stats.size);
  }
  return readExcelNonStreaming(filePath);
}

module.exports = {
  readExcel,
  normalizeCellValue,
  makeUniqueHeaders,
  detectHeaderRow,
  userError,
  STREAM_THRESHOLD,
};

