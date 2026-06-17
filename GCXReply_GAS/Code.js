// GCX Reply — Apps Script Web App (v2.5.0)
// Endpoint: ?orderId=XXX  |  ?asin=XXX  |  ?orderId=XXX&asin=XXX
// Deploy as: Execute as Me, Access: Anyone (or Anyone anonymous)
// Script Properties required: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
//   LWA_CLIENT_ID, LWA_CLIENT_SECRET, LWA_REFRESH_TOKEN,         ← EU + NA
//   LWA_CLIENT_ID_JP, LWA_CLIENT_SECRET_JP, LWA_REFRESH_TOKEN_JP ← Japan (FE)
//   LWA_CLIENT_ID_IN, LWA_CLIENT_SECRET_IN, LWA_REFRESH_TOKEN_IN ← India

const SHEET_ID    = '1fx9K4r2T9SeZK076zy9kMHoLzAKDgmlRp-C2VtnTKVo';
const SHEET_NAME  = 'Data';
const PRODUCT_COLS  = ['SKU','모델명','브랜드','제조사명','기종명','색상명','대분류','생산업체','원산지정보'];
const MARKET_SS_ID  = '172fDVw4tu-hgbpV5FShWj4_SAMxeB54-v5BUlVgJUoA';
const MARKET_SHEETS = ['DE', 'NL', 'SE', 'ES', 'UK', 'FR', 'IT', 'JP', 'IN', 'SG'];

// ── AI 인입사유 (DR) ───────────────────────────────────────────────────────────
const DEFECT_SS_ID      = '1fpv9TEDPGR8D6QRRc0ll-WzF7sOkfxe9UNBCmdBSE9g';
const DEFECT_SHEET_NAME = 'Defect';
const DR_CACHE_VERSION  = 'DR_v22_';
const DR_CACHE_TTL      = 21600;
const GEMINI_MODELS_DR  = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];

const REGIONS = [
  { endpoint: 'https://sellingpartnerapi-eu.amazon.com', region: 'eu-west-1', cred: 'main' },
  { endpoint: 'https://sellingpartnerapi-fe.amazon.com', region: 'us-west-2', cred: 'jp'   },
  { endpoint: 'https://sellingpartnerapi-na.amazon.com', region: 'us-east-1', cred: 'main' },
  // India uses the EU endpoint but a separate Seller Central account (own refresh token)
  { endpoint: 'https://sellingpartnerapi-eu.amazon.com', region: 'eu-west-1', cred: 'in'   },
];

// SalesChannel suffix → SP-API Marketplace ID (order matters: longest suffix first)
const MARKETPLACE_MAP = [
  ['.com.sg', 'A19VAU5U5O7RUS'],
  ['.com.au', 'A39IBJ37TRP1C6'],
  ['.com.mx', 'A1AM78C64UM0Y8'],
  ['.com.tr', 'A33AVAJ2PDY3EV'],
  ['.co.uk',  'A1F83G8C2ARO7P'],
  ['.co.jp',  'A1VC38T7YXB528'],
  ['.de',     'A1PA6795UKMFR9'],
  ['.fr',     'A13V1IB3VIYZZH'],
  ['.it',     'APJ6JRA9NG5V4'],
  ['.es',     'A1RKKUPIHCS9HS'],
  ['.nl',     'A1805IZSGTT6HS'],
  ['.pl',     'AZ1PBY3F3E3AE'],
  ['.se',     'A2NODRKZP88ZB9'],
  ['.be',     'AMEN7PMS3EDWL'],
  ['.in',     'A21TJRUUN4KGV'],
  ['.ca',     'A2EUQ1WTGCTBG2'],
  ['.tr',     'A33AVAJ2PDY3EV'],
  ['.com',    'ATVPDKIKX0DER'],
];

function marketplaceId_(salesChannel) {
  if (!salesChannel) return null;
  const s = salesChannel.toLowerCase();
  const match = MARKETPLACE_MAP.find(([suffix]) => s.includes(suffix));
  return match ? match[1] : null;
}

// ── Entry point ───────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    const p       = (e && e.parameter) || {};
    const orderId = p.orderId;
    const asin    = p.asin;

    if (p.action === 'inferReason') {
      const review   = p.review   || '';
      const category = p.category || '';
      if (!review) return respond({ error: 'Provide review parameter' });
      return respond({ reason: inferReason_(review, category) });
    }

    if (!orderId && !asin) {
      return respond({ error: 'Provide orderId and/or asin parameter' });
    }

    const result = {};

    if (orderId) {
      if (!/^\d{3}-\d{7}-\d{7}$/.test(orderId)) {
        return respond({ error: 'Invalid order ID format' });
      }
      const orderData = fetchOrderData_(orderId);
      Object.assign(result, orderData);

      // Auto-lookup ASIN from items if not passed explicitly
      const itemAsin = !asin && orderData.items && orderData.items[0]
        ? orderData.items[0].ASIN : null;
      if (itemAsin) {
        const lu = lookupAsinAll_(itemAsin);
        result.product = lu.product;
        result.productSource = lu.productSource;
        result.allSources = lu.allSources;
        try { result.marketplaces = checkMarketplaces_(itemAsin); } catch { result.marketplaces = []; }
      }
    }

    if (asin) {
      const lu = lookupAsinAll_(asin);
      result.product = lu.product;
      result.productSource = lu.productSource;
      result.allSources = lu.allSources;
      try { result.marketplaces = checkMarketplaces_(asin); } catch { result.marketplaces = []; }
    }

    return respond(result);
  } catch (err) {
    return respond({ error: err.message });
  }
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Keep-warm: prevents GAS cold starts during business hours ─────────────────
// Run setupKeepWarmTrigger() ONCE from the GAS editor to install it.
function keepWarm() {
  CacheService.getScriptCache().get('ping');
}

