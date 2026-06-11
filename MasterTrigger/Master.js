// ═══════════════════════════════════════════════════════════════════════════════
// Review Automation — Unified DailyJob (Master.gs)
// To add a new monitored sheet, append one entry to SHEET_CONFIGS.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Global constants ──────────────────────────────────────────────────────────
const SRC_ID          = "1tMbA_msRfCRY0KK40GnyZ_h1uNCldlnk9Cg-_MTcbsw";
const FINALIZE_FILTER = "finalize";
const TEM_SHEET_NAME  = "tem";

// ── Sheet configuration ───────────────────────────────────────────────────────
//
// To add a new product sheet, copy any existing entry below and update the fields.
//
// ┌─────────────────┬──────────────────────────────────────────────────────────────────┐
// │ Field           │ Description                                                      │
// ├─────────────────┼──────────────────────────────────────────────────────────────────┤
// │ filterSheet     │ Name of the tab in the SOURCE spreadsheet (SRC_ID) that holds    │
// │                 │ the raw Apify-scraped reviews for this product.                  │
// │                 │ Must have a named filter view called "finalize" which defines     │
// │                 │ the date cutoff and any hidden-value exclusions.                 │
// ├─────────────────┼──────────────────────────────────────────────────────────────────┤
// │ destId          │ Google Spreadsheet ID of the DESTINATION workbook for this       │
// │                 │ product. Find it in the spreadsheet's URL:                       │
// │                 │ docs.google.com/spreadsheets/d/<destId>/edit                    │
// ├─────────────────┼──────────────────────────────────────────────────────────────────┤
// │ countries       │ Set of country codes to include. Only rows whose "Country" col   │
// │                 │ matches one of these values will be copied.                      │
// │                 │ Supported: "US","UK","DE","FR","ES","IT","JP","IN"               │
// ├─────────────────┼──────────────────────────────────────────────────────────────────┤
// │ numCols         │ Number of columns to copy from the source filter sheet.          │
// │                 │ Set this to the last data column index of the filter sheet        │
// │                 │ (count from A=1). Extra columns beyond this are ignored.         │
// ├─────────────────┼──────────────────────────────────────────────────────────────────┤
// │ has15           │ true  → dest workbook has BOTH a "1-5점" sheet and a "1-3점"     │
// │                 │         sheet. New rows go to 1-5점; =dr() formula is then set   │
// │                 │         on matching rows in 1-3점.                               │
// │                 │ false → dest workbook has only a "1-3점" sheet. Rows go there    │
// │                 │         directly.                                                │
// ├─────────────────┼──────────────────────────────────────────────────────────────────┤
// │ seriesFilter    │ Extra column filter applied on top of the "finalize" view.       │
// │                 │ { colLetter: "Q", contains: "S26" } means only rows where        │
// │                 │ column Q contains "S26" are included.                            │
// │                 │ Set to null to skip this filter.                                 │
// ├─────────────────┼──────────────────────────────────────────────────────────────────┤
// │ temCol          │ Column name in the "tem" sheet (source workbook) that holds this │
// │                 │ product's existing Review IDs. Used as a secondary dedup source  │
// │                 │ in addition to reading the dest sheet directly.                  │
// │                 │ Must match the header in the tem sheet exactly.                  │
// ├─────────────────┼──────────────────────────────────────────────────────────────────┤
// │ insertAtTop     │ (has15=false only) true  → new rows inserted at row 2 (newest   │
// │                 │ rows appear at the top). false / omitted → rows appended at      │
// │                 │ the bottom.                                                      │
// ├─────────────────┼──────────────────────────────────────────────────────────────────┤
// │ ratingFilter    │ (has15=false only) Array of allowed rating values, e.g. [1,2,3]. │
// │                 │ Only rows whose "Rating" col matches are included.               │
// │                 │ Omit or set null to include all ratings.                         │
// ├─────────────────┼──────────────────────────────────────────────────────────────────┤
// │ drFormula       │ true  → after pasting, write =dr(본문col, 대분류col) into the    │
// │                 │         "인입사유(AI)" column of 1-3점 for each new row.         │
// │                 │ false → skip =dr() entirely (sheet does not use AI classification)│
// ├─────────────────┼──────────────────────────────────────────────────────────────────┤
// │ pasteReviewId   │ true  → copy the "Review ID" value from the source filter sheet  │
// │                 │         into the dest sheet when pasting new rows.               │
// │                 │ false → leave the "Review ID" cell blank on paste. Use this when │
// │                 │         the dest sheet has a formula that auto-generates Review   │
// │                 │         ID from another column (e.g. Review Link).               │
// │                 │ Note: dedup always reads the dest "Review ID" col regardless of  │
// │                 │ this setting — formula-computed values are read correctly.        │
// └─────────────────┴──────────────────────────────────────────────────────────────────┘
//
const SHEET_CONFIGS = [
  {
    filterSheet:   "Glx26_filter",
    destId:        "1fpv9TEDPGR8D6QRRc0ll-WzF7sOkfxe9UNBCmdBSE9g",
    countries:     new Set(["US","FR","ES","JP","UK","IN","DE","IT"]),
    numCols:       13,
    has15:         true,
    seriesFilter:  { colLetter: "Q", contains: "S26" },
    temCol:        "Glx26",
    drFormula:     true,
    pasteReviewId: true,   // Review ID is a plain value in this sheet — paste from source
  },
  {
    filterSheet:   "iPh17e_filter",
    destId:        "16xRJHH7Ynii4erNOn_905ST4CZs6OLpOYTof4uqsGsQ",
    countries:     new Set(["US","FR","ES","JP","UK","IN","DE","IT"]),
    numCols:       10,
    has15:         true,
    seriesFilter:  { colLetter: "N", contains: "17e" },
    temCol:        "iPh17e",
    drFormula:     true,
    pasteReviewId: false, // Review ID is formula-generated — do not overwrite
  },
  {
    filterSheet:   "Pixel10a_filter",
    destId:        "1BpeGq5gIr4tNsPZmnHr19NNY6pQ6sb2_H-v3V9-It4E",
    countries:     new Set(["US","FR","ES","JP","UK","IN","DE","IT"]),
    numCols:       10,
    has15:         true,
    seriesFilter:  { colLetter: "N", contains: "10a" },
    temCol:        "Pixel 10a",
    drFormula:     true,
    pasteReviewId: false, // Review ID is formula-generated — do not overwrite
  },
  {
    filterSheet:   "SDA_filter",
    destId:        "1sxapIqJgXcJdeqyCf9bAxCNXrVMsVjsZE9QWPwEm0R4",
    countries:     new Set(["FR","ES","JP","UK","DE","IT"]),
    numCols:       9,
    has15:         false,
    seriesFilter:  null,
    temCol:        "SDA",
    drFormula:     false,
    pasteReviewId: false, // Review ID is auto-generated — do not overwrite
  },
  {
    filterSheet:   "Auto_Acc_filter",
    destId:        "1mEYb1b92D6BIOaSYkAnMit6THuw5ewtymhA-mSIVDfs",
    countries:     new Set(["FR","ES","UK","DE","IT"]),
    numCols:       9,
    has15:         false,
    seriesFilter:  null,
    temCol:        "Auto_Acc",
    drFormula:     false,
    pasteReviewId: false,
  },
  {
    filterSheet:   "Power_Acc_filter",
    destId:        "1QC8Is6UvTnFXaOeXviKM_331i3Fo_CBIYx80VS696LI",
    countries:     new Set(["FR","ES","UK","DE","IT","IN"]),
    numCols:       9,
    has15:         false,
    seriesFilter:  null,
    temCol:        "Power_Acc",
    drFormula:     false,
    pasteReviewId: false,
  },
  {
    filterSheet:   "전략폰_filter",
    destId:        "1yo8CbLhJkuxrf3eXbAqZCb6qBejZhSR3YOt7nFv97fw",
    countries:     new Set(["IN"]),
    numCols:       9,
    has15:         false,
    seriesFilter:  null,
    temCol:        "전략폰",
    drFormula:     false,
    pasteReviewId: false,
  },
  {
    filterSheet:   "유지훈P_filter",
    destId:        "1dlY6q8trbVMVJAjw_OUoxp1cguA2oTB8WlPhHR01xIw",
    countries:     new Set(["US","FR","ES","JP","UK","IN","DE","IT"]),
    numCols:       10,
    has15:         false,
    seriesFilter:  null,
    temCol:        "유지훈P",
    insertAtTop:   true,
    ratingFilter:  [1,2,3],
    drFormula:     true,
    pasteReviewId: false
  },
];

