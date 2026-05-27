/*** Apify Token ***/
function _getToken() {
  const token = PropertiesService.getScriptProperties().getProperty('APIFY_TOKEN');
  if (!token) {
    throw new Error(
      'Missing Script Property APIFY_TOKEN. ' +
      'Set it in Project Settings → Script properties with name "APIFY_TOKEN" and your token as value.'
    );
  }
  return token;
}

/** Google Chat notifier (uses CHAT_WEBHOOK_URL from config.gs) */
function _postToGoogleChat(text) {
  if (!CHAT_WEBHOOK_URL) {
    Logger.log('CHAT_WEBHOOK_URL not set; skipping Chat post.');
    return;
  }
  const payload = { text: String(text) };
  const resp = UrlFetchApp.fetch(CHAT_WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  Logger.log('Chat post status=%s, body=%s', resp.getResponseCode(), resp.getContentText());
}

/***** START (Task run using saved input) *****/
function startApifyRunAndSchedulePoll() {
  const ss = SpreadsheetApp.getActive();
  const token = _getToken();
  if (!CONFIG.actorTaskIdOrSlug) throw new Error('CONFIG.actorTaskIdOrSlug missing.');

  const url = `https://api.apify.com/v2/actor-tasks/${encodeURIComponent(CONFIG.actorTaskIdOrSlug)}/runs?token=${encodeURIComponent(token)}`;
  Logger.log('Starting Task run (async): ' + url.replace(/token=[^&]+/, 'token=***'));

  const resp = UrlFetchApp.fetch(url, { method: 'post', muteHttpExceptions: true });
  const code = resp.getResponseCode();
  const body = resp.getContentText();
  Logger.log(`Start run HTTP ${code}, body length=${body.length}`);

  if (code >= 400) throw new Error(`Failed to start run: HTTP ${code}: ${body.slice(0, 1000)}`);

  const data = JSON.parse(body).data;
  if (!data || !data.id) throw new Error('Start run response missing run id.');
  const runId = data.id;
  const datasetId = data.defaultDatasetId || null;

  _rememberRun(runId, datasetId);

  const msg = `Apify run started (Task). runId=${runId}${datasetId ? `, datasetId=${datasetId}` : ''}`;
  ss.toast(msg, 'Apify', 5);
  Logger.log(msg);
}

/***** POLLER (invoked by recurring time-based trigger) *****/
function pollApifyRunAndWrite() {
  const ss = SpreadsheetApp.getActive();
  const token = _getToken();

  const props = PropertiesService.getScriptProperties();
  const runId = props.getProperty('APIFY_LAST_RUN_ID');
  const datasetIdFromStart = props.getProperty('APIFY_LAST_DATASET_ID');
  const startedAtMs = Number(props.getProperty('APIFY_LAST_POLL_STARTED_AT_MS')) || Date.now();

  if (!runId) {
    Logger.log('No pending runId found. Nothing to do.');
    return;
  }

  const elapsedMin = (Date.now() - startedAtMs) / 60000;
  if (elapsedMin > CONFIG.pollMaxMinutes) {
    _cleanupPollState();
    _deleteRecurringPollers_();
    const msg = `Polling stopped after ${CONFIG.pollMaxMinutes} minutes (timeout). runId=${runId}`;
    ss.toast(msg, 'Apify', 8);
    Logger.log(msg);
    return;
  }

  const runUrl = `https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`;
  Logger.log('Polling run: ' + runUrl.replace(/token=[^&]+/, 'token=***'));

  const runResp = UrlFetchApp.fetch(runUrl, { method: 'get', muteHttpExceptions: true });
  if (runResp.getResponseCode() >= 400) {
    Logger.log(`Run status HTTP ${runResp.getResponseCode()}: ${runResp.getContentText().slice(0, 500)}`);
    return;
  }

  const runData = JSON.parse(runResp.getContentText()).data;
  const status = runData && runData.status;
  const datasetId = runData && (runData.defaultDatasetId || datasetIdFromStart);

  Logger.log(`Run status = ${status}, datasetId=${datasetId || '(unknown yet)'}`);

  if (status === 'SUCCEEDED') {
    if (!datasetId) {
      Logger.log('Dataset not yet available, will retry.');
      return;
    }

    // Review scraper: fetch all fields (no field filter)
    const items = _fetchAllDatasetItems(datasetId, token);
    const { sheet, name: finalSheetName } = _createNewDatedSheet(CONFIG.timezone);
    _overwriteSheet(items, getSpreadsheetId_(), finalSheetName);

    const msg = `Apify: wrote ${items.length} row(s) to "${finalSheetName}" (runId=${runId})`;
    ss.toast(msg, 'Done', 5);
    Logger.log(msg);

    try {
      const tz = CONFIG.timezone || Session.getScriptTimeZone() || 'Asia/Seoul';
      const when = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss Z');
      const sheetUrl = `https://docs.google.com/spreadsheets/d/${getSpreadsheetId_()}/edit#gid=${sheet.getSheetId()}`;
      const excelUrl = _buildExcelExportUrl_(getSpreadsheetId_(), sheet);

      const chatText =
        'Apify Amazon Scraping Completed.\n' +
        `Time: ${when}\n` +
        `Sheet: ${finalSheetName}\n` +
        `Rows: ${items.length}\n` +
        `Run ID: ${runId}\n` +
        `Google Sheet: ${sheetUrl}\n` +
        `Excel Download: ${excelUrl}`;

      _postToGoogleChat(chatText);
    } catch (e) {
      Logger.log('Failed to post to Google Chat: ' + (e && e.stack ? e.stack : e));
    }

    _cleanupPollState();
    _deleteRecurringPollers_();
    return;
  }

  if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
    _cleanupPollState();
    _deleteRecurringPollers_();
    const msg = `Apify run ended with status=${status}. No data written. runId=${runId}`;
    ss.toast(msg, 'Apify Error', 8);
    Logger.log(msg);
    return;
  }
}

