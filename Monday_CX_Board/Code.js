/*************************************************
 * CONFIG
 *************************************************/
const BOARD_ID = 5669388007; // ← change per sheet
const MONDAY_API_KEY_HARDCODED = ''; // or set Script Property 'MONDAY_API_KEY'
const PAGE_LIMIT = 500;
const RUN_LOCK_KEY = 'MONDAY_SYNC_LOCK';
const RESPECT_SHEET_FORMATS = true;

/** ====== MENU + UI (modeless dialog with Monday logo + live log) ====== **/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Monday.com')
    .addItem('업데이트하기', 'showMondaySyncDialog')
    .addToUi();
}
function showMondaySyncDialog() {
  var reqId = Utilities.getUuid();
  var html = HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><base target="_top"><meta charset="UTF-8">' +
    '<style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;padding:12px}' +
    '.top{display:flex;align-items:center;gap:12px;margin-bottom:8px}.logo{height:28px}' +
    '.spinner{width:18px;height:18px;border:3px solid #e6e6e6;border-top-color:#2b88d9;border-radius:50%;animation:spin 1s linear infinite}' +
    '.status{font-size:12px;color:#333}.log{width:100%;height:250px;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#fafafa;border:1px solid #dadce0;border-radius:6px;padding:8px;white-space:pre;overflow:auto}' +
    '.err{color:#b00020;font-size:12px;margin-top:6px;white-space:pre-wrap}.btns{margin-top:8px;display:flex;gap:6px}' +
    '.btn{padding:6px 10px;border:1px solid #dadce0;border-radius:6px;background:#fff;cursor:pointer;font-size:12px}.btn:hover{background:#f7f7f7}.hidden{display:none}' +
    '@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style></head><body>' +
    '<div class="top"><img class="logo" src="https://cdn.monday.com/images/logos/monday_logo_full.png" alt="Monday.com">' +
    '<div id="spin" class="spinner" aria-label="Loading"></div><div id="status" class="status">Starting sync…</div></div>' +
    '<div id="log" class="log" readonly></div><div id="err" class="err hidden"></div>' +
    '<div class="btns"><button class="btn" onclick="copyLog()">Copy log</button><button class="btn" onclick="google.script.host.close()">Close</button></div>' +
    '<script>var reqId=' + JSON.stringify(reqId) + ';var timer=null,lastCount=0;' +
    'function render(s){if(!s)return;var l=document.getElementById("log"),st=document.getElementById("status"),sp=document.getElementById("spin"),er=document.getElementById("err");' +
    'var lines=s.lines||[];if(lines.length>lastCount){var slice=lines.slice(lastCount).join("\\n");l.textContent+=(l.textContent?"\\n":"")+slice;l.scrollTop=l.scrollHeight;lastCount=lines.length}' +
    'if(s.done){sp.classList.add("hidden");st.textContent=s.error?"Sync failed.":"Sync completed.";if(s.error){er.textContent=s.error;er.classList.remove("hidden")}if(timer)clearInterval(timer)}' +
    'else{st.textContent="Sync in progress…"}}' +
    'function poll(){google.script.run.withSuccessHandler(render).withFailureHandler(function(e){if(timer)clearInterval(timer);render({lines:[],done:true,error:(e&&e.message)?e.message:String(e)})}).getProgress(reqId)}' +
    'function startRun(){google.script.run.withSuccessHandler(function(){timer=setInterval(poll,600);google.script.run.withFailureHandler(function(e){if(timer)clearInterval(timer);render({lines:[],done:true,error:(e&&e.message)?e.message:String(e)})}).syncMondayBoardToSheet(reqId)}).withFailureHandler(function(e){render({lines:[],done:true,error:(e&&e.message)?e.message:String(e)})}).clearProgress(reqId)}' +
    'function copyLog(){var t=document.getElementById("log").textContent||"";navigator.clipboard.writeText(t)}startRun();</script></body></html>'
  ).setWidth(520).setHeight(420);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Syncing Monday Board…');
}