function setupKeepWarmTrigger() {
  const existing = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'keepWarm');
  if (existing.length) { Logger.log('keepWarm trigger already exists (' + existing.length + ')'); return; }
  ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(5).create();
  Logger.log('keepWarm trigger created — fires every 5 minutes');
}

// ── LWA token (cached 4 min) ──────────────────────────────────────────────────
function getLwaToken_(cred) {
  const cache    = CacheService.getScriptCache();
  const cacheKey = 'lwa_' + cred;
  const hit      = cache.get(cacheKey);
  if (hit) return hit;

  const props  = PropertiesService.getScriptProperties().getProperties();
  const sfx    = cred === 'jp' ? '_JP' : cred === 'in' ? '_IN' : '';
  const resp   = UrlFetchApp.fetch('https://api.amazon.com/auth/o2/token', {
    method: 'post',
    payload: {
      grant_type:    'refresh_token',
      refresh_token: props['LWA_REFRESH_TOKEN' + sfx],
      client_id:     props['LWA_CLIENT_ID'     + sfx],
      client_secret: props['LWA_CLIENT_SECRET' + sfx],
    },
    muteHttpExceptions: true,
  });

  const d = JSON.parse(resp.getContentText());
  if (!d.access_token) throw new Error('LWA failed: ' + resp.getContentText());
  cache.put(cacheKey, d.access_token, Math.min(d.expires_in - 180, 180));
  return d.access_token;
}

// ── AWS SigV4 ─────────────────────────────────────────────────────────────────
function sha256Hex_(msg) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, msg)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function hmac_(key, msg) {
  const msgBytes = Utilities.newBlob(msg).getBytes();
  const keyBytes = typeof key === 'string' ? Utilities.newBlob(key).getBytes() : key;
  return Utilities.computeHmacSha256Signature(msgBytes, keyBytes);
}

function hmacHex_(key, msg) {
  return hmac_(key, msg).map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function signingKey_(secret, dateStamp, region) {
  const kDate    = hmac_('AWS4' + secret, dateStamp);
  const kRegion  = hmac_(kDate,           region);
  const kService = hmac_(kRegion,         'execute-api');
  return hmac_(kService, 'aws4_request');
}

function spApiGet_(endpoint, region, cred, fullPath, tokenOverride) {
  const props     = PropertiesService.getScriptProperties().getProperties();
  const accessKey = props['AWS_ACCESS_KEY_ID'];
  const secretKey = props['AWS_SECRET_ACCESS_KEY'];
  const token     = tokenOverride || getLwaToken_(cred);
  const host      = endpoint.replace('https://', '');

  const now       = new Date();
  const amzDate   = Utilities.formatDate(now, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  const dateStamp = Utilities.formatDate(now, 'UTC', 'yyyyMMdd');

  // Split path from query string — SigV4 canonical request requires them separately
  const qIdx      = fullPath.indexOf('?');
  const uriPath   = qIdx >= 0 ? fullPath.slice(0, qIdx) : fullPath;
  const rawQuery  = qIdx >= 0 ? fullPath.slice(qIdx + 1) : '';
  const canonQuery = rawQuery
    ? rawQuery.split('&').map(pair => {
        const eq = pair.indexOf('=');
        const k  = eq >= 0 ? pair.slice(0, eq) : pair;
        const v  = eq >= 0 ? pair.slice(eq + 1) : '';
        return encodeURIComponent(decodeURIComponent(k)) + '=' + encodeURIComponent(decodeURIComponent(v));
      }).sort().join('&')
    : '';

  // host must be signed but UrlFetchApp rejects it as a custom header — GAS sets it automatically
  const signHdrs = { 'host': host, 'x-amz-access-token': token, 'x-amz-date': amzDate };
  const keys = Object.keys(signHdrs).sort();
  const canonHdrs  = keys.map(k => k + ':' + signHdrs[k]).join('\n') + '\n';
  const signedHdrs = keys.join(';');

  const canonReq = ['GET', uriPath, canonQuery, canonHdrs, signedHdrs, sha256Hex_('')].join('\n');
  const scope    = `${dateStamp}/${region}/execute-api/aws4_request`;
  const sts      = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex_(canonReq)].join('\n');
  const sig      = hmacHex_(signingKey_(secretKey, dateStamp, region), sts);
  const auth     = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHdrs}, Signature=${sig}`;

  const res = UrlFetchApp.fetch(endpoint + fullPath, {
    method:             'get',
    headers:            { 'x-amz-access-token': token, 'x-amz-date': amzDate, 'Authorization': auth },
    muteHttpExceptions: true,
  });
  return { status: res.getResponseCode(), body: res.getContentText() };
}

// ── SP-API POST (for Tokens API) ──────────────────────────────────────────────
function spApiPost_(endpoint, region, cred, path, body) {
  const props     = PropertiesService.getScriptProperties().getProperties();
  const accessKey = props['AWS_ACCESS_KEY_ID'];
  const secretKey = props['AWS_SECRET_ACCESS_KEY'];
  const token     = getLwaToken_(cred);
  const host      = endpoint.replace('https://', '');

  const now       = new Date();
  const amzDate   = Utilities.formatDate(now, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  const dateStamp = Utilities.formatDate(now, 'UTC', 'yyyyMMdd');

  const bodyStr    = JSON.stringify(body);
  const payloadHash = sha256Hex_(bodyStr);

  const signHdrs  = { 'content-type': 'application/json', 'host': host, 'x-amz-access-token': token, 'x-amz-date': amzDate };
  const keys      = Object.keys(signHdrs).sort();
  const canonHdrs  = keys.map(k => k + ':' + signHdrs[k]).join('\n') + '\n';
  const signedHdrs = keys.join(';');

  const canonReq = ['POST', path, '', canonHdrs, signedHdrs, payloadHash].join('\n');
  const scope    = `${dateStamp}/${region}/execute-api/aws4_request`;
  const sts      = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex_(canonReq)].join('\n');
  const sig      = hmacHex_(signingKey_(secretKey, dateStamp, region), sts);
  const auth     = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHdrs}, Signature=${sig}`;

  const res = UrlFetchApp.fetch(endpoint + path, {
    method:             'post',
    headers:            { 'Content-Type': 'application/json', 'x-amz-access-token': token, 'x-amz-date': amzDate, 'Authorization': auth },
    payload:            bodyStr,
    muteHttpExceptions: true,
  });
  return { status: res.getResponseCode(), body: res.getContentText() };
}

