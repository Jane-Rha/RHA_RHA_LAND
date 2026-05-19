// GCX Reply — Apps Script Web App
// Endpoint: ?orderId=XXX  |  ?asin=XXX  |  ?orderId=XXX&asin=XXX
// Deploy as: Execute as Me, Access: Anyone (or Anyone anonymous)
// Script Properties required: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
//   LWA_CLIENT_ID, LWA_CLIENT_SECRET, LWA_REFRESH_TOKEN,
//   LWA_CLIENT_ID_JP, LWA_CLIENT_SECRET_JP, LWA_REFRESH_TOKEN_JP

const SHEET_ID    = '1fx9K4r2T9SeZK076zy9kMHoLzAKDgmlRp-C2VtnTKVo';
const SHEET_NAME  = 'Data';
const PRODUCT_COLS = ['SKU','모델명','브랜드','제조사명','기종명','색상명','대분류','생산업체','원산지정보'];

const REGIONS = [
  { endpoint: 'https://sellingpartnerapi-eu.amazon.com', region: 'eu-west-1', cred: 'main' },
  { endpoint: 'https://sellingpartnerapi-fe.amazon.com', region: 'us-west-2', cred: 'jp'   },
  { endpoint: 'https://sellingpartnerapi-na.amazon.com', region: 'us-east-1', cred: 'main' },
];

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
      if (itemAsin) result.product = lookupAsin_(itemAsin);
    }

    if (asin) {
      result.product = lookupAsin_(asin);
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
  const sfx    = cred === 'jp' ? '_JP' : '';
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

function spApiGet_(endpoint, region, cred, path) {
  const props     = PropertiesService.getScriptProperties().getProperties();
  const accessKey = props['AWS_ACCESS_KEY_ID'];
  const secretKey = props['AWS_SECRET_ACCESS_KEY'];
  const token     = getLwaToken_(cred);
  const host      = endpoint.replace('https://', '');

  const now       = new Date();
  const amzDate   = Utilities.formatDate(now, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  const dateStamp = Utilities.formatDate(now, 'UTC', 'yyyyMMdd');

  const hdrs = { 'host': host, 'x-amz-access-token': token, 'x-amz-date': amzDate };
  const keys = Object.keys(hdrs).sort();
  const canonHdrs  = keys.map(k => k + ':' + hdrs[k]).join('\n') + '\n';
  const signedHdrs = keys.join(';');

  const canonReq = ['GET', path, '', canonHdrs, signedHdrs, sha256Hex_('')].join('\n');
  const scope    = `${dateStamp}/${region}/execute-api/aws4_request`;
  const sts      = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex_(canonReq)].join('\n');
  const sig      = hmacHex_(signingKey_(secretKey, dateStamp, region), sts);
  const auth     = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHdrs}, Signature=${sig}`;

  const res = UrlFetchApp.fetch(endpoint + path, {
    method:             'get',
    headers:            { ...hdrs, 'Authorization': auth },
    muteHttpExceptions: true,
  });
  return { status: res.getResponseCode(), body: res.getContentText() };
}

// ── Fetch order + address + buyer ─────────────────────────────────────────────
function fetchOrderData_(orderId) {
  for (const { endpoint, region, cred } of REGIONS) {
    const r = spApiGet_(endpoint, region, cred, `/orders/v0/orders/${orderId}`);
    if (r.status !== 200) continue;

    const order  = JSON.parse(r.body).payload || {};
    const itemsR = spApiGet_(endpoint, region, cred, `/orders/v0/orders/${orderId}/items`);
    const addrR  = spApiGet_(endpoint, region, cred, `/orders/v0/orders/${orderId}/address`);
    const buyerR = spApiGet_(endpoint, region, cred, `/orders/v0/orders/${orderId}/buyerInfo`);

    return {
      order,
      items:   itemsR.status === 200 ? JSON.parse(itemsR.body).payload?.OrderItems || [] : [],
      address: addrR.status  === 200 ? JSON.parse(addrR.body).payload?.ShippingAddress || {} : {},
      buyer:   buyerR.status === 200 ? JSON.parse(buyerR.body).payload || {} : {},
      region,
    };
  }
  throw new Error('Order not found in any region');
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