/** ====== PROGRESS LOGGER (user cache) ====== **/
function _progressKey_(reqId){ return 'MONDAY_SYNC_PROGRESS__' + reqId; }
function _getCache_(){ return CacheService.getUserCache(); }
function clearProgress(reqId){ if(!reqId) throw new Error('Missing reqId'); _getCache_().remove(_progressKey_(reqId)); return true; }
function getProgress(reqId){
  if(!reqId) throw new Error('Missing reqId');
  const raw = _getCache_().get(_progressKey_(reqId));
  if(!raw) return {lines:[], done:false, error:null};
  try { return JSON.parse(raw); } catch { return {lines:[], done:false, error:null}; }
}
function _pushLog_(reqId, line){
  if(!reqId) return;
  const key = _progressKey_(reqId), cache = _getCache_();
  const state = getProgress(reqId);
  const ts = Utilities.formatDate(new Date(), 'Asia/Seoul', 'HH:mm:ss');
  state.lines.push('['+ts+'] '+String(line));
  if(state.lines.length>600) state.lines = state.lines.slice(-600);
  cache.put(key, JSON.stringify(state), 21600);
}
function _finishLog_(reqId){ if(!reqId) return; const key=_progressKey_(reqId), cache=_getCache_(); const s=getProgress(reqId); s.done=true; cache.put(key, JSON.stringify(s), 21600); }
function _failLog_(reqId, err){ if(!reqId) return; const key=_progressKey_(reqId), cache=_getCache_(); const s=getProgress(reqId); s.done=true; s.error=String(err||'Unknown error'); cache.put(key, JSON.stringify(s), 21600); }

/** ====== MAIN SYNC ====== **/
function syncMondayBoardToSheet(reqId){
  _acquireRunLock_();
  try{
    const apiKey = _getMondayApiKey_();
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName('Data') || ss.getActiveSheet();
    _pushLog_(reqId, 'Start sync → board='+BOARD_ID+', sheet="'+sheet.getName()+'"');

    // 1) Columns
    _pushLog_(reqId, 'Fetching columns…');
    const colQuery =
      'query ($boardId: [ID!]) {' +
      '  boards(ids: $boardId) { id name columns { id title type } }' +
      '}';
    const colResp = _mondayFetch_(apiKey, colQuery, { boardId: BOARD_ID });
    const board = (colResp.data && colResp.data.boards && colResp.data.boards[0]) || {};
    const colsAll = (board.columns||[]).filter(function(c){ return c.id !== 'name'; });
    const colIds   = colsAll.map(function(c){ return c.id; });
    const colNames = colsAll.map(function(c){ return c.title || c.id; });
    const formulaColIds = colsAll.filter(function(c){ return (c.type||'').toLowerCase()==='formula'; }).map(function(c){ return c.id; });
    _pushLog_(reqId, 'Columns: '+colIds.length+' (formulas: '+formulaColIds.length+') board="'+(board.name||'')+'"');

    // 2) Pass 1: items_page with typed fragments
    _pushLog_(reqId, 'Fetching items (page size='+PAGE_LIMIT+')…');
    const first = _fetchAllItems_WithFragments(apiKey, BOARD_ID, reqId);
    const items = first.items, pages = first.pages;
    _pushLog_(reqId, 'Items fetched: '+items.length+' across '+pages+' page(s)');

    // 3) Pass 2: targeted formula columns (still with fragments)
    var secondByItem = {};
    if (formulaColIds.length){
      _pushLog_(reqId, 'Second pass for formula columns ('+formulaColIds.length+')…');
      secondByItem = _fetchSpecificColumnValues_WithFragments(apiKey, BOARD_ID, formulaColIds, reqId);
    }

    // 4) Determine items needing pass 3
    var missingForPass3 = new Map();
    if (formulaColIds.length){
      for (var i=0;i<items.length;i++){
        var it = items[i];
        var map = {}; (it.column_values||[]).forEach(function(cv){ map[cv.id]=cv; });
        for (var j=0;j<formulaColIds.length;j++){
          var cid = formulaColIds[j];
          var a = map[cid], b = secondByItem[it.id] ? secondByItem[it.id][cid] : null;
          if (_isFormulaEmpty_(a) && _isFormulaEmpty_(b)) {
            var arr = missingForPass3.get(it.id) || [];
            arr.push(cid);
            missingForPass3.set(it.id, arr);
          }
        }
      }
      _pushLog_(reqId, 'Items needing 3rd pass: '+missingForPass3.size);
    }

    // 5) Pass 3: root-level items(ids:[…]) with fragments
    var thirdByItem = {};
    if (missingForPass3.size){
      _pushLog_(reqId, 'Third pass (root-level items, chunked)…');
      thirdByItem = _fetchPerItemColumnsChunked_RootItems_WithFragments(apiKey, missingForPass3, reqId);
    }

    // 6) Build rows
    _pushLog_(reqId, 'Mapping values…');
    var header = ['item_id', 'name'].concat(colNames);
    var dataRows = items.map(function(item, idx){
      var cvMap = {}; (item.column_values||[]).forEach(function(cv){ cvMap[cv.id]=cv; });
      var cells = colIds.map(function(cid){
        var cv = cvMap[cid];
        if (formulaColIds.indexOf(cid)>=0){
          if (_isFormulaEmpty_(cv)){
            var s = secondByItem[item.id] ? secondByItem[item.id][cid] : null;
            if (!_isFormulaEmpty_(s)) cv = s;
          }
          if (_isFormulaEmpty_(cv)){
            var t = thirdByItem[item.id] ? thirdByItem[item.id][cid] : null;
            if (!_isFormulaEmpty_(t)) cv = t;
          }
        }
        return _displayUniversal_(cv);
      });
      if ((idx+1)%500===0) _pushLog_(reqId, ' …mapped '+(idx+1)+' rows');
      return [item.id, item.name].concat(cells);
    });

    // 7) Write (preserve header formatting)
    _pushLog_(reqId, 'Writing to sheet…');
    _writePreserveHeader_(sheet, header, dataRows);
    _pushLog_(reqId, 'Sheet write complete.');
    _finishLog_(reqId);
  }catch(e){
    _failLog_(reqId, (e&&e.message)?e.message:String(e));
    throw e;
  }finally{ _releaseRunLock_(); }
}