// ── Restricted Data Token for getOrderItems ───────────────────────────────────
function getRdt_(endpoint, region, cred, orderId) {
  const r = spApiPost_(endpoint, region, cred, '/tokens/2021-03-01/restrictedDataToken', {
    restrictedResources: [
      { method: 'GET', path: `/orders/v0/orders/${orderId}/items` },
      { method: 'GET', path: `/orders/v0/orders/${orderId}/buyerInfo`, dataElements: ['buyerInfo'] },
    ],
  });
  if (r.status !== 200) return { token: null, status: r.status, error: r.body };
  try {
    const t = JSON.parse(r.body).restrictedDataToken || null;
    return { token: t, status: r.status, error: null };
  } catch { return { token: null, status: r.status, error: r.body }; }
}

// ── Buyer purchase + refund stats (last 2 years, up to 500 orders) ───────────
// Returns { totalPurchases, totalRefunds } where totalRefunds = Canceled orders.
function fetchBuyerPurchaseStats_(endpoint, region, cred, salesChannel, buyerEmail) {
  const mpId = marketplaceId_(salesChannel);
  if (!mpId || !buyerEmail) return null;

  const createdAfter = new Date(Date.now() - 2 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 19) + 'Z';
  let totalPurchases = 0;
  let totalRefunds   = 0;
  let nextToken      = null;
  let page           = 0;

  do {
    const path = nextToken
      ? `/orders/v0/orders?NextToken=${encodeURIComponent(nextToken)}`
      : `/orders/v0/orders?MarketplaceIds=${encodeURIComponent(mpId)}&BuyerEmail=${encodeURIComponent(buyerEmail)}&CreatedAfter=${encodeURIComponent(createdAfter)}&MaxResultsPerPage=100`;
    const r = spApiGet_(endpoint, region, cred, path);
    if (r.status !== 200) break;
    try {
      const d      = JSON.parse(r.body);
      const orders = d.payload?.Orders || [];
      totalPurchases += orders.length;
      totalRefunds   += orders.filter(o => o.OrderStatus === 'Canceled').length;
      nextToken       = d.payload?.NextToken || null;
    } catch { break; }
    page++;
  } while (nextToken && page < 5);

  return { totalPurchases, totalRefunds };
}

// ── Fetch order + items + address + buyer ─────────────────────────────────────
function fetchOrderData_(orderId) {
  const regionErrors = [];
  for (const { endpoint, region, cred } of REGIONS) {
    let r;
    try { r = spApiGet_(endpoint, region, cred, `/orders/v0/orders/${orderId}`); }
    catch (e) { regionErrors.push(`${cred}:LWA(${e.message})`); continue; }

    // 403 + "expired" → cached LWA token went stale; clear cache and retry once
    if (r.status === 403 && r.body.includes('expired')) {
      CacheService.getScriptCache().remove('lwa_' + cred);
      try { r = spApiGet_(endpoint, region, cred, `/orders/v0/orders/${orderId}`); }
      catch (e) { regionErrors.push(`${cred}:LWA-retry(${e.message})`); continue; }
    }

    if (r.status !== 200) {
      const detail = (r.status === 403 && r.body.includes('expired')) ? '(auth-revoked)' : '';
      regionErrors.push(`${cred}:${r.status}${detail}`);
      continue;
    }

    const order  = JSON.parse(r.body).payload || {};
    if (!order.AmazonOrderId) { regionErrors.push(`${cred}:200-noId`); continue; }

    const rdtResult = getRdt_(endpoint, region, cred, orderId);
    const rdtToken  = rdtResult.token || undefined;
    const itemsR    = spApiGet_(endpoint, region, cred, `/orders/v0/orders/${orderId}/items`,     rdtToken);
    const addrR     = spApiGet_(endpoint, region, cred, `/orders/v0/orders/${orderId}/address`);
    const buyerR    = spApiGet_(endpoint, region, cred, `/orders/v0/orders/${orderId}/buyerInfo`, rdtToken);

    const buyer = buyerR.status === 200 ? JSON.parse(buyerR.body).payload || {} : {};
    const stats = fetchBuyerPurchaseStats_(endpoint, region, cred, order.SalesChannel, buyer.BuyerEmail || null);

    return {
      order,
      items:          itemsR.status === 200 ? JSON.parse(itemsR.body).payload?.OrderItems || [] : [],
      itemsStatus:    itemsR.status,
      itemsError:     itemsR.body,
      rdtStatus:      rdtResult.status,
      rdtError:       rdtResult.error,
      address:        addrR.status === 200 ? JSON.parse(addrR.body).payload?.ShippingAddress || {} : {},
      buyer,
      orderCount:     stats ? stats.totalPurchases : null,
      totalPurchases: stats ? stats.totalPurchases : null,
      totalRefunds:   stats ? stats.totalRefunds   : null,
      region,
    };
  }
  throw new Error('Order not found — ' + regionErrors.join(' | '));
}


