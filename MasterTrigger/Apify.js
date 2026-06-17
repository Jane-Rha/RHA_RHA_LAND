/*************************************************
 * TASK CONFIG
 *************************************************/

const APIFY_TASKS = {
  SDA: {
    taskId: 'gIrI2jQcTdSG87VOu',
    sheetPrefix: 'SDA'
  },
  PowerAcc: {
    taskId: 'TgpoNoMcN4a5bYsyX',
    sheetPrefix: 'Power_Acc'
  },
  AutoAcc: {
    taskId: '1jctsYj5oMnIkssv2',
    sheetPrefix: 'Auto_Acc'
  },
  전략폰: {
    taskId: 'Vv859ksggWODaIzoN',
    sheetPrefix: '전략폰'
  },
  유지훈P: {
    taskId: 'cskwDlRo3TY9TLsiQ',
    sheetPrefix: '유지훈P'
  },
  // Pixel10a: {
  //   taskId: 'I8884GTT3Tgthg9o4',
  //   sheetPrefix: 'Pixel10a'
  // },
  // Glx26: {
  //   taskId: 'pC2bYPkR0ios64mfd',
  //   sheetPrefix: 'Glx26'
  // },
  // iPh17e: {
  //   taskId: '28mpJFHAWAdv80g1V',
  //   sheetPrefix: 'iPh17e'
  // }
};

/*************************************************
 * GLOBAL CONFIG
 *************************************************/

const APIFY_BASE = 'https://api.apify.com/v2';
const POLL_INTERVAL_MINUTES = 1;
const RUN_STATE_KEY = 'APIFY_MULTI_RUN_STATE';

/*************************************************
 * UI
 *************************************************/

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Apify')
    .addItem('Run ALL Scrapers', 'runAllScrapers')
    .addToUi();
}

/*************************************************
 * ENTRY – RUN ALL TASKS
 *************************************************/

function runAllScrapers() {
  const token = getApifyToken_();
  const startedAt = new Date();

  const runState = {
    startedAt: startedAt.toISOString(),
    runs: {}
  };

  for (const key in APIFY_TASKS) {
    const { taskId, sheetPrefix } = APIFY_TASKS[key];

    const url = `${APIFY_BASE}/actor-tasks/${taskId}/runs?token=${token}`;
    const res = UrlFetchApp.fetch(url, { method: 'post' });
    const json = JSON.parse(res.getContentText());

    if (!json.data || !json.data.id) {
      throw new Error(`Failed to start task: ${key}`);
    }

    runState.runs[key] = {
      runId: json.data.id,
      sheetPrefix,
      status: 'RUNNING'
    };
  }

  PropertiesService.getScriptProperties().setProperty(
    RUN_STATE_KEY,
    JSON.stringify(runState)
  );

  ensurePollingTrigger_();
}

/*************************************************
 * POLLING (EVERY MINUTE)
 *************************************************/
function pollApifyRuns() {
  const token = getApifyToken_();
  const raw = PropertiesService.getScriptProperties().getProperty(RUN_STATE_KEY);
  if (!raw) return;

  const state = JSON.parse(raw);
  const startedAt = new Date(state.startedAt);
  let allFinished = true;

  for (const key in state.runs) {
    const run = state.runs[key];
    if (run.status !== 'RUNNING') continue;

    allFinished = false;

    const url = `${APIFY_BASE}/actor-runs/${run.runId}?token=${token}`;
    const res = UrlFetchApp.fetch(url);
    const json = JSON.parse(res.getContentText());
    const status = json.data?.status;

    if (status === 'SUCCEEDED') {
      if (!isRunAlreadyMaterialized_(run.runId)) {
        createResultSheet_(
          run.sheetPrefix,
          json.data.defaultDatasetId,
          startedAt
        );
        markRunAsMaterialized_(run.runId);
      }
      run.status = 'DONE';
    }


    if (['FAILED', 'ABORTED', 'TIMED_OUT'].includes(status)) {
      run.status = 'FAILED';
    }
  }

  // 상태 저장
  PropertiesService.getScriptProperties().setProperty(
    RUN_STATE_KEY,
    JSON.stringify(state)
  );

  if (allFinished) {
    PropertiesService.getScriptProperties().deleteProperty(RUN_STATE_KEY);
    removePollingTrigger_();
    try {
      dailyJob();
    } catch (e) {
      Logger.log("Main dailyJob Error after Apify finish: " + e.message);
    }
  }
}