// ── Master daily job ──────────────────────────────────────────────────────────
function dailyJob() {
  const srcSS = SpreadsheetApp.openById(SRC_ID);
  step1_deleteNumberedSheets(srcSS);
  step2_dedupDatedSheets(srcSS);
  step2b_updateTemSheet(srcSS);
  for (const cfg of SHEET_CONFIGS) {
    if (cfg.destId.startsWith("TODO")) {
      Logger.log(`  [${cfg.filterSheet}] Skipped — destId not configured`);
      continue;
    }
    try {
      cfg.has15 ? _processFilterSheet_(srcSS, cfg) : _processTo13_(srcSS, cfg);
    } catch (e) {
      Logger.log(`  [${cfg.filterSheet}] ERROR: ${e.message}`);
    }
  }
  Logger.log("✓ All daily jobs complete");
}

// ── Individual entry points ───────────────────────────────────────────────────
function dailyJob_Glx26()       { _runSingle("Glx26_filter"); }
function dailyJob_iPh17e()      { _runSingle("iPh17e_filter"); }
function dailyJob_Pixel10a()    { _runSingle("Pixel10a_filter"); }
function dailyJob_SDA()         { _runSingle("SDA_filter"); }
function dailyJob_AutoAcc()     { _runSingle("Auto_Acc_filter"); }
function dailyJob_PowerAcc()    { _runSingle("Power_Acc_filter"); }
function dailyJob_Jeonryagpon() { _runSingle("전략폰_filter"); }
function dailyJob_유지훈P()     { _runSingle("유지훈P_filter"); }

function _runSingle(filterSheet) {
  const cfg = SHEET_CONFIGS.find(c => c.filterSheet === filterSheet);
  if (!cfg) { Logger.log(`No config for ${filterSheet}`); return; }
  if (cfg.destId.startsWith("TODO")) { Logger.log(`destId not configured for ${filterSheet}`); return; }
  const srcSS = SpreadsheetApp.openById(SRC_ID);
  step1_deleteNumberedSheets(srcSS);
  step2_dedupDatedSheets(srcSS);
  cfg.has15 ? _processFilterSheet_(srcSS, cfg) : _processTo13_(srcSS, cfg);
  Logger.log(`✓ ${filterSheet} job complete`);
}

// ── Step 1: Delete XXX_yymmdd_n sheets ───────────────────────────────────────
function step1_deleteNumberedSheets(ss) {
  const kst         = new Date(Date.now() + 9 * 3600 * 1000);
  const todayYYMMDD = Utilities.formatDate(kst, "UTC", "yyMMdd");
  let deleted = 0;
  ss.getSheets().forEach(s => {
    const name = s.getName();
    if (/\d{6}_\d+$/.test(name))                { ss.deleteSheet(s); deleted++; return; }
    if (name.toLowerCase().includes("conflict")) { ss.deleteSheet(s); deleted++; return; }
    const m = name.match(/(\d{6})$/);
    if (m && m[1] !== todayYYMMDD)               { ss.deleteSheet(s); deleted++; return; }
  });
  Logger.log(`Step 1: Deleted ${deleted} sheet(s) — today KST: ${todayYYMMDD}`);
}