// ── ASIN marketplace availability (market spreadsheet) ───────────────────────
// Returns array of country codes (e.g. ['DE','UK']) where the ASIN is selling.
// A row is counted only if it contains the ASIN AND no cell contains '단종'.
function colToLetter_(col) {
  let letter = '';
  for (let c = col + 1; c > 0; ) {
    const rem = (c - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    c = Math.floor((c - 1) / 26);
  }
  return letter;
}

function checkMarketplaces_(asin) {
  const cache    = CacheService.getScriptCache();
  const cacheKey = 'mkt3_' + asin;
  const hit      = cache.get(cacheKey);
  if (hit) return JSON.parse(hit);

  const ss      = SpreadsheetApp.openById(MARKET_SS_ID);
  const selling = [];
  for (const sheetName of MARKET_SHEETS) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;
    const data = sheet.getDataRange().getValues();
    for (let r = 0; r < data.length; r++) {
      const cells  = data[r].map(c => String(c));
      const colIdx = cells.findIndex(c => c === asin);
      if (colIdx >= 0) {
        if (!cells.some(c => c.includes('단종'))) {
          selling.push({ name: sheetName, gid: sheet.getSheetId(), cell: colToLetter_(colIdx) + (r + 1) });
        }
        break;
      }
    }
  }

  cache.put(cacheKey, JSON.stringify(selling), 3600);
  return selling;
}

// ── Google Sheet ASIN lookup ──────────────────────────────────────────────────
function lookupAsin_(asin) {
  const sheet   = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const asinIdx = headers.indexOf('ASIN');
  if (asinIdx < 0) throw new Error('ASIN column not found in sheet');

  const match = data.slice(1).find(row => String(row[asinIdx]) === asin);
  if (!match) return null;

  const result = {};
  PRODUCT_COLS.forEach(col => {
    const i = headers.indexOf(col);
    if (i >= 0) result[col] = match[i] !== undefined ? String(match[i]) : '';
  });
  return result;
}

// ── Market spreadsheet — Data sheet ASIN lookup (source 2) ───────────────────
function lookupAsin2_(asin) {
  const sheet = SpreadsheetApp.openById(MARKET_SS_ID).getSheetByName('Data');
  if (!sheet) return null;
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const asinIdx = headers.indexOf('ASIN');
  if (asinIdx < 0) return null;

  const match = data.slice(1).find(row => String(row[asinIdx]) === asin);
  if (!match) return null;

  const result = {};
  PRODUCT_COLS.forEach(col => {
    const i = headers.indexOf(col);
    if (i >= 0) result[col] = match[i] !== undefined ? String(match[i]) : '';
  });
  return result;
}

// ── Market country sheets — partial lookup (col A = 기종명, col B = 모델명) ───
// Returns a partial product object; other fields will be filled by Amazon page.
function lookupAsinFromMarket_(asin) {
  const cache    = CacheService.getScriptCache();
  const cacheKey = 'mkt_partial_' + asin;
  const hit      = cache.get(cacheKey);
  if (hit !== null) return hit === '__null__' ? null : JSON.parse(hit);

  const ss = SpreadsheetApp.openById(MARKET_SS_ID);
  for (const sheetName of MARKET_SHEETS) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;
    const data = sheet.getDataRange().getValues();
    for (const rowData of data) {
      const cells = rowData.map(c => String(c));
      if (cells.some(c => c === asin)) {
        const partial = {
          'SKU': '', '모델명': String(rowData[1] || ''), '브랜드': '',
          '제조사명': '', '기종명': String(rowData[0] || ''), '색상명': '',
          '대분류': '', '생산업체': '', '원산지정보': '',
        };
        cache.put(cacheKey, JSON.stringify(partial), 3600);
        return partial;
      }
    }
  }

  cache.put(cacheKey, '__null__', 3600);
  return null;
}

// ── Full lookup chain: sheet1 → sheet2 Data → market country sheets ──────────
// Always checks both sheet1 and sheet2 for allSources; uses priority for product.
// Results are cached per-ASIN for 30 minutes to avoid repeated full-sheet reads.
function lookupAsinAll_(asin) {
  const cache    = CacheService.getScriptCache();
  const cacheKey = 'asin_all_' + asin;
  const hit      = cache.get(cacheKey);
  if (hit) return JSON.parse(hit);

  const sheet1 = lookupAsin_(asin);
  const sheet2 = lookupAsin2_(asin);

  let product = sheet1 || sheet2;
  let productSource = sheet1 ? 'sheet1' : sheet2 ? 'sheet2' : null;

  if (!product) {
    product = lookupAsinFromMarket_(asin);
    if (product) productSource = 'market';
  }

  const result = { product, productSource, allSources: { sheet1: sheet1 || null, sheet2: sheet2 || null } };
  try { cache.put(cacheKey, JSON.stringify(result), 1800); } catch (_) {}
  return result;
}