/***** DATASET FETCH (paginated) *****/
// fields: optional comma-separated list of top-level Apify field names to return.
//         Pass null/undefined to fetch all fields (default behaviour for the review scraper).
//         Example: 'asin,countReview,productRating,url,globalReviews,title'
function _fetchAllDatasetItems(datasetId, token, fields) {
  const base = `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items`;
  const limit = 50000;
  let offset = 0;
  let all = [];

  while (true) {
    let url = `${base}?token=${encodeURIComponent(token)}&format=json&clean=true&limit=${limit}&offset=${offset}`;
    if (fields) url += `&fields=${encodeURIComponent(fields)}`;

    Logger.log('Fetching dataset page: ' + url.replace(/token=[^&]+/, 'token=***'));

    const resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
    const code = resp.getResponseCode();
    if (code >= 400) {
      const txt = resp.getContentText();
      Logger.log(`Dataset page HTTP ${code}: ${txt.slice(0, 800)}`);
      throw new Error(`Dataset fetch failed: HTTP ${code}`);
    }

    let page = [];
    const txt = resp.getContentText();
    try {
      page = JSON.parse(txt);
    } catch (e) {
      Logger.log('JSON parse error on dataset page: ' + (e && e.message ? e.message : e));
      break;
    }

    if (!Array.isArray(page) || page.length === 0) break;
    all = all.concat(page);
    if (page.length < limit) break;
    offset += page.length;
  }

  Logger.log(`Total dataset items fetched: ${all.length}`);
  return all;
}

/***** POLLING STATE *****/
function _rememberRun(runId, datasetId) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('APIFY_LAST_RUN_ID', runId);
  if (datasetId) props.setProperty('APIFY_LAST_DATASET_ID', datasetId);
  props.setProperty('APIFY_LAST_POLL_STARTED_AT_MS', String(Date.now()));
}

function _cleanupPollState() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('APIFY_LAST_RUN_ID');
  props.deleteProperty('APIFY_LAST_DATASET_ID');
  props.deleteProperty('APIFY_LAST_POLL_STARTED_AT_MS');
}

/***** SHEET HELPERS *****/
function _createNewDatedSheet(timezone) {
  const tz = timezone || Session.getScriptTimeZone() || 'Asia/Seoul';
  const today = Utilities.formatDate(new Date(), tz, 'yyMMdd');
  const base = `${CONFIG.sheetBaseName || 'Apify'}_${today}`;

  const ss = SpreadsheetApp.openById(getSpreadsheetId_());
  let name = base, n = 1;
  while (ss.getSheetByName(name)) { n++; name = `${base}_${n}`; }
  const sheet = ss.insertSheet(name);
  return { sheet, name };
}

/* Remove duplicates by selected headers */
function removeDuplicatesByHeaders_(sheet, headers, keyHeaders) {
  if (!sheet) throw new Error('Sheet is required.');
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  if (values.length < 2) return;

  const headerRow = values[0];
  const keyIndexes = keyHeaders.map(h => {
    const idx = headerRow.indexOf(h);
    if (idx === -1) throw new Error(`Header "${h}" not found in sheet.`);
    return idx;
  });

  const seen = new Set();
  const deduped = [headerRow];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const key = keyIndexes.map(idx => row[idx]).join('||');
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(row);
    }
  }

  sheet.clearContents();
  sheet.getRange(1, 1, deduped.length, deduped[0].length).setValues(deduped);
  sheet.setFrozenRows(1);
}

/** Flatten any JSON to key→scalar using dot and /index paths */
function _flattenRecord(value, prefix, out) {
  if (value === null || value === undefined) {
    if (prefix) out[prefix] = '';
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      if (prefix) out[prefix] = '[]';
      return;
    }
    for (let i = 0; i < value.length; i++) {
      const key = prefix ? `${prefix}/${i}` : String(i);
      _flattenRecord(value[i], key, out);
    }
    return;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      if (prefix) out[prefix] = '{}';
      return;
    }
    for (const k of keys) {
      const key = prefix ? `${prefix}.${k}` : k;
      _flattenRecord(value[k], key, out);
    }
    return;
  }
  if (prefix) out[prefix] = value;
}