/** ====== COLUMN VALUE FRAGMENTS (safe set) ====== **/
function _cvFragments(){
  return '' +
    'id type text value ' +
    '... on MirrorValue { display_value } ' +
    '... on DependencyValue { display_value } ' +
    '... on SubtasksValue { display_value } ' +
    '... on StatusValue { label } ' +
    '... on LinkValue { url text } ' +
    '... on NumbersValue { number } ' +
    '... on DateValue { date } ' +
    '... on BoardRelationValue { linked_items { name } }';
}

/** ====== PASS 1: All items with fragments ====== **/
function _fetchAllItems_WithFragments(apiKey, boardId, reqId){
  var fr = _cvFragments();
  var query =
    'query ($boardId: [ID!], $pageCursor: String) {' +
    '  boards(ids: $boardId) {' +
    '    items_page(limit: '+PAGE_LIMIT+', cursor: $pageCursor) {' +
    '      items { id name column_values { '+fr+' } } cursor } } }';
  var cursor=null, all=[], pages=0;
  while(true){
    pages++;
    _pushLog_(reqId, 'Requesting page '+pages+(cursor?(' (cursor='+cursor+')'):'')+'…');
    var resp = _mondayFetch_(apiKey, query, { boardId: boardId, pageCursor: cursor });
    var page = resp.data && resp.data.boards && resp.data.boards[0] && resp.data.boards[0].items_page;
    var batch = (page && page.items) ? page.items : [];
    all = all.concat(batch);
    _pushLog_(reqId, ' → page '+pages+' size='+batch.length+' total='+all.length);
    if (!page || !page.cursor) break;
    cursor = page.cursor;
    Utilities.sleep(120);
  }
  return { items: all, pages: pages };
}

/** ====== PASS 2: Only formula columns via items_page (with fragments) ====== **/
function _fetchSpecificColumnValues_WithFragments(apiKey, boardId, colIds, reqId){
  if (!colIds || !colIds.length) return {};
  var fr = _cvFragments();
  var query =
    'query ($boardId: [ID!], $pageCursor: String, $colIds: [String!]) {' +
    '  boards(ids: $boardId) {' +
    '    items_page(limit: '+PAGE_LIMIT+', cursor: $pageCursor) {' +
    '      items { id column_values(ids: $colIds) { '+fr+' } } cursor } } }';
  var byItem={}, cursor=null, page=0;
  while(true){
    page++;
    _pushLog_(reqId, '2nd pass (columns='+colIds.length+') page '+page+(cursor?(' (cursor='+cursor+')'):'')+'…');
    var resp = _mondayFetch_(apiKey, query, { boardId: boardId, pageCursor: cursor, colIds: colIds });
    var pg = resp.data && resp.data.boards && resp.data.boards[0] && resp.data.boards[0].items_page;
    if (!pg) break;
    var its = pg.items || [];
    for (var i=0;i<its.length;i++){
      var it = its[i], map = byItem[it.id] || (byItem[it.id]={});
      (it.column_values||[]).forEach(function(cv){ map[cv.id]=cv; });
    }
    if (!pg.cursor) break;
    cursor = pg.cursor;
    Utilities.sleep(100);
  }
  return byItem;
}

