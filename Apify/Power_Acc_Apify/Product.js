/**********************************************************
 * PRODUCT CONFIG
 **********************************************************/
const PRODUCT = {
  taskIdOrSlug: 'fh2EbyE6tR2J9Lp26',
  sheetBaseName: 'Product'
};

// Fields to request from Apify dataset API.
// Only these top-level keys are returned — cuts payload significantly vs. fetching all ~300 columns.
//
// Field notes:
//   asin          → the ASIN scraped (may be variant or parent depending on input)
//   countReview   → total review count shown on the product page
//   productRating → aggregate star rating (e.g. 4.5)
//   url           → full Amazon product URL — country is parsed from this (amazon.de → DE, etc.)
//   title         → product title for human identification
//   globalReviews → array of review objects; each has .locale.country for per-review country info
//                   (only needed if you want per-review country breakdown; drop if not needed)
const PRODUCT_FIELDS = [
  'asin',
  'countReview',
  'productRating',
  'url',
  'title',
  'globalReviews',
].join(',');

// Output columns written to the Product sheet (in this order)
const PRODUCT_SHEET_HEADERS = [
  'country',        // parsed from url (amazon.de → DE, amazon.com → US, etc.)
  'asin',
  'title',
  'countReview',
  'productRating',
  'url',
];


/**********************************************************
 * Public: start Product run and ensure recurring polling
 **********************************************************/
function runProductNowAndPollRecurring() {
  const props = PropertiesService.getScriptProperties();
  const pendingRunId = props.getProperty('PRODUCT_LAST_RUN_ID');

  if (pendingRunId) {
    Logger.log(
      'A Product run is already pending (runId=%s). Ensuring recurring poll is scheduled.',
      pendingRunId
    );
  } else {
    startProductRun_();
  }

  _scheduleRecurringProductPoll_();
}


/**********************************************************
 * INTERNAL: start Product run using Task saved input
 **********************************************************/
function startProductRun_() {
  const ss = SpreadsheetApp.getActive();
  const token = _getToken();

  const useTask =
    PRODUCT.taskIdOrSlug && String(PRODUCT.taskIdOrSlug).trim().length > 0;

  const url = useTask
    ? `https://api.apify.com/v2/actor-tasks/${encodeURIComponent(
        PRODUCT.taskIdOrSlug
      )}/runs?token=${encodeURIComponent(token)}`
    : `https://api.apify.com/v2/acts/${encodeURIComponent(
        PRODUCT.actorIdOrSlug
      )}/runs?token=${encodeURIComponent(token)}`;

  Logger.log(
    'Starting Product run (async): ' +
      url.replace(/token=[^&]+/, 'token=***')
  );

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  const body = resp.getContentText();

  Logger.log(`Product start run HTTP ${code}, body length=${body.length}`);

  if (code >= 400) {
    throw new Error(
      `Failed to start Product run: HTTP ${code}\n` +
        body.slice(0, 1000)
    );
  }

  const data = JSON.parse(body).data;
  if (!data || !data.id) {
    throw new Error('Start run response missing run id for Product.');
  }

  _rememberProductRun_(data.id, data.defaultDatasetId || null);

  ss.toast(`Product run started. runId=${data.id}`, 'Product', 5);
}


/**********************************************************
 * Recurring poller
 **********************************************************/
function pollProductRunAndWrite() {
  const ss = SpreadsheetApp.getActive();
  const token = _getToken();
  const props = PropertiesService.getScriptProperties();

  const runId = props.getProperty('PRODUCT_LAST_RUN_ID');
  const datasetIdFromStart = props.getProperty('PRODUCT_LAST_DATASET_ID');
  const startedAtMs =
    Number(props.getProperty('PRODUCT_LAST_POLL_STARTED_AT_MS')) || Date.now();

  if (!runId) {
    _deleteTriggersByHandler_('pollProductRunAndWrite');
    return;
  }

  const elapsedMin = (Date.now() - startedAtMs) / 60000;
  const maxMinutes = Number(CONFIG.pollMaxMinutes || 180);

  if (elapsedMin > maxMinutes) {
    _cleanupProductState_();
    _deleteTriggersByHandler_('pollProductRunAndWrite');
    ss.toast('Product polling timed out.', 'Product Timeout', 8);
    return;
  }

  const runUrl =
    `https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}` +
    `?token=${encodeURIComponent(token)}`;

  const runResp = UrlFetchApp.fetch(runUrl, {
    method: 'get',
    muteHttpExceptions: true
  });

  if (runResp.getResponseCode() >= 400) return;

  const runData = JSON.parse(runResp.getContentText()).data;
  const status = runData.status;
  const datasetId = runData.defaultDatasetId || datasetIdFromStart;

  Logger.log(`Product run status=${status}, datasetId=${datasetId}`);

  if (status === 'SUCCEEDED') {
    if (!datasetId) return;

    // Fetch only the fields defined in PRODUCT_FIELDS — skips all ~300 unused columns
    const items = _fetchAllDatasetItems(datasetId, token, PRODUCT_FIELDS);
    Logger.log(`Product: fetched ${items.length} item(s) with fields: ${PRODUCT_FIELDS}`);

    const { sheet, name: finalSheetName } = _getOrCreateProductSheet_();

    // Use product-specific writer (clean one-row-per-ASIN output, not generic flatten)
    _writeProductSheet_(items, getSpreadsheetId_(), finalSheetName);

    ss.toast(
      `Product: wrote ${items.length} row(s) to "${finalSheetName}"`,
      'Product Done',
      5
    );

    try {
      const tz = CONFIG.timezone || Session.getScriptTimeZone() || 'Asia/Seoul';
      const when = Utilities.formatDate(
        new Date(),
        tz,
        'yyyy-MM-dd HH:mm:ss Z'
      );
      const sheetUrl =
        `https://docs.google.com/spreadsheets/d/${getSpreadsheetId_()}` +
        `/edit#gid=${sheet.getSheetId()}`;

      _postToGoogleChat(
        'Apify Product Scraping Completed.\n' +
          `Time: ${when}\n` +
          `Sheet: ${finalSheetName}\n` +
          `Rows: ${items.length}\n` +
          `Run ID: ${runId}\n` +
          `Link: ${sheetUrl}`
      );
    } catch (e) {
      Logger.log('Chat notify failed: ' + e);
    }

    _cleanupProductState_();
    _deleteTriggersByHandler_('pollProductRunAndWrite');
    return;
  }

  if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
    _cleanupProductState_();
    _deleteTriggersByHandler_('pollProductRunAndWrite');
    ss.toast(`Product run failed: ${status}`, 'Product Error', 8);
  }
}


