function onOpen() {
  const ui = SpreadsheetApp.getUi();

  // Existing CX Upload menu
  const cxMenu = ui.createMenu('CX Upload')
    .addItem('Open Uploader', 'openUploaderDialog')
    .addSeparator()
    .addSubMenu(
      ui.createMenu('Apify Product')
        .addItem('Run Product Now', 'uiRunProductNow')
        .addItem('Cancel Product Polling', 'cancelProductPolling')
    );

  // New AI Tools menu (SAFE – manual execution only)
  const aiMenu = ui.createMenu('AI Tools')
    .addItem('Summarize selected cells', 'uiRunSummarize')
    .addItem('Run Defect GPT (selected cells)', 'uiRunDefectGPT');

  // Add both menus
  cxMenu.addToUi();
  aiMenu.addToUi();
}


function _getToken() {
  const token = PropertiesService
    .getScriptProperties()
    .getProperty('APIFY_TOKEN');

  if (!token) {
    throw new Error(
      'APIFY_TOKEN is not set in Script Properties.'
    );
  }
  return token;
}

function openUploaderDialog() {
  const html = HtmlService.createHtmlOutputFromFile('uploader_sidebar')
    .setWidth(1000)
    .setHeight(760);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Sheet → Monday Uploader');
}

/** Optional manual runner (logs only). */
function syncSheetToMonday() {
  const res = syncSheetToMonday_core();
  Logger.log(JSON.stringify(res, null, 2));
}

/** Interactive wrapper (sidebar “Run upload” hits this under-the-hood via paged plan) */
function syncSheetToMondayInteractive() {
  SpreadsheetApp.getActive().toast('Starting upload…', 'CX Upload', 5);
  const res = syncSheetToMonday_core();
  SpreadsheetApp.getActive().toast('Upload finished', 'CX Upload', 5);
  return res;
}

/* ---------------- Sidebar RPCs ---------------- */

/** Sidebar → initial planning metadata */
function getPlanMeta(targetYmdDot) {
  const { headers, lastRow, firstDataRow } = readSheetMeta(UPLOAD_SHEET_ID, UPLOAD_SHEET_NAME);
  const totalDataRows = Math.max(0, lastRow - (firstDataRow - 1));
  return {
    targetDate: targetYmdDot || '',
    totalDataRows,
    dataRowStart: firstDataRow,
    lastRow,
    pageSize: 250
  };
}

/** Sidebar → page through and assemble items to queue */
function getPlanPage(targetYmdDot, startRow, pageSize) {
  const apiKey = _requireMondayApiKey_();
  const { columns, groups, firstGroupId } = fetchBoardColumnsAndFirstGroup(apiKey, BOARD_ID);
  const groupsMap = new Map(groups.map(g => [g.title, g.id]));
  const writableCols = columns.filter(c => !['mirror', 'subtasks', 'integration', 'board_relation'].includes(c.type));
  const titleToId = buildTitleToIdMap(writableCols, COLUMN_OVERRIDES_BY_TITLE);
  const statusMaps = buildStatusMaps(columns);
  const autoTranslateColId = titleToId.get(AUTO_TRANSLATE_BOARD_TITLE) || null;

  const { headers, rows, nextStartRow, scanned, matched } =
    readSheetRowsByPage(UPLOAD_SHEET_ID, UPLOAD_SHEET_NAME, targetYmdDot, DATE_COL_INDEX_1BASED, startRow, pageSize);

  const headerIndex = indexHeaders(headers);
  if (!(ITEM_NAME_HEADER in headerIndex)) {
    throw new Error(`Item name header "${ITEM_NAME_HEADER}" not found in sheet headers.`);
  }

  const modelHeader = MODEL_HEADER_CANDIDATES.find(h => h in headerIndex) || null;
  const items = [];
  const trace = [];

  // Existing links (dedupe) – we do it once in prepare-run; keep client fast.
  const existingLinks = fetchExistingReviewLinks(apiKey, BOARD_ID, LINK_COLUMN_ID);

  for (const pageRow of rows) {
    const r = pageRow.values;
    const sheetRow = pageRow.sheetRow;

    const itemName = (r[headerIndex[ITEM_NAME_HEADER]] || '').toString().trim();
    const reviewLinkCell = headerIndex['Review Link'] != null ? (r[headerIndex['Review Link']] || '').toString().trim() : '';

    if (!itemName || !reviewLinkCell) continue;
    if (existingLinks.has(normalizeLink(reviewLinkCell))) continue;

    const warnings = [];
    const colVals = formatRowToMondayCols(headers, r, writableCols, titleToId, statusMaps, warnings);

    // Ensure Review Link set
    if (!colVals[LINK_COLUMN_ID]) colVals[LINK_COLUMN_ID] = linkToMondayValue(reviewLinkCell);

    // Default “클레임/리뷰” label
    if (CLAIM_REVIEW_COLUMN_ID) {
      const claimMap = statusMaps[CLAIM_REVIEW_COLUMN_ID] || { byLabel: {} };
      const norm = normalizeStatusLabel(DEFAULT_CLAIM_REVIEW_LABEL);
      if (claimMap.byLabel && claimMap.byLabel[norm]) {
        colVals[CLAIM_REVIEW_COLUMN_ID] = { label: claimMap.byLabel[norm] };
      }
    }

    // Auto-translate
    if (autoTranslateColId && BODY_HEADER_TITLE in headerIndex) {
      const bodyText = (r[headerIndex[BODY_HEADER_TITLE]] || '').toString().trim();
      if (bodyText) {
        try {
          const translated = translateTextAuto(bodyText, AUTO_TRANSLATE_TARGET);
          if (translated) colVals[autoTranslateColId] = translated;
        } catch (e) {
          // keep quiet in plan
        }
      }
    }

    // Group selection
    const modelText = modelHeader ? (r[headerIndex[modelHeader]] || '').toString().trim() : '';
    const targetGroupTitle = chooseGroupFromModel(modelText);
    const group_id = (targetGroupTitle && groupsMap.get(targetGroupTitle)) || firstGroupId;

    // Queue item (pre-baked for upload)
    items.push({
      sheetRow,
      item_name: itemName,
      group_id,
      column_values: colVals
    });
  }

  return {
    scanned,
    matched,
    items,
    trace,
    nextStartRow
  };
}

/** Sidebar → upload one pre-baked planned item */
function uploadOnePlannedItem(planned) {

  const apiKey = _requireMondayApiKey_();

  if (DRY_RUN) return { ok: true, dryRun: true };

  const mutation = `
    mutation CreateItem(
      $boardId: ID!,
      $groupId: String!,
      $itemName: String!,
      $columnValues: JSON!
    ) {
      create_item(
        board_id: $boardId,
        group_id: $groupId,
        item_name: $itemName,
        column_values: $columnValues
      ) {
        id
      }
    }
  `;

  const payload = {
    query: mutation,
    variables: {
      boardId: BOARD_ID,
      groupId: planned.group_id,
      itemName: planned.item_name,
      columnValues: JSON.stringify(planned.column_values)
    }
  };

  const resp = UrlFetchApp.fetch(
    'https://api.monday.com/v2',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    }
  );

  const json = JSON.parse(resp.getContentText());

  if (json.errors) {
    throw new Error(JSON.stringify(json.errors));
  }

  return { ok: true };
}
function uiRunProductNow() {
  SpreadsheetApp.getActive().toast(
    'Starting Product task…',
    'Apify Product',
    5
  );
  runProductNowAndPollRecurring();
}