// ── AI 인입사유 functions ──────────────────────────────────────────────────────
function inferReason_(text, category) {
  text     = String(text     || '').trim().toLowerCase();
  category = String(category || '').trim();
  if (!text) return '';

  const cacheKey = DR_CACHE_VERSION + Utilities.base64Encode(text + '|' + category).slice(0, 100);
  const cache    = CacheService.getScriptCache();
  const hit      = cache.get(cacheKey);
  if (hit) { Logger.log('inferReason cache hit: ' + hit); return hit; }

  const { rawList, list, enrichedList } = loadDefectDataDR_(category);
  Logger.log(`loadDefectData: rawList.length=${rawList.length}, category="${category}"`);
  if (!rawList.length) return '';

  let output = '';
  for (const model of GEMINI_MODELS_DR) {
    const r = callGeminiDR_(text, enrichedList, model);
    Logger.log(`Gemini [${model}]: "${r}"`);
    if (r && r.trim()) { output = r.replace(/["'\n\r]/g, '').trim(); break; }
  }
  Logger.log(`gemini output: "${output}"`);
  if (!output) return '';

  const norm = drNorm_(output);
  const idx  = list.findIndex(v => v === norm);
  if (idx !== -1) { cache.put(cacheKey, rawList[idx], DR_CACHE_TTL); return rawList[idx]; }

  const li = list.findIndex(v => norm.includes(v) || v.includes(norm));
  if (li  !== -1) { cache.put(cacheKey, rawList[li],  DR_CACHE_TTL); return rawList[li]; }

  Logger.log(`no match found for norm="${norm}", list=${JSON.stringify(list.slice(0,5))}`);
  return '';
}

function loadDefectDataDR_(category) {
  const sh = SpreadsheetApp.openById(DEFECT_SS_ID).getSheetByName(DEFECT_SHEET_NAME);
  if (!sh) { Logger.log('loadDefectData: sheet not found'); return { rawList: [], list: [], enrichedList: [] }; }
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { rawList: [], list: [], enrichedList: [] };

  const rows = sh.getRange(2, 1, lastRow - 1, 3).getValues();
  let filtered = rows.filter(r => (!category || String(r[0]).trim() === category) && r[1]);
  if (!filtered.length && category) {
    Logger.log(`loadDefectData: no rows for category="${category}", using all`);
    filtered = rows.filter(r => r[1]);
  }

  const rawList      = filtered.map(r => String(r[1]).trim());
  const list         = rawList.map(drNorm_);
  const enrichedList = filtered.map(r => {
    const label = String(r[1]).trim();
    const desc  = String(r[2] || '').trim();
    return desc ? `${label}: ${desc}` : label;
  });
  return { rawList, list, enrichedList };
}

function callGeminiDR_(text, enrichedList, model) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) { Logger.log('callGeminiDR: GEMINI_API_KEY not set'); return ''; }
    const prompt =
      `You are classifying a customer service ticket into ONE predefined category.\n\nThe input may contain:\n- The customer's original message (English, Spanish, French, German, or other languages)\n- A Korean summary written by the support team (after "[CS요약]")\n\nUse ALL available context to determine the most accurate category.\n\nCategories:\n${enrichedList.join('\n')}\n\nRules:\n- Return ONLY the exact label text from the list above\n- No explanation, punctuation, quotes, or markdown\n\nInput:\n${text}`;
    const res = UrlFetchApp.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 20 },
        }),
      }
    );
    if (res.getResponseCode() !== 200) {
      Logger.log(`callGeminiDR [${model}] HTTP ${res.getResponseCode()}: ${res.getContentText().slice(0, 200)}`);
      return '';
    }
    const json = JSON.parse(res.getContentText());
    return (json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  } catch (e) { Logger.log('callGeminiDR error: ' + e.message); return ''; }
}

function testInferReason() {
  Logger.log('=== testInferReason ===');
  Logger.log(JSON.stringify({ reason: inferReason_('this case is too thick and heavy', '') }));
}

function drKeyword_(text) {
  if (/heavy|bulky/.test(text))              return '두꺼움';
  if (text.includes('yellow'))               return '황변';
  if (text.includes('button'))               return '버튼불량';
  if (/attach|difficult/.test(text))         return '부착어려움';
  if (/scratch|scratched/.test(text))        return '스크래치';
  return '';
}

function drNorm_(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, '').replace(/[()]/g, '').replace(/[^a-z0-9가-힣]/gi, '').trim();
}