// ── Step 2: Dedup XXX_yymmdd sheets ──────────────────────────────────────────
function step2_dedupDatedSheets(ss) {
  let total = 0;
  ss.getSheets().forEach(s => {
    if (/\d{6}$/.test(s.getName())) total += _dedupSheet(s);
  });
  Logger.log(`Step 2: Removed ${total} duplicate row(s)`);
}

function _dedupSheet(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length === 0) return 0;
  const header = data[0];
  const ridCol = header.findIndex(h =>
    ["reviewid","review_id","review id"].includes(String(h).trim().toLowerCase())
  );
  if (ridCol === -1) return 0;
  const seen = new Set();
  const keep = [header];
  let removed = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const a = String(row[0]||"").trim();
    const b = String(row[1]||"").trim();
    const c = String(row[2]||"").trim();
    if (!a && !b && !c) { removed++; continue; }
    const rid = String(row[ridCol]||"").trim();
    if (seen.has(rid)) { removed++; } else { keep.push(row); seen.add(rid); }
  }
  if (removed === 0) return 0;
  sheet.clearContents();
  sheet.getRange(1, 1, keep.length, header.length).setValues(keep);
  Logger.log(`  [${sheet.getName()}] Removed ${removed}`);
  return removed;
}

// ── Step 2b: Refresh "tem" sheet with Review IDs ──────────────────────────────
function step2b_updateTemSheet(srcSS) {
  const temSheet = srcSS.getSheetByName(TEM_SHEET_NAME);
  if (!temSheet) { Logger.log("Step 2b: 'tem' sheet not found — skipping"); return; }

  const temHdr = temSheet.getRange(1, 1, 1, temSheet.getLastColumn()).getValues()[0];

  for (const cfg of SHEET_CONFIGS) {
    if (!cfg.temCol) continue;
    if (cfg.destId.startsWith("TODO")) continue;

    const temColIdx = temHdr.findIndex(h => String(h).trim() === cfg.temCol);
    if (temColIdx < 0) { Logger.log(`  [tem] '${cfg.temCol}' col not found — skipping`); continue; }

    try {
      const destSS    = SpreadsheetApp.openById(cfg.destId);
      const sheetName = cfg.has15 ? "1-5점" : "1-3점";
      const destWs    = destSS.getSheetByName(sheetName);
      if (!destWs) { Logger.log(`  [tem/${cfg.temCol}] ${sheetName} not found`); continue; }

      const destHdr   = destWs.getRange(1, 1, 1, destWs.getLastColumn()).getValues()[0];
      const ridColIdx = _colIdx(destHdr, "Review ID");
      if (ridColIdx < 0) { Logger.log(`  [tem/${cfg.temCol}] No 'Review ID' col`); continue; }

      const lastRow = destWs.getLastRow();
      if (lastRow < 2) { Logger.log(`  [tem/${cfg.temCol}] No data`); continue; }

      const ids = destWs.getRange(2, ridColIdx + 1, lastRow - 1, 1).getValues()
                    .map(r => [String(r[0]||"").trim()]).filter(r => r[0]);

      const temLastRow = temSheet.getLastRow();
      if (temLastRow >= 2) {
        temSheet.getRange(2, temColIdx + 1, temLastRow - 1, 1).clearContent();
      }
      if (ids.length > 0) {
        if (1 + ids.length > temSheet.getMaxRows()) {
          temSheet.insertRowsAfter(temSheet.getMaxRows(), ids.length);
        }
        temSheet.getRange(2, temColIdx + 1, ids.length, 1).setValues(ids);
      }
      Logger.log(`  [tem/${cfg.temCol}] ${ids.length} Review ID(s) updated`);
    } catch (e) {
      Logger.log(`  [tem/${cfg.temCol}] Error: ${e.message}`);
    }
  }
  Logger.log("Step 2b: tem sheet updated");
}