/** ====== PASS 3: Root-level items(ids:[…]) with fragments (chunked) ====== **/
function _fetchPerItemColumnsChunked_RootItems_WithFragments(apiKey, missingMap, reqId){
  var byItem={}, ids = Array.from(missingMap.keys()), CHUNK=50, fr=_cvFragments();
  for (var i=0;i<ids.length;i+=CHUNK){
    var slice = ids.slice(i, i+CHUNK);
    var needCols = Array.from(new Set([].concat.apply([], slice.map(function(id){ return missingMap.get(id); }))));
    _pushLog_(reqId, '3rd pass chunk '+(Math.floor(i/CHUNK)+1)+': items='+slice.length+', cols='+needCols.length);
    var query =
      'query ($itemIds: [ID!], $colIds: [String!]) {' +
      '  items(ids: $itemIds) { id column_values(ids: $colIds) { '+fr+' } } }';
    var resp = _mondayFetch_(apiKey, query, { itemIds: slice, colIds: needCols });
    var its = (resp.data && resp.data.items) ? resp.data.items : [];
    for (var k=0;k<its.length;k++){
      var it = its[k], map = byItem[it.id] || (byItem[it.id]={});
      (it.column_values||[]).forEach(function(cv){ map[cv.id]=cv; });
    }
    Utilities.sleep(120);
  }
  return byItem;
}

/** ====== UNIVERSAL VALUE MAPPING ====== **/
function _displayUniversal_(cv){
  if (!cv) return '';
  if (_hasNonEmpty_(cv.display_value)) return _cleanStr_(cv.display_value);
  if (_hasNonEmpty_(cv.label))         return _cleanStr_(cv.label);
  if (_hasNonEmpty_(cv.url))           return _cleanStr_(cv.url);
  if (_hasNonEmpty_(cv.number))        return String(cv.number);
  if (_hasNonEmpty_(cv.date))          return String(cv.date);
  if (Array.isArray(cv.linked_items) && cv.linked_items.length) {
    var names = cv.linked_items.map(function(li){ return li && li.name; }).filter(Boolean);
    if (names.length) return names.join(', ');
  }
  if (_hasNonEmpty_(cv.text)) return _cleanStr_(cv.text);

  if (_hasNonEmpty_(cv.value)){
    var parsed = _tryJsonParse_(cv.value);
    if (parsed && typeof parsed === 'object') {
      if (parsed.api_ticket_url) return _cleanZendeskUrl_(String(parsed.api_ticket_url));

      if (parsed.checked != null) return String(parsed.checked).toLowerCase()==='true' ? 'TRUE' : 'FALSE';
      if (_hasNonEmpty_(parsed.display_value)) return _cleanStr_(parsed.display_value);
      if (_hasNonEmpty_(parsed.text))          return _cleanStr_(parsed.text);
      if (_hasNonEmpty_(parsed.label))         return _cleanStr_(parsed.label);
      if (_hasNonEmpty_(parsed.url))           return _cleanStr_(parsed.url);
      if (_hasNonEmpty_(parsed.value))         return _cleanStr_(parsed.value);
      if (parsed.date)                         return String(parsed.date);
      if (parsed.number != null)               return String(parsed.number);

      var flat = _flattenForDisplay_(parsed);
      if (_hasNonEmpty_(flat)) return flat;
      return _cleanStr_(JSON.stringify(parsed));
    }
    if (typeof cv.value === 'string') {
      var m = cv.value.match(/"api_ticket_url"\s*:\s*"([^"]+)"/);
      if (m) return _cleanZendeskUrl_(m[1]);
      return _cleanStr_(cv.value.replace(/^"(.*)"$/, '$1'));
    }
  }
  return '';
}
function _cleanZendeskUrl_(u){
  try {
    var id = (u.match(/\/tickets\/(\d+)/)||[])[1];
    var m = u.match(/^https?:\/\/([^\/]+)/);
    if (id && m) return 'https://' + m[1] + '/api/v2/tickets/' + id;
  } catch(_) {}
  return String(u||'').replace(/\.json$/i,'');
}