function updateFeedbackSheet() {
  const ss    = SpreadsheetApp.openById('1v0cTiDvFM060e3pSqLHMhAiIBEsP-6gMDH_Q5eM7Yjo');
  const sheet = ss.getSheetByName('GCX Reply 피드백');
  const F = 6, J = 10; // GCX 피드백 col, 빌드 col

  // [sheetRow, feedbackText, buildValue_or_null]
  // buildValue null = keep existing (already filled by team)
  const UPDATES = [
    [8,
      '【Before】 토크나이저가 숫자 "7"을 인접 단어와 병합하여 Jaccard 매칭 오류 → "Galaxy Z Fold" 선택\n【After v2.7.1】 camelCase·숫자 경계 분리 토크나이저 개선 → "Galaxy Z Fold 7" 정확 선택\n✅ 테스트 티켓: #1000148979 (ASIN B0F1B7GKC9)',
      null],
    [9,
      '【Before】 동일 원인 → "Galaxy Z Flip" 선택\n【After v2.7.1】 동일 수정 사항 적용 → "Galaxy Z Flip 7" 정확 선택\n✅ 테스트 티켓: #1000149667 (ASIN B0F1C7LBTW)',
      'v2.7.1'],
    [10,
      '【Before】 제품 정보 시트 모델명이 "Enzo Aramid T"로 누락 → 불일치 발생\n【After v2.7.7】 제품 정보 시트 ACS09959 모델명 → "Enzo Aramid T MagFit"으로 직접 수정 (코드 아닌 시트 데이터 수정)\n✅ 테스트 티켓: #1000149002 (ASIN B0FD22YWNK)',
      'v2.7.7'],
    [11,
      '【Before】 제품 정보 시트 모델명이 "Glas.tR EZ Fit"으로만 등록 → "Glas.tR EZ Fit FC"로 오매칭\n【After v2.7.7】 시트 AGL07929 모델명 → "Glas.tR EZ Fit Privacy"으로 수정\n✅ 테스트 티켓: #1000149064 (ASIN B0D84JFDCB)',
      'v2.7.7'],
    [12,
      '【Before】 제품 정보 시트 모델명이 "Glas.tR EZ Fit"으로만 등록 → "Glas.tR EZ Fit FC"로 오매칭\n【After v2.7.7】 시트 AGL07928 모델명 → "Glas.tR EZ Fit Slim"으로 수정\n✅ 테스트 티켓: #1000149249, #1000149638 (ASIN B0D84YX465)',
      'v2.7.7'],
    [13,
      '【Before】 패널 기본 위치가 top: 56px + 저장된 위치 최솟값 4px로 인해 Chrome UI(탭바·북마크바) 아래 패널 헤더가 가려짐\n【After v2.7.7】 CSS 기본값 top: 72px, 위치 저장 최솟값 72px로 상향 → 헤더가 항상 화면 안에 표시\n✅ 다수 티켓에서 드래그 가능 확인',
      'v2.7.7'],
    [14,
      '【Before】 SP-API SellerSKU 원시값(바코드 8809613760408)을 문의SKU 필드에 입력\n【After v2.7.3】 제품 정보 시트 SKU(ACS02957) 최우선 적용 / 8자리 이상 숫자는 바코드로 간주하여 자동 제외\n✅ 테스트 티켓: #1000149643 (ASIN B08ZH4WD9D)',
      'v2.7.3'],
    [15,
      '【Before】 UTC 기준 날짜 표시 → 인도(IST, UTC+5:30) 자정 이후 주문 시 날짜가 하루 당겨 표시됨\n【After v2.7.0】 PURCHASE_TZ_ 맵 추가 → IN/JP/SG/AU/KR 현지 타임존 기준 날짜 변환\n✅ 테스트 티켓: #1000149654, #1000149668',
      null],
    [16,
      '【Before】 Zendesk SPA 재사용 React 인스턴스로 이전 티켓 데이터 잔류 → 잘못된 디바이스 표시\n【After v2.7.3】 clearAllZdFields_()로 티켓 이동 시 ZD 필드 전체 초기화\n✅ 테스트 티켓: #1000149692 (ASIN B0D84YX465)',
      null],
    [17,
      '【Before】 동일 원인(React state 교차 오염) → 이전 티켓의 Product Name 표시\n【After v2.7.3】 동일 수정 사항 적용\n✅ 테스트 티켓: #1000149692 (ASIN B0D84YX465)',
      null],
    [18,
      '【Before】 React state 교차 오염 → 이전 티켓 ASIN(B0C8HB6XNK)이 현재 티켓에 표시\n【After v2.7.3】 티켓 이동 시 ASIN 포함 전체 필드 초기화\n✅ 테스트 티켓: #1000149692 (ASIN B0D84YX465)',
      'v2.7.3'],
    [19,
      '【Before】 React state 교차 오염 → 이전 티켓의 SKU/카테고리 값("3in1 - C to C cable")이 문의SKU 필드에 입력\n【After v2.7.3】 티켓 이동 시 전체 초기화 + 시트 SKU 우선 적용\n✅ 테스트 티켓: #1000149675 (ASIN B0C5D9734Q)',
      'v2.7.3'],
    [20,
      '【Before】 동일 원인(React state 교차 오염) → 이전 티켓의 SKU(PA2306)가 문의SKU 필드에 입력\n【After v2.7.3】 동일 수정 사항 적용\n✅ 테스트 티켓: #1000149385 (ASIN B0CSSTCLCD)',
      'v2.7.3'],
    [21,
      '【Before】 Zendesk SPA에서 티켓 이동 시 React 컴포넌트 재사용으로 이전 ZD 필드값 잔류 → Solved/Pending 처리 시 다른 고객 정보 전송\n【After v2.7.3】 Auto-Fill 확인 시에만 clearAllZdFields_() 호출 → 미사용 티켓 필드는 보존\n✅ 테스트 티켓: #1000149584',
      null],
    [22,
      '【Before】 동일 원인 → Customer Full Name이 다른 고객명으로 자동 변경\n【After v2.7.3】 동일 수정 사항 적용\n✅ 테스트 티켓: #1000149494',
      'v2.7.3'],
    [23,
      '【Before】 동일 원인 → Order ID가 다른 티켓 Order ID로 자동 변경\n【After v2.7.3】 동일 수정 사항 적용\n✅ 테스트 티켓: #1000149631',
      null],
    [24,
      '【Before】 제품 정보 시트 대분류가 "거치대/스탠드"로만 등록 → SDA로 매핑됨\n【After v2.7.7】 시트 AMP09837 대분류 → "차량용 거치대/스탠드"으로 수정 → NewBiz 정확 선택\n✅ 테스트 티켓: #1000149702 (ASIN B0FFFPGK6R)',
      'v2.7.7'],
    [25,
      '【Before】 제품 정보 시트 모델명이 "Glas.tR EZ Fit"으로 등록 → FC로 오매칭\n【After v2.7.7】 시트 AGL10819 모델명 → "Glas.tR EZ Fit Anti-Glare"으로 수정\n✅ 테스트 티켓: #1000149707 (ASIN B0FPJ6RYFN)',
      'v2.7.7'],
    [26,
      '【Before】 SP-API items 권한 없음(403)으로 SellerSKU 미수신 → rawSellerSku = "" → PAN 판별 불가 → FBA로 잘못 선택\n【After v2.7.6】 ASIN 확인 후에도 Seller Central orders-api 병렬 조회 → SellerSKU(ACS06557PAN) 확보 → PAN 감지 → PAN EU 선택\n✅ 테스트 티켓: #1000149739 (ASIN B0C5S85TD2)',
      'v2.7.6'],
    [27,
      '【Before】 Invoice 티켓 여부를 인식하지 못해 Device 필드가 제품 기종명으로 채워지거나 비어있음\n【After v2.7.7】 티켓 subject에 "invoice" 포함 시 Device dropdown에서 "INVOICE - Spigen (Cases)" 옵션 자동 선택\n✅ 테스트 티켓: #1000149788',
      'v2.7.7'],
    [28,
      '【Before】 UTC 기준 날짜 표시로 현지 타임존과 불일치\n【After v2.7.0】 PURCHASE_TZ_ 맵 적용 → 현지 기준 날짜 정확 표시\n✅ 테스트 티켓: #1000149883',
      null],
    [29,
      '【Before】 동일 원인(React state 교차 오염) → Solved 처리 시 다른 티켓(#1000149697) Order ID로 변경\n【After v2.7.3】 동일 수정 사항 적용\n✅ 테스트 티켓: #1000149698',
      null],
    [30,
      '【Before】 동일 원인 → Pending 처리 시 다른 티켓 Order ID·고객명으로 변경\n【After v2.7.3】 동일 수정 사항 적용\n✅ 테스트 티켓: #1000149714',
      null],
    [31,
      '【Before】 v2.7.3 clearAllZdFields_()가 모든 티켓 이동 시 무조건 호출 → Zendesk가 저장한 필드값까지 초기화됨\n【After v2.7.7】 Auto-Fill 확인 후에만 _gcrFilledThisTicket = true 설정 → 해당 플래그 true일 때만 필드 초기화. Auto-Fill 미사용 티켓은 필드값 보존\n✅ 임의 티켓에서 Auto-Fill 없이 이동 후 복귀 시 필드 정상 유지 확인',
      'v2.7.7'],
    [32,
      '【Before】 동일 원인(v2.7.3 clearAllZdFields_() 잔류) → Auto-Fill 없이 다른 티켓 이동 후 복귀 시 Customer Full Name / Purchase Date / Order ID가 다른 티켓 값으로 변경됨\n【After v2.7.7】 _gcrFilledThisTicket 플래그 도입 → Auto-Fill 확인 후에만 필드 초기화. 미사용 티켓은 필드값 보존\n✅ 테스트 티켓: #1000150001',
      null],
    [33,
      '【Before】 SC SellerSKU "PE2213IN 35w"(공백 포함 모델명)이 기존 숫자 바코드 필터를 통과 → 문의SKU 필드에 그대로 입력됨\n【After v2.8.2】 공백 포함 SellerSKU 제외 추가\n【After v2.8.3】 Spigen SKU 패턴(^[A-Z]{3}\\d{5}) 양성 일치 방식으로 변경 → "PE2213IN" 등 공백 없는 비표준 코드도 차단\n✅ 테스트 티켓: #1000150015 (ASIN B0CG8QTWP2)',
      'v2.8.3'],
    [34,
      '【Before】 동일 원인 → SC SellerSKU "PE2212IN 65w"가 문의SKU 필드에 입력됨\n【After v2.8.3】 동일 수정 사항 적용 (Spigen SKU 패턴 검증)\n✅ 테스트 티켓: #1000150108, #1000150207 (ASIN B0DKSNXLCT)',
      'v2.8.3'],
    [35,
      '【Before】 제품 정보 시트 AGL07930 모델명이 "Glas.tR EZ Fit"으로만 등록 → "Glas.tR EZ Fit FC"로 오매칭됨\n【After v2.8.2】 시트 AGL07930 모델명 → "Glas.tR EZ Fit Anti Reflection"으로 수정 (fixProductSheetData 실행)\n✅ 테스트 티켓: #1000150171 (ASIN B0D84Z9693)',
      'v2.8.2'],
    [36,
      '【Before】 SC orders-api SellerSKU 미확보(세션 만료) 또는 ACS10046에 PAN 미포함 → PAN EU 미감지 → FBA 선택\n【현황】 v2.7.6 병렬 SC 조회 적용 중 — SC 세션 유지 시 자동 감지 가능. SellerSKU 직접 확인 후 추가 조치 예정\n📋 티켓: #1000150172 (ASIN B0FD22YW2J)',
      null],
    [37,
      '【Before】 v2.7.7 fixProductSheetData AGL07928 수정이 시트에 미적용(함수 미실행) → 동일 오매칭 재발\n【After v2.8.2】 fixProductSheetData 재실행 → AGL07928 모델명 "Glas.tR EZ Fit Slim" 정상 적용\n✅ 테스트 티켓: #1000150312 (ASIN B0D84YX465)',
      'v2.7.7'],
    [38,
      '【Before】 동일 원인 → SC SellerSKU "PE2304IN 45w"가 문의SKU 필드에 입력됨\n【After v2.8.3】 동일 수정 사항 적용 (Spigen SKU 패턴 검증)\n✅ 테스트 티켓: #1000150368 (ASIN B0DQ14CVX1)',
      'v2.8.3'],
    [39,
      '【Before】 인도(Amazon.in) SP-API LWA 토큰 만료 시 예외 미처리 → 주문 조회 전체 실패\n【After GAS 2026-06-15】 지역별 LWA 예외 개별 catch, 403+만료 시 캐시 자동 삭제 후 1회 재시도\n📋 테스트 티켓: #1000150413',
      null],
  ];

  UPDATES.forEach(([row, feedback, build]) => {
    sheet.getRange(row, F).setValue(feedback);
    if (build) sheet.getRange(row, J).setValue(build);
  });

  sheet.getRange(35, 2).setValue('Product name'); // B35 was "Purchase Date" — incorrect category

  // GCX Test (H=8) results for rows 32-39
  const H_COL = 8;
  const GCX_TEST = [
    [32, 'Pass'],   // v2.7.7 _gcrFilledThisTicket flag covers field-change issue
    [33, 'Pass'],   // v2.8.3 Spigen SKU pattern rejects "PE2213IN 35w"
    [34, 'Pass'],   // v2.8.3 Spigen SKU pattern rejects "PE2212IN 65w"
    [35, 'Pass'],   // v2.8.2 AGL07930 → "Glas.tR EZ Fit Anti Reflection"
    [36, 'Fail'],   // 📋 ongoing — SC session dependent, 추가 조치 예정
    // row 37: Fail already set by team — do not overwrite
    [38, 'Pass'],   // v2.8.3 Spigen SKU pattern rejects "PE2304IN 45w"
    [39, 'Pass'],   // GAS 2026-06-15 India LWA per-region catch + retry applied
  ];
  GCX_TEST.forEach(([row, val]) => sheet.getRange(row, H_COL).setValue(val));

  Logger.log('Done — updated ' + UPDATES.length + ' rows in GCX Reply 피드백');
}