/**********************************************************
 * Product sheet writer
 * Produces a clean one-row-per-ASIN output using only the
 * fields defined in PRODUCT_FIELDS / PRODUCT_SHEET_HEADERS.
 * Does NOT use the generic _flattenItems() / _overwriteSheet().
 **********************************************************/
function _writeProductSheet_(items, spreadsheetId, sheetName) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('Product sheet not found: ' + sheetName);

  sh.clearContents();

  const headers = PRODUCT_SHEET_HEADERS;
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);

  if (!items || !items.length) {
    Logger.log('_writeProductSheet_: no items to write.');
    return;
  }

  const rows = items.map(item => {
    const country = _parseCountryFromUrl_(item.url || '');
    return [
      country,
      _str(item.asin),
      _str(item.title),
      item.countReview != null   ? item.countReview   : '',
      item.productRating != null ? item.productRating : '',
      _str(item.url),
    ];
  });

  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sh.autoResizeColumns(1, headers.length);

  Logger.log(`_writeProductSheet_: wrote ${rows.length} row(s) to "${sheetName}"`);
}

/**
 * Parse a 2-letter country code from an Amazon product URL.
 * amazon.com → US, amazon.co.uk → UK, amazon.de → DE, etc.
 */
function _parseCountryFromUrl_(url) {
  if (!url) return '';
  const m = String(url).match(/amazon\.([a-z.]+)[\/]/i);
  if (!m) return '';
  const domain = m[1].toLowerCase();
  const map = {
    'com':    'US',
    'co.uk':  'UK',
    'de':     'DE',
    'fr':     'FR',
    'es':     'ES',
    'it':     'IT',
    'co.jp':  'JP',
    'in':     'IN',
    'com.au': 'AU',
    'ca':     'CA',
    'com.mx': 'MX',
    'com.br': 'BR',
    'nl':     'NL',
    'se':     'SE',
    'pl':     'PL',
    'com.tr': 'TR',
    'ae':     'AE',
    'sa':     'SA',
    'sg':     'SG',
  };
  return map[domain] || domain.toUpperCase();
}

function _str(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}


/**********************************************************
 * Poll trigger management
 **********************************************************/
function _scheduleRecurringProductPoll_() {
  _deleteTriggersByHandler_('pollProductRunAndWrite');

  const every = Math.max(1, Number(CONFIG.pollIntervalMinutes || 1));
  ScriptApp.newTrigger('pollProductRunAndWrite')
    .timeBased()
    .everyMinutes(every)
    .create();
}

function cancelProductPolling() {
  _deleteTriggersByHandler_('pollProductRunAndWrite');
}


/**********************************************************
 * State helpers
 **********************************************************/
function _rememberProductRun_(runId, datasetId) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('PRODUCT_LAST_RUN_ID', runId);
  if (datasetId) props.setProperty('PRODUCT_LAST_DATASET_ID', datasetId);
  props.setProperty(
    'PRODUCT_LAST_POLL_STARTED_AT_MS',
    String(Date.now())
  );
}

function _cleanupProductState_() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('PRODUCT_LAST_RUN_ID');
  props.deleteProperty('PRODUCT_LAST_DATASET_ID');
  props.deleteProperty('PRODUCT_LAST_POLL_STARTED_AT_MS');
}


/**********************************************************
 * Trigger cleanup
 **********************************************************/
function _deleteTriggersByHandler_(handlerName) {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(t);
    }
  }
}


/**********************************************************
 * Product sheet helper
 **********************************************************/
function _getOrCreateProductSheet_() {
  const ss = SpreadsheetApp.openById(getSpreadsheetId_());
  const name = PRODUCT.sheetBaseName;

  let sheet = ss.getSheetByName(name);
  if (sheet) {
    sheet.clearContents();
  } else {
    sheet = ss.insertSheet(name);
  }

  return { sheet, name };
}