function _isFormulaEmpty_(cv){
  if (!cv) return true;
  if (_hasNonEmpty_(cv.display_value) || _hasNonEmpty_(cv.label) || _hasNonEmpty_(cv.url) ||
      _hasNonEmpty_(cv.number) || _hasNonEmpty_(cv.date) || _hasNonEmpty_(cv.text)) return false;
  if (_hasNonEmpty_(cv.value)) {
    var parsed = _tryJsonParse_(cv.value);
    if (parsed && typeof parsed === 'object') {
      if (_hasNonEmpty_(parsed.display_value) || _hasNonEmpty_(parsed.text) ||
          _hasNonEmpty_(parsed.label) || _hasNonEmpty_(parsed.url) ||
          _hasNonEmpty_(parsed.value) || parsed.date || (parsed.number != null)) return false;
    } else if (String(cv.value).trim() !== '') return false;
  }
  return true;
}

function _flattenForDisplay_(obj){
  var out = [];
  (function walk(x){
    if (x == null) return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (typeof x === 'object') {
      if (typeof x.name  === 'string') out.push(x.name);
      if (typeof x.text  === 'string') out.push(x.text);
      if (typeof x.label === 'string') out.push(x.label);
      if (typeof x.url   === 'string') out.push(x.url);
      if (typeof x.value === 'string') out.push(x.value);
      Object.keys(x).forEach(function(k){ walk(x[k]); });
      return;
    }
    if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') out.push(String(x));
  })(obj);
  out = out.map(function(s){ return String(s||'').trim(); }).filter(Boolean);
  return out.length ? Array.from(new Set(out)).join(', ') : '';
}

/** ====== SHEET WRITE (preserve row-1 formatting) ====== **/
function _writePreserveHeader_(sheet, header, rows){
  if (!header || !header.length) return;
  _ensureCols_(sheet, header.length);
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  var maxRows = sheet.getMaxRows();
  if (maxRows > 1) sheet.getRange(2, 1, maxRows - 1, header.length).clearContent();
  if (rows && rows.length) sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
  if (!RESPECT_SHEET_FORMATS) { sheet.setFrozenRows(1); sheet.autoResizeColumns(1, header.length); }
}

/** ====== MONDAY API (GraphQL) ====== **/
function _mondayFetch_(apiKey, query, variables){
  var resp = UrlFetchApp.fetch('https://api.monday.com/v2', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: apiKey
    },
    payload: JSON.stringify({ query: query, variables: (variables||{}) }),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('Monday API HTTP '+code+': '+resp.getContentText());
  var json = JSON.parse(resp.getContentText());
  if (json.errors && json.errors.length) throw new Error('Monday GraphQL error: ' + JSON.stringify(json.errors));
  return json;
}

/** ====== UTILS ====== **/
function clearRunLock(){
  PropertiesService.getScriptProperties().deleteProperty(RUN_LOCK_KEY);
  Logger.log('Run lock cleared.');
}
function _getMondayApiKey_(){
  var p = PropertiesService.getScriptProperties().getProperty('MONDAY_API_KEY');
  if (p && p.trim()) return p.trim();
  if (MONDAY_API_KEY_HARDCODED && MONDAY_API_KEY_HARDCODED.trim()) return MONDAY_API_KEY_HARDCODED.trim();
  throw new Error('Missing Monday API key.');
}
function _acquireRunLock_(){
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(RUN_LOCK_KEY)) throw new Error('Another Monday sync is already running.');
  props.setProperty(RUN_LOCK_KEY, String(Date.now()));
}
function _releaseRunLock_(){ PropertiesService.getScriptProperties().deleteProperty(RUN_LOCK_KEY); }
function _ensureCols_(sheet, neededCols){
  var have = sheet.getMaxColumns();
  if (have < neededCols) sheet.insertColumnsAfter(have, neededCols - have);
}
function _tryJsonParse_(s){ try{ return (typeof s === 'string') ? JSON.parse(s) : s; } catch(e){ return null; } }
function _hasNonEmpty_(v){ return v != null && String(v).trim() !== ''; }
function _cleanStr_(s){ return String(s == null ? '' : s).trim(); }