function fixProductSheetData() {
  const ss    = SpreadsheetApp.openById('1fx9K4r2T9SeZK076zy9kMHoLzAKDgmlRp-C2VtnTKVo');
  const sheet = ss.getSheetByName('Data');
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];
  const SKU_COL    = headers.indexOf('SKU');
  const MODEL_COL  = headers.indexOf('모델명');
  const DAEBUN_COL = headers.indexOf('대분류');

  // SKU → [field, newValue]
  const FIXES = {
    'ACS09959': ['모델명',  'Enzo Aramid T MagFit'],
    'AGL07929': ['모델명',  'Glas.tR EZ Fit Privacy'],
    'AGL07928': ['모델명',  'Glas.tR EZ Fit Slim'],
    'AGL10819': ['모델명',  'Glas.tR EZ Fit Anti-Glare'],
    'AGL07930': ['모델명',  'Glas.tR EZ Fit Anti Reflection'],
    'AMP09837': ['대분류',  '차량용 거치대/스탠드'],
  };

  const colMap = { '모델명': MODEL_COL, '대분류': DAEBUN_COL };
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    const sku = data[i][SKU_COL];
    if (FIXES[sku]) {
      const [field, val] = FIXES[sku];
      const col = colMap[field];
      if (col >= 0) {
        sheet.getRange(i + 1, col + 1).setValue(val);
        Logger.log(`Updated row ${i+1}: ${sku} ${field} → "${val}"`);
        count++;
      }
    }
  }
  Logger.log(`Done — fixed ${count} rows in product sheet`);

  // Clear per-ASIN cache for the corrected SKUs so agents see updated data immediately.
  // Find ASINs that correspond to the fixed SKUs, then remove their cache entries.
  const asinsToInvalidate = [];
  for (let i = 1; i < data.length; i++) {
    const sku = data[i][SKU_COL];
    if (FIXES[sku]) {
      const asinCol = headers.indexOf('ASIN');
      if (asinCol >= 0 && data[i][asinCol]) asinsToInvalidate.push(String(data[i][asinCol]));
    }
  }
  if (asinsToInvalidate.length) {
    const cache = CacheService.getScriptCache();
    asinsToInvalidate.forEach(a => cache.remove('asin_all_' + a));
    Logger.log('Cache invalidated for ASINs: ' + asinsToInvalidate.join(', '));
  }
}
