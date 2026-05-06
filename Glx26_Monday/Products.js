/**********************************************************
 * PRODUCT CONFIG (NO CONFIG REFERENCES HERE)
 **********************************************************/
const PRODUCT = {
  taskIdOrSlug: 'g2egqkSfZrtZ8f4ts',
  sheetBaseName: 'Product'
};

/**********************************************************
 * CONSTANT: OUTPUT FIELDS (ORDER FIXED)
 **********************************************************/
const PRODUCT_FIELDS = [
  'asin',
  'countReview',
  'productRating',
  'statusCode',
  'title',
  'url'
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
function startProductRun_(memoryMb) {
  const ss = SpreadsheetApp.getActive();
  const token = _getToken();
  const memory = memoryMb || 4096;

  const url =
    `https://api.apify.com/v2/actor-tasks/${encodeURIComponent(
      PRODUCT.taskIdOrSlug
    )}/runs?token=${encodeURIComponent(token)}`;

  Logger.log(
    `Starting Product run (async, memory=${memory} MB): ` +
      url.replace(/token=[^&]+/, 'token=***')
  );

  const fetchOpts = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ memory }),
    muteHttpExceptions: true
  };

  let resp;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      resp = UrlFetchApp.fetch(url, fetchOpts);
      break;
    } catch (e) {
      if (attempt < 2 && String(e.message || e).indexOf('Bandwidth quota exceeded') >= 0) {
        Logger.log(`startProductRun_: bandwidth error, retrying in 15 s (attempt ${attempt + 1})`);
        Utilities.sleep(15000);
        continue;
      }
      throw e;
    }
  }

  const code = resp.getResponseCode();
  const body = resp.getContentText();

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
    if (!datasetId) {
      _cleanupProductState_();
      _deleteTriggersByHandler_('pollProductRunAndWrite');
      return;
    }

    const items = _fetchAllDatasetItems_filtered_(datasetId, token);

    const { sheet, name: finalSheetName } = _getOrCreateProductSheet_();
    _overwriteSheet(items, getSpreadsheetId_(), finalSheetName);

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
        ` /edit#gid=${sheet.getSheetId()}`;

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
    props.deleteProperty('PRODUCT_OOM_RETRIED');
    _deleteTriggersByHandler_('pollProductRunAndWrite');
    return;
  }

  if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
    // exitCode 137 = OOM kill.
    // Resurrection re-runs the actor from scratch (no checkpointing) so the dataset fills
    // with duplicates and can loop endlessly. Instead: start one fresh run at 4096 MB.
    const exitCode = runData.exitCode;
    const alreadyRetried = props.getProperty('PRODUCT_OOM_RETRIED');
    if (status === 'FAILED' && exitCode === 137 && !alreadyRetried) {
      Logger.log(`Product OOM (exitCode 137) — starting fresh run at 4096 MB`);
      _cleanupProductState_();
      _deleteTriggersByHandler_('pollProductRunAndWrite');
      try {
        props.setProperty('PRODUCT_OOM_RETRIED', '1');
        startProductRun_(4096);
        _scheduleRecurringProductPoll_();
        ss.toast('Product OOM — retrying with 4096 MB (fresh run)', 'Product', 8);
      } catch (e) {
        props.deleteProperty('PRODUCT_OOM_RETRIED');
        ss.toast('Product OOM retry failed: ' + e.message, 'Product Error', 8);
      }
      return;
    }
    props.deleteProperty('PRODUCT_OOM_RETRIED');
    _cleanupProductState_();
    _deleteTriggersByHandler_('pollProductRunAndWrite');
    ss.toast(`Product run ${status}${exitCode === 137 ? ' (OOM, already retried)' : ''}`, 'Product Error', 8);
  }
}


/**********************************************************
 * 🔥 FILTERED DATASET FETCH (CORE CHANGE)
 **********************************************************/
function _fetchAllDatasetItems_filtered_(datasetId, token) {
  const baseUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}`;

  let offset = 0;
  const limit = 1000;
  let allItems = [];

  while (true) {
    const url = `${baseUrl}&offset=${offset}&limit=${limit}`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

    if (resp.getResponseCode() >= 400) {
      throw new Error('Dataset fetch failed: ' + resp.getContentText());
    }

    const items = JSON.parse(resp.getContentText());
    if (!items || items.length === 0) break;

    const filtered = items.map(i => ({
      asin: i.asin || '',
      countReview: i.countReview || i.reviewCount || '',
      productRating: _normalizeRating_(i.productRating),
      statusCode: i.statusCode || '',
      title: i.title || '',
      url: i.url || i.productUrl || ''
    }));

    allItems = allItems.concat(filtered);
    offset += items.length;

    if (items.length < limit) break;
  }

  // Deduplicate by ASIN — a fresh retry run appends to the same dataset so
  // the same products appear twice. Keep the last occurrence (most recent scrape).
  const seen = new Map();
  for (const item of allItems) {
    const key = item.asin || item.url;
    if (key) seen.set(key, item);
  }
  return [...seen.values()];
}


/**********************************************************
 * Rating normalization
 **********************************************************/
function _normalizeRating_(val) {
  if (!val) return '';

  return String(val)
    .replace(',', '.')
    .replace(' v', '.0')
    .trim();
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