// GCX Reply — Apps Script Web App
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
        try { result.marketplaces = checkMarketplaces_(itemAsin); } catch { result.marketplaces = []; }
      }
    }

    if (asin) {
      const lu = lookupAsinAll_(asin);
      result.product = lu.product;
      result.productSource = lu.productSource;
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
  cache.put(cacheKey, d.access_token, Math.min(d.expires_in - 60, 240));
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
    restrictedResources: [{ method: 'GET', path: `/orders/v0/orders/${orderId}/items` }],
  });
  if (r.status !== 200) return { token: null, status: r.status, error: r.body };
  try {
    const t = JSON.parse(r.body).restrictedDataToken || null;
    return { token: t, status: r.status, error: null };
  } catch { return { token: null, status: r.status, error: r.body }; }
}

// ── Buyer order count (capped at 50) ─────────────────────────────────────────
function fetchBuyerOrders_(endpoint, region, cred, salesChannel, buyerEmail) {
  const mpId = marketplaceId_(salesChannel);
  if (!mpId || !buyerEmail) return null;
  const path = `/orders/v0/orders?MarketplaceIds=${encodeURIComponent(mpId)}&BuyerEmail=${encodeURIComponent(buyerEmail)}&MaxResultsPerPage=50`;
  const r = spApiGet_(endpoint, region, cred, path);
  if (r.status !== 200) return null;
  try {
    const d = JSON.parse(r.body);
    const orders  = d.payload?.Orders || [];
    const hasMore = !!d.payload?.NextToken;
    return hasMore ? 50 : orders.length;
  } catch { return null; }
}

// ── Fetch order + items + address + buyer ─────────────────────────────────────
function fetchOrderData_(orderId) {
  for (const { endpoint, region, cred } of REGIONS) {
    const r = spApiGet_(endpoint, region, cred, `/orders/v0/orders/${orderId}`);
    if (r.status !== 200) continue;

    const order  = JSON.parse(r.body).payload || {};
    if (!order.AmazonOrderId) continue; // 200 but error body (wrong region) — try next

    const rdtResult = getRdt_(endpoint, region, cred, orderId);
    const itemsR    = spApiGet_(endpoint, region, cred, `/orders/v0/orders/${orderId}/items`, rdtResult.token || undefined);
    const addrR  = spApiGet_(endpoint, region, cred, `/orders/v0/orders/${orderId}/address`);
    const buyerR = spApiGet_(endpoint, region, cred, `/orders/v0/orders/${orderId}/buyerInfo`);

    const buyer      = buyerR.status === 200 ? JSON.parse(buyerR.body).payload || {} : {};
    const orderCount = fetchBuyerOrders_(endpoint, region, cred, order.SalesChannel, buyer.BuyerEmail || null);

    return {
      order,
      items:       itemsR.status === 200 ? JSON.parse(itemsR.body).payload?.OrderItems || [] : [],
      itemsStatus: itemsR.status,
      itemsError:  itemsR.body,
      rdtStatus:   rdtResult.status,
      rdtError:    rdtResult.error,
      address:     addrR.status  === 200 ? JSON.parse(addrR.body).payload?.ShippingAddress || {} : {},
      buyer,
      orderCount,
      region,
    };
  }
  throw new Error('Order not found in any region');
}

// ── TEMP: clear LWA token cache ───────────────────────────────────────────────
function clearLwaCache() {
  CacheService.getScriptCache().removeAll(['lwa_main', 'lwa_jp', 'lwa_in']);
  Logger.log('LWA cache cleared');
}

// ── TEMP: update Spigen EU refresh token ──────────────────────────────────────
function updateEuToken() {
  PropertiesService.getScriptProperties().setProperty(
    'LWA_REFRESH_TOKEN',
    'Atzr|IwEBIGcgTUaxMvFbotDXS95u_s_WdPkYbpaxAnk-k2rDILGYcikUgLb368CRqPYzBhr3hz_SPcfsOU2SUqP3UMIL7vhOzTD7E2Nm0MYHDivTzY4hHFNIXIxbYLRTrQ3qfi6ftpLh5dX0zlC-u5hQqeEXS-oyC1s8VffzWx4NJO7_Nex-BbrXVSNDWnkly0_sCqfzqMpBQ1cNHxHugFxcB4PxRi206mIlo5kE4vQplx_IIS4Q7R-OGzgpD4GRGaNnyTFYsywJKGb0o1MqUAAFYFOFnJhWyE5XbhzUnYr1plIaNV8Sjyq0Y_yc9LIe6eRzyzmMR6AwvR1VuLlWTdJKCFpeog-Z'
  );
  Logger.log('LWA_REFRESH_TOKEN updated');
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
function lookupAsinAll_(asin) {
  let product = lookupAsin_(asin);
  if (product) return { product, productSource: 'sheet1' };

  product = lookupAsin2_(asin);
  if (product) return { product, productSource: 'sheet2' };

  product = lookupAsinFromMarket_(asin);
  if (product) return { product, productSource: 'market' };

  return { product: null, productSource: null };
}