// ── Shared: filter sheet → 1-5점 + 1-3점 ─────────────────────────────────────
// For has15=true sheets: Glx26, iPh17e, Pixel10a
function _processFilterSheet_(srcSS, cfg) {
  const { filterSheet, destId, countries, numCols, seriesFilter, drFormula } = cfg;

  const meta = Sheets.Spreadsheets.get(SRC_ID, { fields: "sheets(properties/title,filterViews)" });
  let crit = {};
  for (const s of meta.sheets) {
    if (s.properties.title === filterSheet) {
      for (const fv of (s.filterViews || [])) {
        if (fv.title === FINALIZE_FILTER) { crit = fv.criteria || {}; break; }
      }
      break;
    }
  }

  let dateAfter = null, dateColIdx = -1;
  let hiddenValues = new Set(), hiddenColIdx = -1;
  for (const [key, val] of Object.entries(crit)) {
    const idx = parseInt(key);
    if ((val.hiddenValues || []).length > 0) {
      hiddenValues = new Set(val.hiddenValues); hiddenColIdx = idx;
    } else {
      const uv = val.condition?.values?.[0]?.userEnteredValue;
      if (uv && /^\d{4}-\d{2}-\d{2}$/.test(uv)) { dateAfter = uv; dateColIdx = idx; }
    }
  }

  const srcSheet = srcSS.getSheetByName(filterSheet);
  if (!srcSheet) { Logger.log(`  [${filterSheet}] Sheet not found`); return; }
  const srcData = srcSheet.getDataRange().getValues();
  if (srcData.length < 2) { Logger.log(`  [${filterSheet}] Empty`); return; }

  const hdr           = srcData[0];
  const countryColIdx = _colIdx(hdr, "Country");
  const srcRidColIdx  = _colIdx(hdr, "Review ID") >= 0 ? _colIdx(hdr, "Review ID") : _colIdxContains(hdr, "Review ID");
  const bodyColIdx    = _colIdx(hdr, "Content");
  const seriesColIdx  = seriesFilter ? _letterToIdx(seriesFilter.colLetter) : -1;

  function cell(row, i) { return i >= 0 && i < row.length ? String(row[i]||"").trim() : ""; }
  function fmtISO(v) {
    if (v instanceof Date) return Utilities.formatDate(v, "UTC", "yyyy-MM-dd");
    return String(v||"").trim();
  }

  let filtered = srcData.slice(1).filter(row => {
    if (dateColIdx    >= 0 && dateAfter && (fmtISO(row[dateColIdx]) <= dateAfter || !fmtISO(row[dateColIdx]))) return false;
    if (countryColIdx >= 0 && !countries.has(cell(row, countryColIdx))) return false;
    if (hiddenColIdx  >= 0 && hiddenValues.has(cell(row, hiddenColIdx))) return false;
    if (seriesColIdx  >= 0 && seriesFilter && !cell(row, seriesColIdx).includes(seriesFilter.contains)) return false;
    return true;
  });

  const destSS = SpreadsheetApp.openById(destId);
  const dest15 = destSS.getSheetByName("1-5점");
  if (!dest15) { Logger.log(`  [${filterSheet}] 1-5점 not found in dest`); return; }
  const d15Hdr = dest15.getRange(1, 1, 1, dest15.getLastColumn()).getValues()[0];

  const destRidIdx  = _colIdx(d15Hdr, "Review ID") >= 0 ? _colIdx(d15Hdr, "Review ID") : _colIdxContains(d15Hdr, "Review ID");
  const existingIds = new Set();
  // Primary: pull existing IDs from dest 1-5점
  if (destRidIdx >= 0 && dest15.getLastRow() > 1) {
    dest15.getRange(2, destRidIdx + 1, dest15.getLastRow() - 1, 1).getValues()
      .forEach(r => { const v = String(r[0]||"").trim(); if (v) existingIds.add(v); });
  }
  // Backup: also pull from tem sheet (refreshed by step2b) to catch any gap
  const temSheet15 = srcSS.getSheetByName(TEM_SHEET_NAME);
  if (temSheet15 && cfg.temCol) {
    const temHdr15   = temSheet15.getRange(1, 1, 1, temSheet15.getLastColumn()).getValues()[0];
    const temColIdx15 = temHdr15.findIndex(h => String(h).trim() === cfg.temCol);
    if (temColIdx15 >= 0 && temSheet15.getLastRow() > 1) {
      temSheet15.getRange(2, temColIdx15 + 1, temSheet15.getLastRow() - 1, 1).getValues()
        .forEach(r => { const v = String(r[0]||"").trim(); if (v) existingIds.add(v); });
    }
  }
  Logger.log(`  [${filterSheet}] destRidIdx=${destRidIdx}, srcRidColIdx=${srcRidColIdx}, existingIds.size=${existingIds.size}`);
  if (srcRidColIdx >= 0) {
    const before = filtered.length;
    filtered = filtered.filter(r => !existingIds.has(cell(r, srcRidColIdx)));
    Logger.log(`  [${filterSheet}] Skipped ${before - filtered.length} existing row(s) → ${filtered.length} new`);

    // Intra-batch dedup: same Review ID can appear multiple times in the filter
    // sheet when Apify scrapes the same review across multiple runs on different days.
    const seenInBatch = new Set();
    const beforeBatch = filtered.length;
    filtered = filtered.filter(r => {
      const rid = cell(r, srcRidColIdx);
      if (!rid || seenInBatch.has(rid)) return false;
      seenInBatch.add(rid);
      return true;
    });
    if (beforeBatch - filtered.length > 0) {
      Logger.log(`  [${filterSheet}] Intra-batch dedup: removed ${beforeBatch - filtered.length} duplicate(s), ${filtered.length} remain`);
    }
  } else {
    Logger.log(`  [${filterSheet}] WARNING: srcRidColIdx not found — dedup skipped, all ${filtered.length} rows will paste`);
  }

  const kst      = new Date(Date.now() + 9 * 3600 * 1000);
  const todayKst = Utilities.formatDate(kst, "UTC", "yyyy-MM-dd");
  let   copied   = 0;

  if (filtered.length > 0) {
    const colAVals = dest15.getRange(1, 1, dest15.getLastRow() || 1, 1).getValues();
    let destLast = 0;
    for (let i = colAVals.length - 1; i >= 0; i--) {
      if (String(colAVals[i][0]).trim() !== "") { destLast = i + 1; break; }
    }

    if (destLast + filtered.length > dest15.getMaxRows()) {
      dest15.insertRowsAfter(dest15.getMaxRows(), filtered.length + 100);
    }

    const rows = filtered.map(r => {
      const row = r.slice(0, numCols);
      while (row.length < numCols) row.push("");
      // Clear Review ID slot — will be written explicitly from source below
      if (destRidIdx >= 0 && destRidIdx < numCols) row[destRidIdx] = "";
      return row;
    });

    if (destLast >= 2) {
      const fmtSrc = dest15.getRange(destLast, 1, 1, dest15.getLastColumn());
      const fmtDst = dest15.getRange(destLast + 1, 1, rows.length, dest15.getLastColumn());
      fmtSrc.copyTo(fmtDst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      fmtSrc.copyTo(fmtDst, SpreadsheetApp.CopyPasteType.PASTE_CONDITIONAL_FORMATTING, false);
      fmtSrc.copyTo(fmtDst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    }

    dest15.getRange(destLast + 1, 1, rows.length, numCols).setValues(rows);

    // Write Review ID values from source only if pasteReviewId: true in config.
    // If false, leave the cell blank — the dest sheet has a formula that derives
    // Review ID from another column (e.g. Review Link).
    if (cfg.pasteReviewId && srcRidColIdx >= 0 && destRidIdx >= 0) {
      const ridValues = filtered.map(r => [String(r[srcRidColIdx] || "").trim()]);
      dest15.getRange(destLast + 1, destRidIdx + 1, rows.length, 1).setValues(ridValues);
      Logger.log(`  [1-5점] Wrote ${ridValues.length} Review ID(s) from source`);
    } else if (!cfg.pasteReviewId) {
      Logger.log(`  [1-5점] Skipped Review ID paste — pasteReviewId: false`);
    }

    const kwIdx = _colIdx(d15Hdr, "키워드 (AI 요약)");
    if (kwIdx >= 0 && bodyColIdx >= 0) {
      const kwValues = filtered.map(r => [_summarizeReview_(String(r[bodyColIdx] || '').trim())]);
      dest15.getRange(destLast + 1, kwIdx + 1, rows.length, 1).setValues(kwValues);
      Logger.log(`  [1-5점] Wrote 키워드 AI summaries for ${kwValues.length} row(s)`);
    }

    const updIdx = _colIdx(d15Hdr, "Update 날짜") >= 0
      ? _colIdx(d15Hdr, "Update 날짜")
      : _colIdx(d15Hdr, "Exported Date");
    if (updIdx >= 0) {
      dest15.getRange(destLast + 1, updIdx + 1, rows.length, 1).setValues(rows.map(() => [todayKst]));
    }

    Logger.log(`  [1-5점] Copied ${rows.length} row(s) — 키워드 + Update 날짜`);
    copied = rows.length;
  } else {
    Logger.log(`  [${filterSheet}] Nothing new to copy`);
  }

  try {
    const dest13 = destSS.getSheetByName("1-3점");
    if (dest13) {
      SpreadsheetApp.flush();
      const d13LastRow   = dest13.getLastRow();
      const d13All       = dest13.getDataRange().getValues();
      const d13Hdr       = d13All[0];
      const updIdx13     = _colIdx(d13Hdr, "Update 날짜") >= 0
        ? _colIdx(d13Hdr, "Update 날짜")
        : _colIdx(d13Hdr, "Exported Date");
      const aiIdx13      = _colIdxContains(d13Hdr, "인입사유(AI)");
      const destRidIdx13 = _colIdx(d13Hdr, "Review ID");
      const bonmunIdx    = _colIdx(d13Hdr, "본문");
      const daebunIdx    = _colIdx(d13Hdr, "대분류");
      const bonmunLetter = bonmunIdx >= 0 ? _colLetter(bonmunIdx + 1) : "G";
      const daebunLetter = daebunIdx >= 0 ? _colLetter(daebunIdx + 1) : "V";
      const todayKorean  = `${kst.getUTCFullYear()}. ${kst.getUTCMonth()+1}. ${kst.getUTCDate()}`;

      Logger.log(`  [1-3점] 본문→${bonmunLetter}, 대분류→${daebunLetter}, 인입사유(AI) col: ${aiIdx13}, Review ID col: ${destRidIdx13}`);

      if (drFormula && updIdx13 >= 0 && aiIdx13 >= 0) {
        const defectCats = _loadDefectCategories_(destSS);
        let count = 0;
        for (let i = 1; i < d13All.length; i++) {
          const row    = d13All[i];
          const rowNum = i + 1;
          if (_koreanDate(row[updIdx13]).includes(todayKorean) &&
              String(row[aiIdx13]||"").trim() === "") {
            const body   = bonmunIdx >= 0 ? String(row[bonmunIdx] || '').trim() : '';
            const result = _classifyReview_(body, defectCats);
            if (result) { dest13.getRange(rowNum, aiIdx13 + 1).setValue(result); count++; }
          }
        }
        Logger.log(`  [1-3점] Classified 인입사유(AI) for ${count} row(s) via direct Gemini call`);
      } else if (!drFormula) {
        Logger.log(`  [1-3점] Skipped DR classify — drFormula: false for ${filterSheet}`);
      } else {
        Logger.log(`  [1-3점] Skipped DR classify — updIdx13: ${updIdx13}, aiIdx13: ${aiIdx13}`);
      }

      // Review ID in 1-3점: same direct-value approach — find today's new rows
      // (those whose Update 날짜 matches today and whose Review ID is empty)
      // and write their IDs from the 1-5점 sheet's freshly written Review IDs.
      // Since 1-3점 rows are a subset of 1-5점, we match by row position is
      // unreliable; skip formula-copy entirely — IDs were already written to
      // 1-5점 and 1-3점 doesn't independently need re-derivation here.
      // (1-3점 for has15=true sheets is populated via the filter on 1-5점 data,
      //  not by independent paste — so Review ID was already set above.)
    }
  } catch (e) {
    Logger.log(`  [1-3점] Error: ${e.message}`);
  }

  Logger.log(`Step 3 [${filterSheet}]: Copied ${copied} row(s)`);
}

// ── Shared: filter sheet → 1-3점 only ────────────────────────────────────────
// For has15=false sheets: SDA, Auto_Acc, Power_Acc, 전략폰, 유지훈P
function _processTo13_(srcSS, cfg) {
  const { filterSheet, destId, countries, numCols, seriesFilter, insertAtTop, ratingFilter, drFormula } = cfg;

  const meta = Sheets.Spreadsheets.get(SRC_ID, { fields: "sheets(properties/title,filterViews)" });
  let crit = {};
  for (const s of meta.sheets) {
    if (s.properties.title === filterSheet) {
      for (const fv of (s.filterViews || [])) {
        if (fv.title === FINALIZE_FILTER) { crit = fv.criteria || {}; break; }
      }
      break;
    }
  }

  let dateAfter = null, dateColIdx = -1;
  let hiddenValues = new Set(), hiddenColIdx = -1;
  for (const [key, val] of Object.entries(crit)) {
    const idx = parseInt(key);
    if ((val.hiddenValues || []).length > 0) {
      hiddenValues = new Set(val.hiddenValues); hiddenColIdx = idx;
    } else {
      const uv = val.condition?.values?.[0]?.userEnteredValue;
      if (uv && /^\d{4}-\d{2}-\d{2}$/.test(uv)) { dateAfter = uv; dateColIdx = idx; }
    }
  }

  const srcSheet = srcSS.getSheetByName(filterSheet);
  if (!srcSheet) { Logger.log(`  [${filterSheet}] Sheet not found`); return; }
  const srcData = srcSheet.getDataRange().getValues();
  if (srcData.length < 2) { Logger.log(`  [${filterSheet}] Empty`); return; }

  const hdr           = srcData[0];
  const countryColIdx = _colIdx(hdr, "Country");
  const srcRidColIdx  = _colIdx(hdr, "Review ID") >= 0 ? _colIdx(hdr, "Review ID") : _colIdxContains(hdr, "Review ID");
  const seriesColIdx  = seriesFilter ? _letterToIdx(seriesFilter.colLetter) : -1;
  const ratingColIdx  = ratingFilter ? _colIdx(hdr, "Rating") : -1;

  function cell(row, i) { return i >= 0 && i < row.length ? String(row[i]||"").trim() : ""; }
  function fmtISO(v) {
    if (v instanceof Date) return Utilities.formatDate(v, "UTC", "yyyy-MM-dd");
    return String(v||"").trim();
  }

  let filtered = srcData.slice(1).filter(row => {
    if (dateColIdx    >= 0 && dateAfter && (fmtISO(row[dateColIdx]) <= dateAfter || !fmtISO(row[dateColIdx]))) return false;
    if (countryColIdx >= 0 && !countries.has(cell(row, countryColIdx))) return false;
    if (hiddenColIdx  >= 0 && hiddenValues.has(cell(row, hiddenColIdx))) return false;
    if (seriesColIdx  >= 0 && seriesFilter && !cell(row, seriesColIdx).includes(seriesFilter.contains)) return false;
    if (ratingColIdx  >= 0 && ratingFilter && !ratingFilter.includes(Number(cell(row, ratingColIdx)))) return false;
    return true;
  });

  const destSS = SpreadsheetApp.openById(destId);
  const dest13 = destSS.getSheetByName("1-3점");
  if (!dest13) { Logger.log(`  [${filterSheet}] 1-3점 not found in dest`); return; }

  const d13Hdr  = dest13.getRange(1, 1, 1, dest13.getLastColumn()).getValues()[0];
  const d13Data = dest13.getDataRange().getValues();

  const destRidIdx  = _colIdx(d13Hdr, "Review ID") >= 0 ? _colIdx(d13Hdr, "Review ID") : _colIdxContains(d13Hdr, "Review ID");
  const existingIds = new Set();
  if (destRidIdx >= 0) {
    d13Data.slice(1).forEach(r => { const v = String(r[destRidIdx]||"").trim(); if (v) existingIds.add(v); });
  }
  Logger.log(`  [${filterSheet}] destRidIdx=${destRidIdx}, srcRidColIdx=${srcRidColIdx}, existingIds.size=${existingIds.size}`);
  if (srcRidColIdx >= 0) {
    const before = filtered.length;
    filtered = filtered.filter(r => !existingIds.has(cell(r, srcRidColIdx)));
    Logger.log(`  [${filterSheet}] Skipped ${before - filtered.length} existing row(s) → ${filtered.length} new`);

    // Intra-batch dedup: same Review ID can appear multiple times in the filter
    // sheet when Apify scrapes the same review across multiple runs on different days.
    const seenInBatch = new Set();
    const beforeBatch = filtered.length;
    filtered = filtered.filter(r => {
      const rid = cell(r, srcRidColIdx);
      if (!rid || seenInBatch.has(rid)) return false;
      seenInBatch.add(rid);
      return true;
    });
    if (beforeBatch - filtered.length > 0) {
      Logger.log(`  [${filterSheet}] Intra-batch dedup: removed ${beforeBatch - filtered.length} duplicate(s), ${filtered.length} remain`);
    }
  } else {
    Logger.log(`  [${filterSheet}] WARNING: srcRidColIdx not found — dedup skipped, all ${filtered.length} rows will paste`);
  }

  if (filtered.length === 0) { Logger.log(`  [${filterSheet}] Nothing new to copy`); return; }

  const kst         = new Date(Date.now() + 9 * 3600 * 1000);
  const todayKorean = `${kst.getUTCFullYear()}. ${kst.getUTCMonth()+1}. ${kst.getUTCDate()}`;
  const updIdx      = _colIdx(d13Hdr, "Update 날짜") >= 0
    ? _colIdx(d13Hdr, "Update 날짜")
    : _colIdx(d13Hdr, "Exported Date");

  const aiIdx        = _colIdxContains(d13Hdr, "인입사유(AI)");
  const bonmunIdx    = _colIdx(d13Hdr, "본문");
  const daebunIdx    = _colIdx(d13Hdr, "대분류");
  const bonmunLetter = bonmunIdx >= 0 ? _colLetter(bonmunIdx + 1) : "G";
  const daebunLetter = daebunIdx >= 0 ? _colLetter(daebunIdx + 1) : "V";
  Logger.log(`  [${filterSheet}] 인입사유(AI) col: ${aiIdx}, 본문→${bonmunLetter}, 대분류→${daebunLetter}`);

  const rows = filtered.map(r => {
    const row = r.slice(0, numCols);
    while (row.length < numCols) row.push("");
    // Always clear Review ID slot in the pasted data — either written back from source
    // (skipDestRid=false) or left blank for the dest sheet's formula to populate (skipDestRid=true)
    if (destRidIdx >= 0 && destRidIdx < numCols) row[destRidIdx] = "";
    return row;
  });

  if (insertAtTop) {
    const lastCol = dest13.getLastColumn();

    // Save both values and formulas from row 1 before insertion.
    const row1Formulas = dest13.getRange(1, 1, 1, lastCol).getFormulas()[0];
    const row1Values   = dest13.getRange(1, 1, 1, lastCol).getValues()[0];

    dest13.insertRowsAfter(1, filtered.length);

    // Step 1: restore plain-text headers via setValues
    dest13.getRange(1, 1, 1, lastCol).setValues([row1Values]);
    // Step 2: overwrite formula cells with their original formulas
    for (let c = 0; c < lastCol; c++) {
      if (row1Formulas[c]) {
        dest13.getRange(1, c + 1).setFormula(row1Formulas[c]);
      }
    }

    const fmtSrcRow    = filtered.length + 2;
    const srcFmtRange  = dest13.getRange(fmtSrcRow, 1, 1, lastCol);
    const destFmtRange = dest13.getRange(2, 1, filtered.length, lastCol);
    srcFmtRange.copyTo(destFmtRange, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    srcFmtRange.copyTo(destFmtRange, SpreadsheetApp.CopyPasteType.PASTE_CONDITIONAL_FORMATTING, false);
    srcFmtRange.copyTo(destFmtRange, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);

    dest13.getRange(2, 1, rows.length, numCols).setValues(rows);

    if (cfg.pasteReviewId && srcRidColIdx >= 0 && destRidIdx >= 0) {
      const ridValues = filtered.map(r => [String(r[srcRidColIdx] || "").trim()]);
      dest13.getRange(2, destRidIdx + 1, rows.length, 1).setValues(ridValues);
      Logger.log(`  [${filterSheet}] Wrote ${ridValues.length} Review ID(s) from source (insertAtTop)`);
    } else if (!cfg.pasteReviewId) {
      Logger.log(`  [${filterSheet}] Skipped Review ID paste — pasteReviewId: false (insertAtTop)`);
    }

    if (updIdx >= 0) {
      dest13.getRange(2, updIdx + 1, rows.length, 1).setValues(rows.map(() => [todayKorean]));
    }

    if (drFormula && aiIdx >= 0) {
      const defectCats = _loadDefectCategories_(destSS);
      const newData    = dest13.getRange(2, 1, rows.length, dest13.getLastColumn()).getValues();
      const aiValues   = newData.map(row => {
        const body = bonmunIdx >= 0 ? String(row[bonmunIdx] || '').trim() : '';
        return [_classifyReview_(body, defectCats)];
      });
      dest13.getRange(2, aiIdx + 1, rows.length, 1).setValues(aiValues);
      Logger.log(`  [${filterSheet}] Classified 인입사유(AI) for ${rows.length} new rows (insertAtTop)`);
    }

  } else {
    const colAVals = dest13.getRange(1, 1, dest13.getLastRow() || 1, 1).getValues();
    let destLast = 0;
    for (let i = colAVals.length - 1; i >= 0; i--) {
      if (String(colAVals[i][0]).trim() !== "") { destLast = i + 1; break; }
    }

    if (destLast + filtered.length > dest13.getMaxRows()) {
      dest13.insertRowsAfter(dest13.getMaxRows(), filtered.length + 100);
    }

    if (destLast >= 2) {
      const fmtSrc = dest13.getRange(destLast, 1, 1, dest13.getLastColumn());
      const fmtDst = dest13.getRange(destLast + 1, 1, rows.length, dest13.getLastColumn());
      fmtSrc.copyTo(fmtDst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      fmtSrc.copyTo(fmtDst, SpreadsheetApp.CopyPasteType.PASTE_CONDITIONAL_FORMATTING, false);
      fmtSrc.copyTo(fmtDst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    }

    dest13.getRange(destLast + 1, 1, rows.length, numCols).setValues(rows);

    if (cfg.pasteReviewId && srcRidColIdx >= 0 && destRidIdx >= 0) {
      const ridValues = filtered.map(r => [String(r[srcRidColIdx] || "").trim()]);
      dest13.getRange(destLast + 1, destRidIdx + 1, rows.length, 1).setValues(ridValues);
      Logger.log(`  [${filterSheet}] Wrote ${ridValues.length} Review ID(s) from source (bottom-append)`);
    } else if (!cfg.pasteReviewId) {
      Logger.log(`  [${filterSheet}] Skipped Review ID paste — pasteReviewId: false (bottom-append)`);
    }

    if (updIdx >= 0) {
      dest13.getRange(destLast + 1, updIdx + 1, rows.length, 1).setValues(rows.map(() => [todayKorean]));
    }

    if (drFormula && aiIdx >= 0) {
      const defectCats = _loadDefectCategories_(destSS);
      const newData    = dest13.getRange(destLast + 1, 1, rows.length, dest13.getLastColumn()).getValues();
      const aiValues   = newData.map(row => {
        const body = bonmunIdx >= 0 ? String(row[bonmunIdx] || '').trim() : '';
        return [_classifyReview_(body, defectCats)];
      });
      dest13.getRange(destLast + 1, aiIdx + 1, rows.length, 1).setValues(aiValues);
      Logger.log(`  [${filterSheet}] Classified 인입사유(AI) for ${rows.length} new rows (bottom-append)`);
    }
  }

  Logger.log(`  [${filterSheet}] Copied ${rows.length} row(s) to 1-3점 (${insertAtTop ? "top" : "bottom"})`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _colLetter(n) {
  let s = "";
  while (n > 0) { s = String.fromCharCode(64 + (n-1)%26 + 1) + s; n = Math.floor((n-1)/26); }
  return s;
}

function _letterToIdx(letter) {
  let n = 0;
  letter = letter.toUpperCase();
  for (let i = 0; i < letter.length; i++) n = n * 26 + (letter.charCodeAt(i) - 64);
  return n - 1;
}

// Exact case-insensitive column lookup
function _colIdx(hdrs, name) {
  const lower = name.toLowerCase();
  return hdrs.findIndex(h => String(h).trim().toLowerCase() === lower);
}

// Partial case-insensitive column lookup — for headers whose computed value
// embeds the target name (e.g. "인입사유(AI)  Acc. 95.0%")
function _colIdxContains(hdrs, substring) {
  const lower = substring.toLowerCase();
  return hdrs.findIndex(h => String(h).trim().toLowerCase().includes(lower));
}

function _koreanDate(val) {
  if (val instanceof Date) {
    const kst = new Date(val.getTime() + 9 * 3600 * 1000);
    return `${kst.getUTCFullYear()}. ${kst.getUTCMonth()+1}. ${kst.getUTCDate()}`;
  }
  return String(val||"").trim();
}

// ── Gemini helpers (replaces live =ai() / =dr() formula writes) ───────────────

function _callGeminiMaster_(prompt, maxOutputTokens) {
  const EMPTY = { text: '', inputTokens: 0, outputTokens: 0 };
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) { Logger.log('[Master] Missing GEMINI_API_KEY'); return EMPTY; }
  const models = ['gemini-3.1-flash-lite', 'gemini-3.5-flash'];
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: maxOutputTokens || 50 }
      };
      const res = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json',
        payload: JSON.stringify(payload), muteHttpExceptions: true
      });
      if (res.getResponseCode() !== 200) continue;
      const json  = JSON.parse(res.getContentText());
      const text  = (json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
      if (!text) continue;
      const usage = json.usageMetadata || {};
      return { text, inputTokens: usage.promptTokenCount || 0, outputTokens: usage.candidatesTokenCount || 0 };
    } catch (e) {
      Logger.log('[_callGeminiMaster_] ' + e.message);
    }
  }
  return EMPTY;
}

function _summarizeReview_(bodyText) {
  if (!bodyText || !bodyText.trim()) return '';
  const r = _callGeminiMaster_(
    `Briefly summarize this customer Amazon product review of a Spigen product. Max 10 words, English only.\n\nReview:\n${bodyText.trim()}`,
    30
  );
  Logger.log(`[kw-summary] in=${r.inputTokens} out=${r.outputTokens} → "${r.text.slice(0, 40)}"`);
  return r.text;
}

function _loadDefectCategories_(ss) {
  const sh = ss.getSheetByName('Defect');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .filter(r => r[1])
    .map(r => `${String(r[1]).trim()}: ${String(r[2] || '').trim()}`);
}

/**
 * One-time fix: scans all 4 DR-enabled destination sheets and replaces
 * any live =dr() formula cells with their current static display value.
 * Run manually once from the GAS editor — safe to re-run (idempotent).
 */
function fixLegacyDRFormulas() {
  const TARGETS = [
    { id: '1fpv9TEDPGR8D6QRRc0ll-WzF7sOkfxe9UNBCmdBSE9g', name: 'Glx26',    sheets: ['1-3점', '1-5점'] },
    { id: '16xRJHH7Ynii4erNOn_905ST4CZs6OLpOYTof4uqsGsQ',  name: 'iPh17e',   sheets: ['1-3점', '1-5점'] },
    { id: '1BpeGq5gIr4tNsPZmnHr19NNY6pQ6sb2_H-v3V9-It4E',  name: 'Pixel10a', sheets: ['1-3점', '1-5점'] },
    { id: '1dlY6q8trbVMVJAjw_OUoxp1cguA2oTB8WlPhHR01xIw',  name: '유지훈P',  sheets: ['1-3점'] },
  ];
  let grandTotal = 0;

  for (const target of TARGETS) {
    const ss = SpreadsheetApp.openById(target.id);
    for (const shName of target.sheets) {
      try {
        const sh = ss.getSheetByName(shName);
        if (!sh || sh.getLastRow() < 2) {
          Logger.log(`[${target.name}/${shName}] skip — no data`);
          continue;
        }
        const lastRow = sh.getLastRow();
        const lastCol = sh.getLastColumn();
        const range    = sh.getRange(2, 1, lastRow - 1, lastCol);
        const formulas = range.getFormulas();
        const display  = range.getDisplayValues();

        // Find every column that contains at least one =dr() formula
        const drCols = new Set();
        for (let r = 0; r < formulas.length; r++) {
          for (let c = 0; c < formulas[r].length; c++) {
            if (formulas[r][c].toLowerCase().startsWith('=dr(')) drCols.add(c);
          }
        }
        if (drCols.size === 0) {
          Logger.log(`[${target.name}/${shName}] no =dr() formulas — clean`);
          continue;
        }

        let count = 0;
        for (const c of drCols) {
          const colVals = formulas.map((row, r) => {
            if (row[c].toLowerCase().startsWith('=dr(')) {
              count++;
              const v = display[r][c];
              return [v && !v.startsWith('#') ? v : ''];
            }
            return [display[r][c]];
          });
          sh.getRange(2, c + 1, lastRow - 1, 1).setValues(colVals);
        }
        SpreadsheetApp.flush();
        Logger.log(`[${target.name}/${shName}] replaced ${count} =dr() formula(s) → static`);
        grandTotal += count;
      } catch (e) {
        Logger.log(`[${target.name}/${shName}] ERROR: ${e.message}`);
      }
    }
  }
  Logger.log(`fixLegacyDRFormulas complete — total replaced: ${grandTotal}`);
}

function _classifyReview_(bodyText, enrichedCategories) {
  if (!bodyText || !bodyText.trim() || !enrichedCategories.length) return '';
  const prompt = `You are classifying customer feedback into predefined categories.
Each category has:
- label
- description
Choose the MOST appropriate label.

Categories:
${enrichedCategories.join('\n')}

Rules:
- Return ONLY ONE label
- Return ONLY the label text
- No explanation, no punctuation, no quotes, no markdown

Input:
${bodyText.trim()}`;
  const r = _callGeminiMaster_(prompt, 20);
  Logger.log(`[dr-classify] in=${r.inputTokens} out=${r.outputTokens} → "${r.text.slice(0, 40)}"`);
  return r.text;
}
