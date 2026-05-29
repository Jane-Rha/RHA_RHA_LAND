// ==UserScript==
// @name         GCX Reply
// @namespace    https://spigen.com/gcx
// @version      1.9.16
// @description  Amazon order data via GAS web app + Spigen product info + Zendesk auto-fill
// @author       Spigen GCX
// @updateURL    https://raw.githubusercontent.com/codingintheusa0402/spigen-gcx-automation/main/tampermonkey_scripts/GCX%20Reply.user.js
// @downloadURL  https://raw.githubusercontent.com/codingintheusa0402/spigen-gcx-automation/main/tampermonkey_scripts/GCX%20Reply.user.js
// @match        https://spigenhelp.zendesk.com/agent/tickets/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @run-at       document-idle
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  const GAS_URL    = 'https://script.google.com/macros/s/AKfycbw2Vdwk197LXB6oUAzuHS8sKamD5uqKZJDLvcHzbftWJk-M65XV1fAnTqiZo7ZEm4hk/exec';
  const SHEET_URL  = 'https://docs.google.com/spreadsheets/d/1fx9K4r2T9SeZK076zy9kMHoLzAKDgmlRp-C2VtnTKVo/edit?gid=0#gid=0';
  const ORDER_RE   = /\b(\d{3}-\d{7}-\d{7})\b/g;
  const ASIN_RE    = /\b(B[A-Z0-9]{9})\b/g;
  const PANEL_ID   = 'sp-order-panel';
  const SHEET_COLS = ['SKU', '모델명', '브랜드', '제조사명', '기종명', '색상명', '대분류', '생산업체', '원산지정보'];

  // ── Zendesk custom field IDs ─────────────────────────────────────────────
  const ZD = {
    ORDER_ID:      360021934132,
    ASIN:          360021934312,
    SKU:           900008676703,
    CUST_NAME:     360021999951,
    ORDER_STATUS:  360021934152,
    ORDER_TOTAL:   360021934172,
    DELIVERY_LVL:  900003828503,
    PURCHASE_DATE: 360019586172,
    COUNTRY:       4513936822297,
    FULFILLMENT:   900002781823,
    POINT_OF_PUR:  20016270875033,
    DEVICE:        360022185671,
    PRODUCT_NAME:  360022185891,
    BRAND_DETAIL:  5495572594201,
    PHOTO_EXIST:   26936618247577,
    TOTAL_ORDERS:  21714421937305,
    TOTAL_REFUNDS: 21745453864345,
    SPIGEN_REFUND: 21745465897369,
  };

  const COUNTRY_MAP = {
    US:'us', GB:'uk', DE:'de', FR:'fr', IT:'it', ES:'es', JP:'jp',
    NL:'nl', SE:'se', IE:'ie', PL:'pl', TR:'tr', BE:'be', IN:'in',
    SG:'sg', AU:'au', CA:'ca', MX:'mx', KR:'kr',
  };

  const FULFILLMENT_MAP = { AFN: 'fba', MFN: 'merchant__fbm_' };

  // ── Module state ─────────────────────────────────────────────────────────
  let lastOrderData   = null;
  let lastProductData = null;

  // ── Zendesk API: read order ID + ASIN from ticket custom fields ──────────
  function getTicketFields(cb) {
    const m = location.pathname.match(/\/tickets\/(\d+)/);
    if (!m) return cb(null, null, []);
    GM_xmlhttpRequest({
      method: 'GET',
      url: `https://spigenhelp.zendesk.com/api/v2/tickets/${m[1]}.json`,
      onload(res) {
        if (res.status !== 200) return cb(null, null, []);
        try {
          const ticket  = JSON.parse(res.responseText).ticket || {};
          const fields  = ticket.custom_fields || [];
          const vals    = fields.map(f => String(f.value || ''));
          const orderId = vals.find(v => /^\d{3}-\d{7}-\d{7}$/.test(v)) || null;
          const asin    = vals.find(v => /^B[A-Z0-9]{9}$/.test(v)) || null;
          // Also scan the customer message body for order IDs
          const desc    = ticket.description || '';
          const bodyIds = [...new Set([...desc.matchAll(/\b(\d{3}-\d{7}-\d{7})\b/g)].map(x => x[1]))];
          cb(orderId, asin, bodyIds);
        } catch { cb(null, null, []); }
      },
      onerror() { cb(null, null, []); },
    });
  }

  // ── Auto-fill helpers ────────────────────────────────────────────────────

  function salesChannelToPOP(ch) {
    if (!ch) return null;
    const s = ch.toLowerCase();
    if (s.includes('.co.uk'))  return 'amazon_united_kingdom';
    if (s.includes('.co.jp'))  return 'amazon_japan';
    if (s.includes('.com.sg')) return 'amazon_singapore';
    if (s.includes('.in'))     return 'amazon_india';
    if (s.includes('.de') || s.includes('.fr') || s.includes('.it') ||
        s.includes('.es') || s.includes('.nl')) return 'amazon_eu';
    return 'others';
  }

  const COUNTRY_SC = {
    DE:'amazon.de', FR:'amazon.fr', IT:'amazon.it', ES:'amazon.es',
    NL:'amazon.nl', PL:'amazon.pl', SE:'amazon.se', BE:'amazon.be',
    GB:'amazon.co.uk', JP:'amazon.co.jp', IN:'amazon.in',
    SG:'amazon.com.sg', AU:'amazon.com.au', CA:'amazon.ca',
    MX:'amazon.com.mx', TR:'amazon.com.tr', US:'amazon.com',
  };

  function sellerCentralUrl(orderId, salesChannel, countryCode) {
    if (!orderId) return null;
    const domain = salesChannel ? salesChannel.toLowerCase()
      : (countryCode ? (COUNTRY_SC[countryCode] || null) : null);
    return domain ? `https://sellercentral.${domain}/orders-v3/order/${orderId}` : null;
  }

  // Derive amazon.XX domain from order SalesChannel / CountryCode
  function amazonDomain_(salesChannel, countryCode) {
    if (salesChannel) return salesChannel.toLowerCase(); // "amazon.in", "amazon.co.jp", etc.
    return countryCode ? (COUNTRY_SC[countryCode] || 'amazon.com') : 'amazon.com';
  }

  // Try to extract Spigen model name from product title
  // "Spigen Liquid Air | iPhone 15 Case"   → "Liquid Air"
  // "Spigen Case for iPhone 15 Liquid Air Case..." → "Liquid Air"
  function modelFromTitle_(title) {
    if (!title) return '';
    // Pattern 1: "Brand Model | Device ..." — model between brand and pipe
    const pipeMatch = title.match(/^[A-Za-z]+\s+(.+?)\s+[|｜]/);
    if (pipeMatch && !/^(case|cover|protector|glass|film)/i.test(pipeMatch[1]))
      return pipeMatch[1].trim();
    // Pattern 2: strip "Spigen (Case|Cover) for" prefix, then strip device name, grab until next Case/Cover
    const noBrand = title.replace(/^[A-Za-z]+\s+/i, '').replace(/^(?:Case|Cover)\s+for\s+/i, '');
    const devStrip = noBrand.replace(
      /^(?:for\s+)?(?:iPhone|Samsung(?:\s+Galaxy)?|Galaxy|Google\s+Pixel|Pixel|iPad|Huawei|Xiaomi|OnePlus|LG)\s+[\w\s]*?(?=\b[A-Z][a-z])/,
      ''
    );
    const modelMatch = devStrip.match(/^([A-Z][^\|]+?)\s+(?:Case|Cover|Protector|Glass|Film|Screen)\b/i);
    if (modelMatch) return modelMatch[1].trim();
    return '';
  }

  // Parse Amazon product page static HTML → sheet-column-shaped object.
  // Handles both tech-spec table (amazon.in/com) and po-* overview rows (amazon.de etc.)
  function parseAmazonPage_(doc) {
    const spec = {};

    // Tech spec table — amazon.com, amazon.in, amazon.co.jp (with ?language=en_GB)
    doc.querySelectorAll(
      '#productDetails_techSpec_section_1 tr, #productDetails_db_sections tr, .prodDetTable tr'
    ).forEach(tr => {
      const k = tr.querySelector('th')?.textContent?.trim();
      const v = tr.querySelector('td')?.textContent?.replace(/\s+/g, ' ').trim();
      if (k && v) spec[k] = v;
    });

    // Product overview rows — amazon.de, amazon.fr, etc. (after ?language=en_GB → English keys)
    doc.querySelectorAll('tr[class*="po-"]').forEach(row => {
      const k = row.querySelector('.a-span3 span, td:first-child span')?.textContent?.trim();
      const v = row.querySelector('.a-span9 span, td:last-child span')?.textContent?.trim();
      if (k && v) spec[k] = v;
    });

    const title = doc.querySelector('#productTitle')?.textContent?.trim() || '';
    const mfr   = (spec['Manufacturer'] || '').split('/')[0].replace(/,.*$/, '').trim();

    return {
      SKU:      spec['Model Number']                                              || '',
      '모델명':  spec['Model Name']  || modelFromTitle_(title)                   || '',
      '브랜드':  spec['Brand Name']  || spec['Brand']                            || 'Spigen',
      '제조사명': mfr,
      '기종명':  spec['Compatible Phone Models'] || spec['Compatible phone models'] ||
                 spec['Compatible Devices']      || spec['Compatible devices']      || '',
      '색상명':  spec['Colour'] || spec['Color']                                 || '',
      '대분류':  spec['Form Factor'] || spec['Item Type Name']                   || '',
      '생산업체': mfr,
      '원산지정보': spec['Country of Origin'] || spec['Country of origin']       || '',
    };
  }

  // Fetch amazon.XX/dp/{asin} HTML and parse product info; cb(product|null, pageUrl)
  // Falls back through: order's marketplace → amazon.co.jp → amazon.com
  function fetchAmazonProduct_(asin, cb) {
    const primaryDomain = amazonDomain_(lastOrderData?.order?.SalesChannel, lastOrderData?.address?.CountryCode);
    const primaryUrl    = `https://www.${primaryDomain}/dp/${asin}`;

    const fallbacks = [primaryDomain];
    if (!fallbacks.includes('amazon.co.jp')) fallbacks.push('amazon.co.jp');
    if (!fallbacks.includes('amazon.com'))   fallbacks.push('amazon.com');

    function tryDomain(idx) {
      if (idx >= fallbacks.length) return cb(null, primaryUrl);
      const domain    = fallbacks[idx];
      const langParam = domain === 'amazon.com' ? '' : '?language=en_GB';
      const url       = `https://www.${domain}/dp/${asin}${langParam}`;
      GM_xmlhttpRequest({
        method:   'GET',
        url,
        headers:  { 'Accept-Language': 'en-GB,en;q=0.9', 'Accept': 'text/html' },
        redirect: 'follow',
        timeout:  20000,
        onload(res) {
          if (res.status !== 200) return tryDomain(idx + 1);
          try {
            const doc     = new DOMParser().parseFromString(res.responseText, 'text/html');
            const product = parseAmazonPage_(doc);
            if (Object.values(product).some(v => v)) return cb(product, url);
            tryDomain(idx + 1);
          } catch { tryDomain(idx + 1); }
        },
        onerror()   { tryDomain(idx + 1); },
        ontimeout() { tryDomain(idx + 1); },
      });
    }

    tryDomain(0);
  }

  // Normalize label text: strip ★ * ( ) . and trim, lowercase
  function normLabel(s) {
    return s.replace(/[^가-힣a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // Fill a Zendesk React-controlled text/date input by label text
  function fillZdInput(labelText, value) {
    if (!value) return false;
    const needle = normLabel(labelText);
    for (const input of document.querySelectorAll(
      '[data-test-id="ticket-fields-text-field"], [data-test-id="ticket-fields-date-field"]'
    )) {
      let node = input.parentElement;
      for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
        const lbl = node.querySelector('label');
        if (lbl && normLabel(lbl.textContent).startsWith(needle)) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
      }
    }
    return false;
  }

  // Fetch Zendesk field options (for Device / Product Name matching)
  function fetchZdFieldOpts(fieldId, cb) {
    GM_xmlhttpRequest({
      method: 'GET',
      url: `https://spigenhelp.zendesk.com/api/v2/ticket_fields/${fieldId}.json`,
      onload(res) {
        try { cb(JSON.parse(res.responseText).ticket_field?.custom_field_options || []); }
        catch { cb([]); }
      },
      onerror() { cb([]); },
    });
  }

  // Tokenize: split camelCase, lowercase, strip dots and special chars, split on whitespace.
  // camelCase split ensures "MagFit" and "Mag Fit" produce identical tokens.
  function tokenize_(s) {
    return s.replace(/([a-z])([A-Z])/g, '$1 $2')
            .toLowerCase().replace(/\./g, '').replace(/[^a-z0-9가-힣]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  }

  // Jaccard similarity between two token arrays (set-based)
  function jaccard_(a, b) {
    const sa = new Set(a), sb = new Set(b);
    let inter = 0;
    for (const t of sa) if (sb.has(t)) inter++;
    const union = sa.size + sb.size - inter;
    return union ? inter / union : 0;
  }

  // Find the best-matching Product Name dropdown option.
  // Strips brand/category prefix before "_" (SP_, CYRILL_, (New Biz)_) before scoring.
  function bestMatchOptVal(opts, label, stripPrefix) {
    if (!label || !opts.length) return null;
    const labelToks = tokenize_(label);
    let bestVal = null, bestScore = 0;
    for (const o of opts) {
      const name  = stripPrefix ? o.name.replace(/^[^_]+_/, '') : o.name;
      const score = jaccard_(tokenize_(name), labelToks);
      if (score > bestScore) { bestScore = score; bestVal = o.value; }
    }
    return bestScore >= 0.25 ? bestVal : null;
  }

  // Find the best-matching Device dropdown option.
  // Handles "/" in 기종명 (e.g. "Series 11/10(42mm)") by treating "/" as a space so all
  // tokens are preserved. Among equally-scoring candidates, prefers the latest model
  // (highest leading version number). If the ticket text explicitly mentions one of the
  // candidates, that takes priority over the "latest" default.
  function bestDeviceOptVal(opts, label, ticketText) {
    if (!label || !opts.length) return null;
    const labelToks = tokenize_(label.replace(/\//g, ' '));
    let maxScore = 0;
    const scored = opts.map(o => {
      const score = jaccard_(tokenize_(o.name), labelToks);
      if (score > maxScore) maxScore = score;
      return { val: o.value, name: o.name, score };
    });
    if (maxScore < 0.25) return null;

    // Candidates within 95% of best score
    const top = scored.filter(c => c.score >= maxScore * 0.95);
    if (top.length === 1) return top[0].val;

    // If ticket text explicitly names one candidate (without size suffix), prefer it
    if (ticketText) {
      const t = ticketText.toLowerCase();
      const mentioned = top.filter(c => {
        const base = c.name.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim();
        return base.length > 4 && t.includes(base);
      });
      if (mentioned.length === 1) return mentioned[0].val;
    }

    // Default: prefer highest leading version number (= most recent model)
    top.sort((a, b) => {
      const aVer = parseInt((a.name.match(/\d+/) || ['0'])[0]);
      const bVer = parseInt((b.name.match(/\d+/) || ['0'])[0]);
      return bVer - aVer;
    });
    return top[0].val;
  }

  // Map 대분류 value → Brand(상세) tagger tag, SP/CASE first
  function brandFromDaebunryu(d) {
    if (!d) return null;
    if (d.includes('보호필름'))                  return 'spigen_sp_';
    if (d === '휴대폰케이스')                    return 'spigen_case_';
    if (d.includes('차량'))                     return 'spigen_new_biz_';
    if (/래저|음향|워치|주변기기|거치대/.test(d)) return 'spigen_sda_';
    return null;
  }

  // Fetch ticket comments; cb(true) if any customer comment has image/video attachment
  function fetchTicketComments(ticketId, cb) {
    GM_xmlhttpRequest({
      method: 'GET',
      url: `https://spigenhelp.zendesk.com/api/v2/tickets/${ticketId}/comments.json?include=users`,
      onload(res) {
        if (res.status !== 200) return cb(false);
        try {
          const data     = JSON.parse(res.responseText);
          const comments = data.comments || [];
          const users    = data.users    || [];
          const agentIds = new Set(users.filter(u => u.role !== 'end-user').map(u => u.id));
          const hasPhoto = comments.some(c =>
            !agentIds.has(c.author_id) &&
            (c.attachments || []).some(a => /^(image|video)\//.test(a.content_type))
          );
          cb(hasPhoto);
        } catch { cb(false); }
      },
      onerror() { cb(false); },
    });
  }

  // ── Auto-fill status helpers ─────────────────────────────────────────────

  function setFillStatus(panel, msg) {
    const el = panel?.querySelector('#sp-fill-status');
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? 'inline' : 'none';
  }

  function maybeShowAutoFill(panel) {
    const bar = panel?.querySelector('#sp-autofill-bar');
    if (bar && lastOrderData) bar.style.display = 'block';
  }

  // ── Auto-fill: PUT all fields to Zendesk API, fill text fields in DOM ────

  function autoFillTicket(panel) {
    const ticketId = location.pathname.match(/\/tickets\/(\d+)/)?.[1];
    if (!ticketId || !lastOrderData) return;

    const btn = panel.querySelector('#sp-autofill-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Filling…'; }
    setFillStatus(panel, '');

    const o  = lastOrderData.order   || {};
    const ad = lastOrderData.address || {};
    const b  = lastOrderData.buyer   || {};
    const p  = lastProductData || {};

    const orderId   = panel.querySelector('#sp-order-input')?.value.trim() || '';
    const panelAsin = panel.querySelector('#sp-asin-input')?.value.trim()  || '';
    // ASIN: prefer order item ASINs, fall back to panel input
    const itemAsins  = (lastOrderData.items || []).map(i => i.ASIN).filter(Boolean);
    const asinValue  = itemAsins.length ? itemAsins.join(', ') : panelAsin;
    // SKU: prefer order items SellerSKU, fall back to product sheet
    const itemSku    = lastOrderData.items?.[0]?.SellerSKU || p.SKU || '';
    // Order count → ✅전체 주문 dropdown
    const orderCount    = lastOrderData.orderCount;
    const orderCountVal = orderCount != null ? `q${Math.min(orderCount, 50)}` : null;
    const buyerName    = b.BuyerName || o.BuyerInfo?.BuyerName || ad.Name || '';
    const orderTotal   = o.OrderTotal ? `${o.OrderTotal.Amount} ${o.OrderTotal.CurrencyCode}` : '';
    const purchaseDateIso = o.PurchaseDate ? o.PurchaseDate.slice(0, 10) : '';
    const purchaseDateDom = purchaseDateIso
      ? new Date(purchaseDateIso + 'T00:00:00Z').toLocaleDateString('en-US',
          { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
      : '';

    // 1. DOM fill visible text fields immediately
    fillZdInput('Order ID',           orderId);
    fillZdInput('ASIN',               asinValue);
    fillZdInput('문의SKU',            itemSku);
    fillZdInput('Customer Full Name', buyerName);
    // Fill date and close the calendar popup that React opens on focus
    if (fillZdInput('Purchase Date', purchaseDateDom)) {
      setTimeout(() => document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      ), 150);
    }
    fillZdInput('Order Status',       o.OrderStatus   || '');
    fillZdInput('Order Total',        orderTotal);
    fillZdInput('Delivery Level',     o.ShipmentServiceLevelCategory || '');

    // 2. Build Zendesk API fields array
    const af = [];
    if (orderId)                             af.push({ id: ZD.ORDER_ID,      value: orderId });
    if (asinValue)                           af.push({ id: ZD.ASIN,          value: asinValue });
    if (itemSku)                             af.push({ id: ZD.SKU,           value: itemSku });
    if (orderCountVal)                       af.push({ id: ZD.TOTAL_ORDERS,  value: orderCountVal });
    if (buyerName)                           af.push({ id: ZD.CUST_NAME,     value: buyerName });
    if (o.OrderStatus)                       af.push({ id: ZD.ORDER_STATUS,  value: o.OrderStatus });
    if (orderTotal)                          af.push({ id: ZD.ORDER_TOTAL,   value: orderTotal });
    if (o.ShipmentServiceLevelCategory)      af.push({ id: ZD.DELIVERY_LVL, value: o.ShipmentServiceLevelCategory });
    if (purchaseDateIso)                     af.push({ id: ZD.PURCHASE_DATE, value: purchaseDateIso });
    if (COUNTRY_MAP[ad.CountryCode])         af.push({ id: ZD.COUNTRY,       value: COUNTRY_MAP[ad.CountryCode] });
    const pop = salesChannelToPOP(o.SalesChannel);
    if (pop)                                 af.push({ id: ZD.POINT_OF_PUR,  value: pop });

    // 3. Brand(상세) from 대분류 — sync, push before async ops
    const brandTag = brandFromDaebunryu(p['대분류'] || '');
    if (brandTag) af.push({ id: ZD.BRAND_DETAIL, value: brandTag });

    // 4. Async: Device + Product Name + Fulfillment + comments (photo check) → then PUT
    const deviceLabel      = p['기종명'] || '';
    const productLabel     = p['모델명']  || '';
    const ticketText       = document.body.innerText || '';
    const skuHasPan        = /pan/i.test(itemSku);
    const fulfillChannel   = o.FulfillmentChannel || '';

    let remain = (deviceLabel ? 1 : 0) + (productLabel ? 1 : 0) + 1 + 1; // +1 comments, +1 fulfillment
    function tryPut() { if (--remain <= 0) putZdTicket(ticketId, af, btn, panel); }

    if (deviceLabel)  fetchZdFieldOpts(ZD.DEVICE,       opts => { const v = bestDeviceOptVal(opts, deviceLabel, ticketText);  if (v) af.push({ id: ZD.DEVICE,       value: v }); tryPut(); });
    if (productLabel) fetchZdFieldOpts(ZD.PRODUCT_NAME, opts => { const v = bestMatchOptVal(opts, productLabel, true);         if (v) af.push({ id: ZD.PRODUCT_NAME, value: v }); tryPut(); });
    fetchZdFieldOpts(ZD.FULFILLMENT, opts => {
      let fv = null;
      if (skuHasPan) {
        const opt = opts.find(x => /pan\s*eu/i.test(x.name));
        if (opt) fv = opt.value;
      }
      if (!fv && fulfillChannel) {
        const keyword = fulfillChannel === 'AFN' ? 'fba' : fulfillChannel === 'MFN' ? 'merchant' : null;
        if (keyword) { const opt = opts.find(x => x.name.toLowerCase().startsWith(keyword)); if (opt) fv = opt.value; }
      }
      if (fv) af.push({ id: ZD.FULFILLMENT, value: fv });
      tryPut();
    });
    fetchTicketComments(ticketId, hasPhoto => {
      af.push({ id: ZD.PHOTO_EXIST, value: hasPhoto ? 'yes' : 'no' });
      tryPut();
    });
  }

  function putZdTicket(ticketId, af, btn, panel) {
    if (!af.length) {
      if (btn) { btn.disabled = false; btn.textContent = 'Auto-Fill Form'; }
      setFillStatus(panel, 'Nothing to fill.');
      return;
    }
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
    GM_xmlhttpRequest({
      method:  'PUT',
      url:     `https://spigenhelp.zendesk.com/api/v2/tickets/${ticketId}.json`,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      data:    JSON.stringify({ ticket: { custom_fields: af } }),
      onload(res) {
        if (btn) { btn.disabled = false; btn.textContent = 'Auto-Fill Form'; }
        setFillStatus(panel, res.status === 200 ? `✓ ${af.length} fields saved` : `⚠️ API error ${res.status}`);
      },
      onerror() {
        if (btn) { btn.disabled = false; btn.textContent = 'Auto-Fill Form'; }
        setFillStatus(panel, '⚠️ Network error');
      },
    });
  }

  // ── Product info renderer ────────────────────────────────────────────────

  function renderProductInfo(asin) {
    renderAllProducts([asin]);
  }

  function renderAllProducts(asins) {
    const container = document.getElementById('sp-product-result');
    if (!container) return;
    if (!asins.length) { container.innerHTML = ''; return; }
    container.innerHTML = `<div style="font-size:11px;color:#aaa;padding:4px 14px;">Loading product info…</div>`;

    let loaded = 0;
    const results = new Array(asins.length).fill(null);

    function done(idx) { if (++loaded === asins.length) finish(); }

    asins.forEach((asin, idx) => {
      GM_xmlhttpRequest({
        method:   'GET',
        url:      `${GAS_URL}?asin=${encodeURIComponent(asin)}`,
        redirect: 'follow',
        timeout:  30000,
        onload(res) {
          try {
            const data = JSON.parse(res.responseText);
            const mkts = data.marketplaces || [];
            if (data.product && data.productSource !== 'market') {
              // Full data from sheet1 or sheet2 — use directly
              results[idx] = { asin, product: data.product, source: data.productSource || 'sheet', marketplaces: mkts };
              done(idx);
            } else if (data.product && data.productSource === 'market') {
              // Partial from country sheet (기종명 col A, 모델명 col B) — merge with Amazon
              const partial = data.product;
              fetchAmazonProduct_(asin, (amazonProduct, amazonUrl) => {
                let merged = partial, src = 'market';
                if (amazonProduct) {
                  merged = Object.assign({}, amazonProduct);
                  if (partial['기종명']) merged['기종명'] = partial['기종명'];
                  if (partial['모델명']) merged['모델명'] = partial['모델명'];
                  src = 'market+amazon';
                }
                results[idx] = { asin, product: merged, source: src, sourceUrl: amazonUrl, marketplaces: mkts };
                done(idx);
              });
            } else {
              // Not in any sheet → fall back to Amazon product page
              fetchAmazonProduct_(asin, (amazonProduct, amazonUrl) => {
                results[idx] = {
                  asin,
                  product:      amazonProduct,
                  source:       amazonProduct ? 'amazon' : null,
                  sourceUrl:    amazonUrl,
                  marketplaces: mkts,
                  error:        amazonProduct ? null : `${asin} not found in any sheet or Amazon page.`,
                };
                done(idx);
              });
            }
          } catch (err) {
            results[idx] = { asin, product: null, source: null, marketplaces: [], error: 'Parse error: ' + err.message };
            done(idx);
          }
        },
        onerror() {
          results[idx] = { asin, product: null, source: null, error: 'Cannot reach GAS endpoint.' };
          done(idx);
        },
      });
    });

    function sourceBadge_(source, sourceUrl) {
      const MKTSS   = '172fDVw4tu-hgbpV5FShWj4_SAMxeB54-v5BUlVgJUoA';
      const sheet2Url = `https://docs.google.com/spreadsheets/d/${MKTSS}/edit?gid=583143689`;
      const b = (href, label, bg) =>
        `<a href="${esc(href || '#')}" target="_blank" rel="noopener"
          style="font-size:10px;font-weight:normal;background:${bg};color:#fff;
                 padding:1px 6px;border-radius:3px;margin-left:4px;text-decoration:none;">${label}</a>`;
      if (source === 'sheet' || source === 'sheet1') return b(SHEET_URL, 'Sheet', '#34a853');
      if (source === 'sheet2')                        return b(sheet2Url, 'Sheet', '#34a853');
      if (source === 'market')                        return b(sheet2Url, 'Mkt',   '#e67e22');
      if (source === 'market+amazon')                 return b(sheet2Url, 'Mkt', '#e67e22') + b(sourceUrl, 'Amazon', '#FF9900');
      if (source === 'amazon')                        return b(sourceUrl, 'Amazon', '#FF9900');
      return '';
    }

    function finish() {
      if (!container.isConnected) return;
      const valid = results.filter(r => r.product);
      // Prefer sheet data for auto-fill (sheet1 > sheet2 > market+amazon > amazon > market)
      lastProductData =
        valid.find(r => r.source === 'sheet' || r.source === 'sheet1' || r.source === 'sheet2')?.product ||
        valid.find(r => r.source === 'market+amazon')?.product ||
        valid[0]?.product || null;
      maybeShowAutoFill(document.getElementById(PANEL_ID));

      container.innerHTML = `<div style="padding:0 14px 8px;">${results.map(({ asin, product, source, sourceUrl, error, marketplaces }) => {
        if (!product) {
          const msg = error || `${esc(asin)} not found.`;
          return `<div style="font-size:11px;color:${error ? '#c00' : '#aaa'};padding:4px 0;">⚠️ ${esc(msg)}</div>`;
        }
        const label = asins.length > 1 ? esc(asin) : 'Product Info';
        return `
          <div class="sp-block" style="margin-top:0;">
            <div class="sp-block-title" style="border-top:1px solid #e9ebec;">
              ${label}${sourceBadge_(source, sourceUrl)}
              <span class="sp-chevron">▾</span>
            </div>
            <div class="sp-block-body">
              ${marketplacesRow_(marketplaces)}
              ${SHEET_COLS.map(col => row(col, product[col])).join('')}
            </div>
          </div>`;
      }).join('')}</div>`;

      container.querySelectorAll('.sp-block-title').forEach(t => {
        t.addEventListener('click', e => { e.stopPropagation(); t.closest('.sp-block').classList.toggle('collapsed'); });
      });
    }
  }

  // ── Styles ───────────────────────────────────────────────────────────────
  // GM_addStyle may be undefined if Chrome MV3 restricts Tampermonkey grants;
  // fall back to a plain <style> element so the UI still renders.
  function safeAddStyle_(css) {
    try { if (typeof GM_addStyle === 'function') { GM_addStyle(css); return; } } catch (_) {}
    try {
      const el = document.createElement('style');
      el.textContent = css;
      (document.head || document.documentElement || document.body).appendChild(el);
    } catch (_) {}
  }
  safeAddStyle_(`
    #sp-order-panel {
      position: fixed;
      right: 16px;
      top: 56px;
      width: 330px;
      background: #fff;
      border: 1px solid #d8dcde;
      border-radius: 6px;
      box-shadow: 0 4px 18px rgba(0,0,0,.16);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      font-size: 12.5px;
      color: #1f1f1f;
      z-index: 99999;
    }
    #sp-order-panel * { box-sizing: border-box; }

    #sp-panel-header {
      padding: 9px 12px;
      background: #f3f4f5;
      border-bottom: 1px solid #d8dcde;
      border-radius: 6px 6px 0 0;
      display: flex;
      align-items: center;
      gap: 7px;
      cursor: move;
      font-weight: 600;
      font-size: 13px;
      user-select: none;
    }
    #sp-panel-close {
      margin-left: auto;
      cursor: pointer;
      opacity: .5;
      font-size: 15px;
      line-height: 1;
      padding: 2px 5px;
      border-radius: 3px;
    }
    #sp-panel-close:hover { opacity: 1; background: #e3e5e7; }

    #sp-panel-body { padding: 10px 14px 8px; }

    #sp-id-bar {
      display: flex;
      gap: 6px;
      align-items: center;
      margin-bottom: 8px;
    }
    #sp-order-input {
      flex: 1;
      border: 1px solid #c8cacc;
      border-radius: 4px;
      padding: 5px 8px;
      font-size: 12px;
      font-family: monospace;
      outline: none;
    }
    #sp-order-input:focus { border-color: #5ba4cf; box-shadow: 0 0 0 2px rgba(91,164,207,.2); }
    #sp-asin-input {
      flex: 1;
      border: 1px solid #c8cacc;
      border-radius: 4px;
      padding: 5px 8px;
      font-size: 12px;
      font-family: monospace;
      outline: none;
    }
    #sp-asin-input:focus { border-color: #f0a500; box-shadow: 0 0 0 2px rgba(240,165,0,.2); }
    #sp-lookup-btn {
      background: #5ba4cf;
      color: #fff;
      border: none;
      border-radius: 4px;
      padding: 5px 10px;
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
    }
    #sp-lookup-btn:hover { background: #4a8fba; }
    #sp-product-btn {
      background: #f0a500;
      color: #fff;
      border: none;
      border-radius: 4px;
      padding: 5px 10px;
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
    }
    #sp-product-btn:hover { background: #d99200; }

    #sp-autofill-bar { margin-bottom: 8px; display: none; }
    #sp-autofill-btn {
      background: #27ae60;
      color: #fff;
      border: none;
      border-radius: 4px;
      padding: 5px 0;
      cursor: pointer;
      font-size: 12px;
      width: 100%;
    }
    #sp-autofill-btn:hover:not(:disabled) { background: #219a52; }
    #sp-autofill-btn:disabled { background: #a8d5b5; cursor: default; }
    #sp-fill-status {
      display: none;
      font-size: 11px;
      color: #27ae60;
      margin-top: 4px;
      text-align: center;
    }

    #sp-detected-ids { margin-bottom: 8px; display: flex; flex-wrap: wrap; gap: 4px; min-height: 0; }
    .sp-chip {
      background: #e8f4fc;
      border: 1px solid #5ba4cf;
      color: #1a6490;
      border-radius: 12px;
      padding: 2px 10px;
      font-size: 11.5px;
      cursor: pointer;
      font-family: monospace;
      user-select: none;
    }
    .sp-chip:hover { background: #c8e4f5; }

    #sp-status {
      text-align: center;
      padding: 14px 8px;
      color: #888;
      font-size: 12px;
    }

    .sp-block { margin-top: 4px; }
    .sp-block-title {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 0 4px;
      font-weight: 600;
      font-size: 12.5px;
      color: #2f3941;
      cursor: pointer;
      user-select: none;
      border-top: 1px solid #e9ebec;
    }
    .sp-block-title .sp-chevron { margin-left: auto; transition: transform .18s; color: #aaa; }
    .sp-block.collapsed .sp-block-title .sp-chevron { transform: rotate(-90deg); }
    .sp-block.collapsed .sp-block-body { display: none; }

    .sp-row {
      display: flex;
      align-items: flex-start;
      padding: 4px 0;
      gap: 6px;
    }
    .sp-row:nth-child(odd) {
      background: #f8f9fa;
      margin: 0 -14px;
      padding: 4px 14px;
    }
    .sp-label { color: #5ba4cf; min-width: 128px; flex-shrink: 0; font-size: 12px; }
    .sp-val   { color: #2f3941; font-weight: 500; word-break: break-all; font-size: 12px; }
    .sp-val.link { color: #5ba4cf; text-decoration: underline; cursor: pointer; }

    .sp-items-title {
      font-weight: 600;
      font-size: 11.5px;
      color: #666;
      padding: 6px 0 2px;
      border-top: 1px solid #eee;
      margin-top: 2px;
    }

    #sp-toggle-btn {
      position: fixed;
      right: 16px;
      top: 56px;
      background: #5ba4cf;
      color: #fff;
      border: none;
      border-radius: 20px;
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
      z-index: 99999;
      box-shadow: 0 2px 8px rgba(0,0,0,.2);
      display: none;
    }
    #sp-toggle-btn:hover { background: #4a8fba; }
  `);

  // ── Panel HTML ────────────────────────────────────────────────────────────
  function buildPanel() {
    const d = document.createElement('div');
    d.id = PANEL_ID;
    d.innerHTML = `
      <div id="sp-panel-header">
        <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
          <text x="3" y="38" font-size="38" font-family="Georgia,serif" font-style="italic" fill="#FF9900">a</text>
          <path d="M6 40 Q24 48 42 40" stroke="#FF9900" stroke-width="3" fill="none" stroke-linecap="round"/>
        </svg>
        GCX Reply
        <span id="sp-panel-close" title="Close">✕</span>
      </div>
      <div id="sp-panel-body">
        <div id="sp-id-bar">
          <input id="sp-order-input" type="text" placeholder="408-XXXXXXX-XXXXXXX" maxlength="19"/>
          <button id="sp-lookup-btn">Lookup</button>
        </div>
        <div id="sp-id-bar" style="margin-bottom:10px;">
          <input id="sp-asin-input" type="text" placeholder="ASIN (B0XXXXXXXXX)" maxlength="10"/>
          <button id="sp-product-btn">Product</button>
        </div>
        <div id="sp-detected-ids"></div>
        <div id="sp-autofill-bar">
          <button id="sp-autofill-btn">Auto-Fill Form</button>
          <div id="sp-fill-status"></div>
        </div>
        <div id="sp-result">
          <div id="sp-status">Scanning ticket for order IDs…</div>
        </div>
        <div id="sp-product-result"></div>
      </div>
    `;
    return d;
  }

  // ── Format helpers ────────────────────────────────────────────────────────
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('sv-SE', { timeZone: 'UTC' }).slice(0, 16).replace('T', ' ');
  }

  function fmtShipRange(earliest, latest) {
    if (!earliest) return '—';
    const fmt = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const e = fmt(earliest), l = latest ? fmt(latest) : '';
    return (!l || e === l) ? e : `${e} – ${l}`;
  }

  function row(label, value, isLink) {
    return `<div class="sp-row">
      <span class="sp-label">${esc(label)}</span>
      <span class="sp-val${isLink ? ' link' : ''}">${esc(value) || '—'}</span>
    </div>`;
  }

  function rowReturnAsin(asinStr, salesChannel, itemsStatus) {
    if (!asinStr || asinStr === '—') {
      const note = itemsStatus === 403
        ? `<span style="font-size:10.5px;color:#e67e22;margin-left:4px;">(GetOrderItems 권한 필요)</span>`
        : '';
      return `<div class="sp-row"><span class="sp-label">Return ASIN</span><span class="sp-val">—${note}</span></div>`;
    }
    const ch = (salesChannel || 'amazon.com').toLowerCase();
    const links = asinStr.split(',').map(a => a.trim()).filter(Boolean).map(asin => {
      const url = `https://www.${ch}/dp/${asin}`;
      return `<a href="${url}" target="_blank" rel="noopener" style="color:#5ba4cf;text-decoration:underline;">${esc(asin)}</a>`;
    }).join(', ');
    return `<div class="sp-row"><span class="sp-label">Return ASIN</span><span class="sp-val">${links}</span></div>`;
  }

  function rowLinked(label, text, url) {
    const cell = url
      ? `<a href="${url}" target="_blank" rel="noopener" style="color:#5ba4cf;text-decoration:underline;font-weight:500;">${esc(text)}</a>`
      : `<span class="sp-val">${esc(text) || '—'}</span>`;
    return `<div class="sp-row"><span class="sp-label">${esc(label)}</span>${cell}</div>`;
  }

  // Render selling-marketplace badges from market spreadsheet check
  function marketplacesRow_(mkts) {
    if (!mkts || !mkts.length) {
      return `<div class="sp-row"><span class="sp-label">판매 마켓</span><span class="sp-val" style="color:#aaa;">—</span></div>`;
    }
    const SS_ID  = '172fDVw4tu-hgbpV5FShWj4_SAMxeB54-v5BUlVgJUoA';
    const badges = mkts.map(m => {
      const name = typeof m === 'string' ? m : m.name;
      const gid  = typeof m === 'string' ? null : m.gid;
      const cell = typeof m === 'object' ? m.cell : null;
      let url = `https://docs.google.com/spreadsheets/d/${SS_ID}/edit`;
      if (gid != null) url += `#gid=${gid}`;
      if (cell)        url += `&range=${cell}`;
      return `<a href="${esc(url)}" target="_blank" rel="noopener"
        style="display:inline-block;background:#27ae60;color:#fff;font-size:10px;padding:1px 6px;border-radius:3px;margin-right:3px;margin-bottom:2px;text-decoration:none;">${esc(name)}</a>`;
    }).join('');
    return `<div class="sp-row"><span class="sp-label">판매 마켓</span><span class="sp-val">${badges}</span></div>`;
  }

  // ── Render order data ─────────────────────────────────────────────────────
  function renderOrder(data, orderId, panelAsin) {
    const o  = data.order   || {};
    const it = data.items   || [];
    const ad = data.address || {};
    const b  = data.buyer   || {};

    const itemAsins  = it.map(i => i.ASIN).filter(Boolean);
    const returnAsin = itemAsins.length ? itemAsins.join(', ') : (panelAsin || '—');
    const amount     = o.OrderTotal ? `${o.OrderTotal.Amount} ${o.OrderTotal.CurrencyCode}` : '—';
    const buyerName  = b.BuyerName || o.BuyerInfo?.BuyerName || ad.Name || '—';

    const addrParts = [ad.Name, ad.AddressLine1, ad.AddressLine2, ad.AddressLine3,
                       [ad.City, ad.StateOrRegion, ad.PostalCode].filter(Boolean).join(' '),
                       ad.CountryCode].filter(Boolean);

    const addrRows = addrParts.map(p =>
      `<div class="sp-row"><span class="sp-val">${esc(p)}</span></div>`
    ).join('');

    const itemRows = it.map(item => {
      const title = item.Title ? item.Title.slice(0, 44) + (item.Title.length > 44 ? '…' : '') : item.ASIN;
      return row(item.SellerSKU || item.ASIN, `${item.QuantityOrdered}×  ${title}`);
    }).join('');

    const orderCountNote = data.orderCount != null
      ? ` <span style="color:#888;font-size:11px;">(총 ${data.orderCount}건)</span>` : '';

    return `
      ${rowReturnAsin(returnAsin, o.SalesChannel, data.itemsStatus)}

      <div class="sp-block">
        <div class="sp-block-title">
          <svg width="16" height="16" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <text x="3" y="38" font-size="38" font-family="Georgia,serif" font-style="italic" fill="#FF9900">a</text>
            <path d="M6 40 Q24 47 42 40" stroke="#FF9900" stroke-width="3" fill="none" stroke-linecap="round"/>
          </svg>
          Order${orderCountNote}
          <span class="sp-chevron">▾</span>
        </div>
        <div class="sp-block-body">
          ${rowLinked('Amazon Order ID', orderId, sellerCentralUrl(orderId, o.SalesChannel, ad.CountryCode))}
          ${row('Order Status',     o.OrderStatus)}
          ${row('Purchase Date',    fmtDate(o.PurchaseDate))}
          ${row('Amount',           amount)}
          ${row('Delivery Level',   o.ShipmentServiceLevelCategory || o.ShipServiceLevelCategory)}
          ${row('Ship Date',        fmtShipRange(o.EarliestShipDate, o.LatestShipDate))}

          <div class="sp-block collapsed">
            <div class="sp-block-title" style="font-size:12px;">
              Shipping Address
              <span class="sp-chevron">▾</span>
            </div>
            <div class="sp-block-body">
              ${addrRows || '<div class="sp-row"><span class="sp-val">—</span></div>'}
            </div>
          </div>

          ${row('Fulfillment Channel', o.FulfillmentChannel)}
          ${row('Ship Service Level',  o.ShipServiceLevel)}
          ${row('Buyer Name',          buyerName)}

          ${it.length > 0 ? `<div class="sp-items-title">Items (${it.length})</div>${itemRows}` : ''}
        </div>
      </div>
    `;
  }

  // ── Seller Central orders-api fallback for ASIN + SKU ────────────────────
  // Uses the user's existing SC session cookies — no extra auth needed.
  // Tries marketplace-specific SC domain first, then sellercentral.amazon.com
  // (global SC) as fallback — Spigen accesses most markets via the global domain.
  function fetchScItems(orderId, salesChannel, countryCode, cb) {
    const scPageUrl = sellerCentralUrl(orderId, salesChannel, countryCode);
    const primaryUrl  = scPageUrl ? scPageUrl.replace('/orders-v3/order/', '/orders-api/order/') : null;
    const fallbackUrl = `https://sellercentral.amazon.com/orders-api/order/${orderId}`;

    function parseItems(responseText) {
      const d = JSON.parse(responseText);
      return (d.order?.orderItems || [])
        .map(it => ({ ASIN: it.ASIN, SellerSKU: it.SellerSKU, Title: it.Title, QuantityOrdered: it.QuantityOrdered }))
        .filter(it => it.ASIN);
    }

    function tryUrl(url, onFail) {
      GM_xmlhttpRequest({
        method:  'GET',
        url,
        headers: { 'Accept': 'application/json' },
        redirect: 'follow',
        timeout:  20000,
        onload(res) {
          if (res.status !== 200) return onFail();
          try {
            const items = parseItems(res.responseText);
            if (items.length) cb(items);
            else onFail();
          } catch { onFail(); }
        },
        onerror()   { onFail(); },
        ontimeout() { onFail(); },
      });
    }

    if (primaryUrl && primaryUrl !== fallbackUrl) {
      tryUrl(primaryUrl, () => tryUrl(fallbackUrl, () => cb(null)));
    } else {
      tryUrl(fallbackUrl, () => cb(null));
    }
  }

  // ── Fetch order via GAS ───────────────────────────────────────────────────
  function fetchOrder(orderId) {
    setStatus('⏳ Fetching order data…');
    GM_xmlhttpRequest({
      method:   'GET',
      url:      `${GAS_URL}?orderId=${encodeURIComponent(orderId)}`,
      redirect: 'follow',
      timeout:  30000,
      onload(res) {
        const result = document.getElementById('sp-result');
        if (!result) return;
        try {
          const data = JSON.parse(res.responseText);
          if (data.error) { setStatus('⚠️ ' + data.error); return; }

          // Store for auto-fill
          lastOrderData = data;
          maybeShowAutoFill(document.getElementById(PANEL_ID));

          const asinInput = document.getElementById('sp-asin-input');
          const itemAsins = (data.items || []).map(i => i.ASIN).filter(Boolean);

          // Resolve ASIN before rendering: SP-API items > current input > page scan
          let resolvedAsin = asinInput?.value.trim() || '';
          if (itemAsins.length) {
            if (asinInput && !asinInput.value) asinInput.value = itemAsins.join(', ');
            resolvedAsin = asinInput?.value.trim() || itemAsins[0] || '';
          } else if (!resolvedAsin) {
            const pageAsins = [...new Set([...document.body.innerText.matchAll(ASIN_RE)].map(m => m[1]))];
            const detected  = pageAsins[0];
            if (detected && asinInput) { asinInput.value = detected; resolvedAsin = detected; }
          }

          result.innerHTML = renderOrder(data, orderId, resolvedAsin);
          result.querySelectorAll('.sp-block-title').forEach(title => {
            title.addEventListener('click', e => {
              e.stopPropagation();
              title.closest('.sp-block').classList.toggle('collapsed');
            });
          });

          if (itemAsins.length) {
            renderAllProducts(itemAsins);
          } else if (resolvedAsin) {
            renderAllProducts([resolvedAsin]);
          } else if (data.itemsStatus !== 200) {
            // SP-API items blocked → query Seller Central orders-api silently with user's SC session
            const asinValEl = result.querySelector('.sp-row .sp-val');
            if (asinValEl) asinValEl.textContent = '🔍 Seller Central…';
            fetchScItems(orderId, data.order?.SalesChannel, data.address?.CountryCode, scItems => {
              if (!result.isConnected) return;
              if (scItems && scItems.length) {
                lastOrderData.items = scItems;
                const newAsins = scItems.map(i => i.ASIN).filter(Boolean);
                if (asinInput && !asinInput.value) asinInput.value = newAsins.join(', ');
                result.innerHTML = renderOrder(Object.assign({}, data, { items: scItems }), orderId, newAsins.join(', '));
                result.querySelectorAll('.sp-block-title').forEach(t => {
                  t.addEventListener('click', e => { e.stopPropagation(); t.closest('.sp-block').classList.toggle('collapsed'); });
                });
                renderAllProducts(newAsins);
                maybeShowAutoFill(document.getElementById(PANEL_ID));
              }
            });
          }
        } catch (err) {
          setStatus('⚠️ Parse error: ' + err.message);
        }
      },
      onerror()   { setStatus('⚠️ Cannot reach GAS endpoint — check GAS_URL in script settings.'); },
      ontimeout() { setStatus('⚠️ Request timed out.'); },
    });
  }

  function setStatus(msg) {
    const el = document.getElementById('sp-status');
    if (el) { el.textContent = msg; return; }
    const result = document.getElementById('sp-result');
    if (result) result.innerHTML = `<div id="sp-status">${esc(msg)}</div>`;
  }

  // ── Auto-detect order IDs from visible ticket text ─────────────────────
  function detectOrderIds() {
    const m = location.pathname.match(/\/tickets\/(\d+)/);
    const pane = (m && document.querySelector(`[data-test-id="ticket-${m[1]}-standard-layout"]`)) || document.body;
    const inputText = [...pane.querySelectorAll('input, textarea')].map(el => el.value || '').join('\n');
    const text = (pane.innerText || '') + '\n' + inputText;
    return [...new Set([...text.matchAll(ORDER_RE)].map(m => m[1]))];
  }

  function updateDetectedChips(panel, skipAutoLoad, extraIds = []) {
    const domIds = detectOrderIds();
    // API-sourced IDs (from ticket description) take priority; DOM scan fills the rest
    const ids = [...new Set([...extraIds, ...domIds])];
    const bar = panel.querySelector('#sp-detected-ids');
    if (!bar) return;

    const existingSet = new Set([...bar.querySelectorAll('.sp-chip')].map(c => c.dataset.id));
    if (ids.length === existingSet.size && ids.every(id => existingSet.has(id))) return;
    // Don't wipe chips when an order is already loaded / being fetched
    if (ids.length === 0 && existingSet.size > 0) return;

    bar.innerHTML = '';
    if (ids.length >= 2) {
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:11px;color:#888;width:100%;margin-bottom:3px;font-weight:500;';
      lbl.textContent   = `주문 ID ${ids.length}개 발견 — 선택하세요:`;
      bar.appendChild(lbl);
    }
    ids.forEach(id => {
      const chip = document.createElement('span');
      chip.className    = 'sp-chip';
      chip.textContent  = id;
      chip.dataset.id   = id;
      chip.title        = 'Click to look up this order';
      chip.onclick = () => {
        document.getElementById('sp-order-input').value = id;
        fetchOrder(id);
      };
      bar.appendChild(chip);
    });

    if (!skipAutoLoad) {
      if (ids.length === 1 && document.getElementById('sp-status')) {
        const input = panel.querySelector('#sp-order-input');
        if (!input.value) { input.value = ids[0]; fetchOrder(ids[0]); }
      } else if (ids.length === 0) {
        setStatus('No Amazon order ID found on this ticket. Paste one above.');
      } else {
        setStatus('');
      }
    }
  }

  // ── Draggable panel ───────────────────────────────────────────────────────
  function makeDraggable(panel, handle) {
    let offX = 0, offY = 0;
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      const rect = panel.getBoundingClientRect();
      offX = e.clientX - rect.left;
      offY = e.clientY - rect.top;
      const onMove = e2 => {
        panel.style.left  = (e2.clientX - offX) + 'px';
        panel.style.top   = (e2.clientY - offY) + 'px';
        panel.style.right = 'auto';
      };
      const onUp = () => {
        removeEventListener('mousemove', onMove);
        removeEventListener('mouseup', onUp);
      };
      addEventListener('mousemove', onMove);
      addEventListener('mouseup', onUp);
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    if (!location.pathname.match(/\/tickets\/\d+/)) return;
    if (document.getElementById(PANEL_ID)) return;

    let toggleBtn = document.getElementById('sp-toggle-btn');
    if (!toggleBtn) {
      toggleBtn = document.createElement('button');
      toggleBtn.id          = 'sp-toggle-btn';
      toggleBtn.textContent = 'Order Lookup';
      document.body.appendChild(toggleBtn);
    }

    const panel = buildPanel();
    document.body.appendChild(panel);

    makeDraggable(panel, panel.querySelector('#sp-panel-header'));

    panel.querySelector('#sp-panel-close').onclick = () => {
      panel.remove();
      toggleBtn.style.display = 'block';
    };
    toggleBtn.onclick = () => {
      toggleBtn.style.display = 'none';
      init();
    };

    const orderInput = panel.querySelector('#sp-order-input');
    const asinInput  = panel.querySelector('#sp-asin-input');

    panel.querySelector('#sp-lookup-btn').onclick = () => {
      const id = orderInput.value.trim();
      if (id) fetchOrder(id);
    };
    orderInput.addEventListener('keydown', e => { if (e.key === 'Enter') panel.querySelector('#sp-lookup-btn').click(); });

    panel.querySelector('#sp-product-btn').onclick = () => {
      const raw = asinInput.value.trim().toUpperCase();
      if (!raw) return;
      const asins = raw.split(',').map(a => a.trim()).filter(Boolean);
      renderAllProducts(asins);
    };
    asinInput.addEventListener('keydown', e => { if (e.key === 'Enter') panel.querySelector('#sp-product-btn').click(); });

    panel.querySelector('#sp-autofill-btn').onclick = () => autoFillTicket(panel);

    // ── Reset panel on ticket navigation ────────────────────────────────────
    function resetPanel() {
      orderInput.value = '';
      asinInput.value  = '';
      lastOrderData    = null;
      lastProductData  = null;
      const result = document.getElementById('sp-result');
      if (result) result.innerHTML = '<div id="sp-status">Scanning ticket for order IDs…</div>';
      const productResult = document.getElementById('sp-product-result');
      if (productResult) productResult.innerHTML = '';
      const chips = document.getElementById('sp-detected-ids');
      if (chips) chips.innerHTML = '';
      const autoBar = panel.querySelector('#sp-autofill-bar');
      if (autoBar) autoBar.style.display = 'none';
      setFillStatus(panel, '');
    }

    function autoDetectAll() {
      getTicketFields((orderId, asin, bodyIds) => {
        const orderInput = panel.querySelector('#sp-order-input');
        if (orderId && orderInput && !orderInput.value) {
          // Custom field has order ID → use it directly, chips are informational only
          orderInput.value = orderId;
          fetchOrder(orderId);
          updateDetectedChips(panel, true);
        } else {
          // No custom field order ID → merge message-body IDs with DOM scan
          // If exactly 1 total → auto-fetch; if multiple → show chips for user to pick
          updateDetectedChips(panel, false, bodyIds);
        }

        const detectedAsin = asin || [...new Set([...document.body.innerText.matchAll(ASIN_RE)].map(m => m[1]))][0];
        if (detectedAsin) {
          const ai = document.getElementById('sp-asin-input');
          if (ai && !ai.value) { ai.value = detectedAsin; renderProductInfo(detectedAsin); }
        }
      });
    }

    let lastTicketId = location.pathname.match(/\/tickets\/(\d+)/)?.[1];
    let navTimer = null;
    function onNav() {
      const newId = location.pathname.match(/\/tickets\/(\d+)/)?.[1];
      if (newId && newId !== lastTicketId) {
        lastTicketId = newId;
        resetPanel();
        clearTimeout(navTimer);
        navTimer = setTimeout(autoDetectAll, 2500);
      }
    }
    const origPush    = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState    = (...a) => { origPush(...a);    onNav(); };
    history.replaceState = (...a) => { origReplace(...a); onNav(); };
    window.addEventListener('popstate', onNav);

    let scanTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => updateDetectedChips(panel, !!panel.querySelector('#sp-order-input')?.value), 1200);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(autoDetectAll, 2500);
  }

  // Heartbeat: if both the panel AND the toggle button disappear from the DOM
  // (Zendesk SPA re-render, slow initial load, etc.) re-run init automatically.
  // typeof guards make this file safe to copy verbatim into GAS (where setInterval/setTimeout are undefined).
  if (typeof setInterval === 'function') setInterval(() => {
    if (!document.getElementById(PANEL_ID) && !document.getElementById('sp-toggle-btn')) {
      init();
    }
  }, 2000);

  if (typeof setTimeout === 'function') setTimeout(init, 800);
})();