function _flattenItems(items) {
  const flat = [];
  for (const it of items) {
    const m = {};
    _flattenRecord(it, '', m);
    flat.push(m);
  }
  return flat;
}

function _collectHeadersFromFlat(flattened) {
  const set = new Set();
  for (const m of flattened) for (const k of Object.keys(m)) set.add(k);
  let headers = Array.from(set);

  if (Array.isArray(PREFERRED_HEADERS) && PREFERRED_HEADERS.length) {
    const pref = PREFERRED_HEADERS.filter(h => set.has(h));
    const rest = headers.filter(h => pref.indexOf(h) === -1).sort();
    headers = pref.concat(rest);
  } else {
    headers.sort();
  }
  return headers;
}

function _stringifyScalar(v) {
  if (v === null || v === undefined) return '';
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

/** Write flattened data, in batches; never leave a totally blank sheet */
function _overwriteSheet(items, spreadsheetId, sheetName) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('Target sheet not found: ' + sheetName);

  const flattened = _flattenItems(items);
  const headers = flattened.length ? _collectHeadersFromFlat(flattened)
                                   : (Array.isArray(PREFERRED_HEADERS) ? PREFERRED_HEADERS.slice() : []);

  sh.clear({ contentsOnly: true });

  if (!headers.length) {
    sh.getRange(1, 1).setValue('no_data');
    sh.setFrozenRows(1);
    return;
  }

  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  const resizeCount = Math.min(headers.length, 2000);
  sh.autoResizeColumns(1, resizeCount);

  if (!flattened.length) return;

  const CHUNK_ROWS = 5000;
  let start = 0;
  let rowIndex = 2;

  while (start < flattened.length) {
    const end = Math.min(start + CHUNK_ROWS, flattened.length);
    const chunk = flattened.slice(start, end);
    const values = chunk.map(m => headers.map(h => _stringifyScalar(m[h])));
    sh.getRange(rowIndex, 1, values.length, headers.length).setValues(values);
    rowIndex += values.length;
    start = end;
  }

  try {
    const dedupeKeys = ['username', 'reviewTitle', 'reviewDescription'];
    const haveAll = dedupeKeys.every(k => headers.indexOf(k) !== -1);
    if (haveAll) {
      removeDuplicatesByHeaders_(sh, headers, dedupeKeys);
    } else {
      Logger.log('Skip de-dup: not all dedupe keys are present in headers.');
    }
  } catch (e) {
    Logger.log('De-dup skipped due to error: ' + (e && e.message ? e.message : e));
  }
}

/**
 * Exports a sheet to Excel (.xlsx) and returns a public share link.
 */
function _exportSheetToExcelAndGetLink(spreadsheetId, sheetName) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx&gid=${sheet.getSheetId()}`;
  const token = ScriptApp.getOAuthToken();
  const resp = UrlFetchApp.fetch(exportUrl, {
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() !== 200)
    throw new Error(`Export failed: ${resp.getResponseCode()} - ${resp.getContentText()}`);

  const blob = resp.getBlob().setName(`${sheetName}.xlsx`);
  const file = DriveApp.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

/***** Convenience: start now and ensure recurring poller *****/
function _ensureRecurringPoller_() {
  const every = Math.max(1, Number(CONFIG.pollIntervalMinutes || 1));
  const existing = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === 'pollApifyRunAndWrite');
  if (!existing) {
    ScriptApp.newTrigger('pollApifyRunAndWrite')
      .timeBased()
      .everyMinutes(every)
      .create();
    Logger.log('Created recurring poller: pollApifyRunAndWrite() every %s minute(s)', every);
  } else {
    Logger.log('Recurring poller already exists.');
  }
}

function _deleteRecurringPollers_() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'pollApifyRunAndWrite') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  if (removed) Logger.log('Deleted %s recurring poller(s) for pollApifyRunAndWrite()', removed);
}

function purgeOneOffDelayedPollers_() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'runApifyNowAndPollAfter2Hours') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  if (removed) Logger.log('Purged %s one-off delayed poller(s).', removed);
}

function logProjectTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    Logger.log('Trigger: handler=%s, type=%s', t.getHandlerFunction(), t.getTriggerSource());
  });
}

function _buildExcelExportUrl_(spreadsheetId, sheet) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sh = (typeof sheet === 'string') ? ss.getSheetByName(sheet) : sheet;
  if (!sh) throw new Error('Sheet not found for export URL.');
  const gid = sh.getSheetId();
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx&gid=${gid}`;
}

function _getOrCreatePublicFolder_(folderName) {
  var it = DriveApp.getFoldersByName(folderName);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return folder;
}

function _exportSheetToExcelAndMakePublic_(spreadsheetId, sheetName, folderName) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  const exportUrl =
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx&gid=${sheet.getSheetId()}`;

  const token = ScriptApp.getOAuthToken();
  const resp = UrlFetchApp.fetch(exportUrl, {
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error(`Export failed: ${resp.getResponseCode()} - ${resp.getContentText()}`);
  }

  const folder = _getOrCreatePublicFolder_(folderName || 'Apify Exports');
  const blob = resp.getBlob().setName(`${sheetName}.xlsx`);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}