/*************************************************
 * CREATE RESULT SHEET
 *************************************************/

  function createResultSheet_(sheetPrefix, datasetId, startedAt) {
    const token = getApifyToken_();                                                               
    const url = `${APIFY_BASE}/datasets/${datasetId}/items?clean=true&token=${token}`;            
  
    const res = UrlFetchApp.fetch(url);                                                           
    const items = JSON.parse(res.getContentText());         
    if (!items || !items.length) return;                                                          
  
    // Filter out Axesso penalty rows (returned when a filter combination yields 0 reviews).      
    // These have statusMessage "NO_REVIEWS_PENALTY_1/2/3" and contain no review data.
    const filtered = items.filter(r =>                                                            
      !String(r.statusMessage || '').startsWith('NO_REVIEWS_PENALTY')
    );                                                                                            
                                                                                                  
    if (!filtered.length) {
      Logger.log(`  [${sheetPrefix}] All ${items.length} rows were penalty rows — sheet skipped`);
      return;                                                                                     
    }
                                                                                                  
    if (filtered.length < items.length) {                   
      Logger.log(`  [${sheetPrefix}] Dropped ${items.length - filtered.length} penalty row(s), keeping ${filtered.length}`);                                                                   
    }
                                                                                                  
    const ss = SpreadsheetApp.getActiveSpreadsheet();                                             
    const baseName = `${sheetPrefix}_${formatYYMMDD_(startedAt)}`;
    const sheetName = getUniqueSheetName_(ss, baseName);                                          
    const sh = ss.insertSheet(sheetName);                                                         
  
    const headers = Object.keys(filtered[0]);                                                     
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);

    const values = filtered.map(r => headers.map(h => r[h] ?? ''));                               
    sh.getRange(2, 1, values.length, headers.length).setValues(values);
  }  

/*************************************************
 * UNIQUE SHEET NAME
 *************************************************/

function getUniqueSheetName_(ss, baseName) {
  const names = ss.getSheets().map(s => s.getName());
  if (!names.includes(baseName)) return baseName;

  let i = 1;
  let name;
  do {
    name = `${baseName}_${i++}`;
  } while (names.includes(name));

  return name;
}

/*************************************************
 * TRIGGERS
 *************************************************/

function ensurePollingTrigger_() {
  const exists = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === 'pollApifyRuns');

  if (!exists) {
    ScriptApp.newTrigger('pollApifyRuns')
      .timeBased()
      .everyMinutes(POLL_INTERVAL_MINUTES)
      .create();
  }
}

function removePollingTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'pollApifyRuns')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

/*************************************************
 * UTIL
 *************************************************/

function getApifyToken_() {
  const token = PropertiesService.getScriptProperties().getProperty('APIFY_TOKEN');
  if (!token) throw new Error('APIFY_TOKEN missing');
  return token;
}

function formatYYMMDD_(d) {
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function isRunAlreadyMaterialized_(runId) {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty(`APIFY_RUN_DONE_${runId}`) === '1';
}

function markRunAsMaterialized_(runId) {
  PropertiesService.getScriptProperties()
    .setProperty(`APIFY_RUN_DONE_${runId}`, '1');
}

function clearRunDoneProperties() {
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();

  let deleted = 0;

  for (const key in allProps) {
    if (key.includes('RUN_DONE')) {
      props.deleteProperty(key);
      Logger.log(`Deleted property: ${key}`);
      deleted++;
    }
  }

  Logger.log(`Total deleted RUN_DONE properties: ${deleted}`);
}

  function fetchLatestGlx26Run() {
    const token = getApifyToken_();
    const { taskId, sheetPrefix } = APIFY_TASKS.Glx26;

    // Get the most recent run for this task
    const url = `${APIFY_BASE}/actor-tasks/${taskId}/runs/last?token=${token}`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const json = JSON.parse(res.getContentText());

    if (!json.data) {
      Logger.log('No recent run found for Glx26');
      return;
    }

    const { id: runId, status, defaultDatasetId, startedAt } = json.data;
    Logger.log(`Run ID: ${runId} | Status: ${status} | Dataset: ${defaultDatasetId}`);

    if (status !== 'SUCCEEDED') {
      Logger.log(`Run has not succeeded (status: ${status}) — fetching anyway`);
    }

    createResultSheet_(sheetPrefix, defaultDatasetId, new Date(startedAt));
    Logger.log(`Done — check for sheet: ${sheetPrefix}_${formatYYMMDD_(new Date(startedAt))}`);
  }
