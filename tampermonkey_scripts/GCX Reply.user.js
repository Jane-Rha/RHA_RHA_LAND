// ==UserScript==
// @name         GCX Reply
// @namespace    https://spigen.com/gcx
// @version      1.4.0
// @description  Amazon order data via GAS web app + Spigen product info + Zendesk auto-fill
// @author       Spigen GCX
// @match        https://spigenhelp.zendesk.com/agent/tickets/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @run-at       document-idle
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  const GAS_URL    = 'https://script.google.com/macros/s/AKfycbw2Vdwk197LXB6oUAzuHS8sKamD5uqKZJDLvcHzbftWJk-M65XV1fAnTqiZo7ZEm4hk/exec';
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
    if (!m) return cb(null, null);
    GM_xmlhttpRequest({
      method: 'GET',
      url: `https://spigenhelp.zendesk.com/api/v2/tickets/${m[1]}.json`,
      onload(res) {
        if (res.status !== 200) return cb(null, null);
        try {
          const ticket = JSON.parse(res.responseText).ticket || {};
          const fields = ticket.custom_fields || [];
          const vals   = fields.map(f => String(f.value || ''));
          const orderId = vals.find(v => /^\d{3}-\d{7}-\d{7}$/.test(v)) || null;
          const asin    = vals.find(v => /^B[A-Z0-9]{9}$/.test(v)) || null;
          cb(orderId, asin);
        } catch { cb(null, null); }
      },
      onerror() { cb(null, null); },
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

  function matchOptVal(opts, label) {
    if (!label) return null;
    const needle = label.trim().toLowerCase();
    return opts.find(o => o.name.trim().toLowerCase() === needle)?.value || null;
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

    const orderId      = panel.querySelector('#sp-order-input')?.value.trim() || '';
    const asin         = panel.querySelector('#sp-asin-input')?.value.trim()  || '';
    const buyerName    = b.BuyerName || o.BuyerInfo?.BuyerName || ad.Name || '';
    const orderTotal   = o.OrderTotal ? `${o.OrderTotal.Amount} ${o.OrderTotal.CurrencyCode}` : '';
    const purchaseDateIso = o.PurchaseDate ? o.PurchaseDate.slice(0, 10) : '';
    const purchaseDateDom = purchaseDateIso
      ? new Date(purchaseDateIso + 'T00:00:00Z').toLocaleDateString('en-US',
          { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
      : '';

    // 1. DOM fill visible text fields immediately
    fillZdInput('Order ID',           orderId);
    fillZdInput('ASIN',               asin);
    fillZdInput('문의SKU',            p.SKU           || '');
    fillZdInput('Customer Full Name', buyerName);
    fillZdInput('Purchase Date',      purchaseDateDom);
    fillZdInput('Order Status',       o.OrderStatus   || '');
    fillZdInput('Order Total',        orderTotal);
    fillZdInput('Delivery Level',     o.ShipmentServiceLevelCategory || '');

    // 2. Build Zendesk API fields array
    const af = [];
    if (orderId)                             af.push({ id: ZD.ORDER_ID,      value: orderId });
    if (asin)                                af.push({ id: ZD.ASIN,          value: asin });
    if (p.SKU)                               af.push({ id: ZD.SKU,           value: p.SKU });
    if (buyerName)                           af.push({ id: ZD.CUST_NAME,     value: buyerName });
    if (o.OrderStatus)                       af.push({ id: ZD.ORDER_STATUS,  value: o.OrderStatus });
    if (orderTotal)                          af.push({ id: ZD.ORDER_TOTAL,   value: orderTotal });
    if (o.ShipmentServiceLevelCategory)      af.push({ id: ZD.DELIVERY_LVL, value: o.ShipmentServiceLevelCategory });
    if (purchaseDateIso)                     af.push({ id: ZD.PURCHASE_DATE, value: purchaseDateIso });
    if (COUNTRY_MAP[ad.CountryCode])         af.push({ id: ZD.COUNTRY,       value: COUNTRY_MAP[ad.CountryCode] });
    if (FULFILLMENT_MAP[o.FulfillmentChannel]) af.push({ id: ZD.FULFILLMENT, value: FULFILLMENT_MAP[o.FulfillmentChannel] });
    const pop = salesChannelToPOP(o.SalesChannel);
    if (pop)                                 af.push({ id: ZD.POINT_OF_PUR,  value: pop });

    // 3. Fetch Device + Product Name options async, then PUT
    const deviceLabel  = p['기종명'] || '';
    const productLabel = p['모델명']  || '';

    let remain = (deviceLabel ? 1 : 0) + (productLabel ? 1 : 0);
    function tryPut() { if (--remain <= 0) putZdTicket(ticketId, af, btn, panel); }

    if (deviceLabel)  fetchZdFieldOpts(ZD.DEVICE,       opts => { const v = matchOptVal(opts, deviceLabel);  if (v) af.push({ id: ZD.DEVICE,       value: v }); tryPut(); });
    if (productLabel) fetchZdFieldOpts(ZD.PRODUCT_NAME, opts => { const v = matchOptVal(opts, productLabel); if (v) af.push({ id: ZD.PRODUCT_NAME, value: v }); tryPut(); });
    if (!remain)      putZdTicket(ticketId, af, btn, panel);
  }

  function putZdTicket(ticketId, af, btn, panel) {
    if (!af.length) {
      if (btn) { btn.disabled = false; btn.textContent = '✨ Auto-Fill'; }
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
        if (btn) { btn.disabled = false; btn.textContent = '✨ Auto-Fill'; }
        setFillStatus(panel, res.status === 200 ? `✓ ${af.length} fields saved` : `⚠️ API error ${res.status}`);
      },
      onerror() {
        if (btn) { btn.disabled = false; btn.textContent = '✨ Auto-Fill'; }
        setFillStatus(panel, '⚠️ Network error');
      },
    });
  }

  // ── Product info renderer ────────────────────────────────────────────────

  function renderProductInfo(asin) {
    const el = document.getElementById('sp-product-result');
    if (!el) return;
    el.innerHTML = `<div style="font-size:11px;color:#aaa;padding:4px 14px;">Loading product info for ${esc(asin)}…</div>`;
    GM_xmlhttpRequest({
      method:   'GET',
      url:      `${GAS_URL}?asin=${encodeURIComponent(asin)}`,
      redirect: 'follow',
      timeout:  30000,
      onload(res) {
        if (!el.isConnected) return;
        try {
          const data = JSON.parse(res.responseText);
          if (data.error) { el.innerHTML = `<div style="padding:4px 14px;color:#c00;font-size:11px;">⚠️ ${esc(data.error)}</div>`; return; }
          const info = data.product;
          if (!info) { el.innerHTML = `<div style="padding:4px 14px;color:#aaa;font-size:11px;">ASIN ${esc(asin)} not found in product sheet.</div>`; return; }

          // Store for auto-fill
          lastProductData = info;
          maybeShowAutoFill(document.getElementById(PANEL_ID));

          el.innerHTML = `
            <div style="padding:0 14px 8px;">
              <div class="sp-block" style="margin-top:0;">
                <div class="sp-block-title" style="border-top:1px solid #e9ebec;">
                  📦 Product Info
                  <span class="sp-chevron">▾</span>
                </div>
                <div class="sp-block-body">
                  ${SHEET_COLS.map(col => row(col, info[col])).join('')}
                </div>
              </div>
            </div>`;
          el.querySelectorAll('.sp-block-title').forEach(t => {
            t.addEventListener('click', e => { e.stopPropagation(); t.closest('.sp-block').classList.toggle('collapsed'); });
          });
        } catch (err) {
          if (el.isConnected) el.innerHTML = `<div style="padding:4px 14px;color:#c00;font-size:11px;">⚠️ Parse error: ${esc(err.message)}</div>`;
        }
      },
      onerror() {
        if (el.isConnected) el.innerHTML = `<div style="padding:4px 14px;color:#c00;font-size:11px;">⚠️ Cannot reach GAS endpoint.</div>`;
      },
    });
  }

  // ── Styles ───────────────────────────────────────────────────────────────
  GM_addStyle(`
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
          <button id="sp-autofill-btn">✨ Auto-Fill Fields</button>
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

  function amazonUrl(asin, salesChannel) {
    if (!asin || asin === '—') return null;
    const domain = salesChannel ? salesChannel.toLowerCase() : 'amazon.com';
    return `https://www.${domain}/dp/${asin}`;
  }

  function rowAsin(asin, salesChannel) {
    const url = amazonUrl(asin, salesChannel);
    const val = url
      ? `<a href="${url}" target="_blank" rel="noopener" style="color:#5ba4cf;text-decoration:underline;font-weight:500;">${esc(asin)}</a>`
      : `<span class="sp-val">${esc(asin) || '—'}</span>`;
    return `<div class="sp-row"><span class="sp-label">Return ASIN</span>${url ? val : `<span class="sp-val">—</span>`}</div>`;
  }

  // ── Render order data ─────────────────────────────────────────────────────
  function renderOrder(data, orderId) {
    const o  = data.order   || {};
    const it = data.items   || [];
    const ad = data.address || {};
    const b  = data.buyer   || {};

    const pageAsins = [...new Set([...document.body.innerText.matchAll(ASIN_RE)].map(m => m[1]))];
    const asin = it[0]?.ASIN || pageAsins[0] || '—';
    const amount  = o.OrderTotal ? `${o.OrderTotal.Amount} ${o.OrderTotal.CurrencyCode}` : '—';
    const buyerName = b.BuyerName || o.BuyerInfo?.BuyerName || ad.Name || '—';

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

    return `
      ${rowAsin(asin, o.SalesChannel)}

      <div class="sp-block">
        <div class="sp-block-title">
          <svg width="16" height="16" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <text x="3" y="38" font-size="38" font-family="Georgia,serif" font-style="italic" fill="#FF9900">a</text>
            <path d="M6 40 Q24 47 42 40" stroke="#FF9900" stroke-width="3" fill="none" stroke-linecap="round"/>
          </svg>
          Order
          <span class="sp-chevron">▾</span>
        </div>
        <div class="sp-block-body">
          ${row('Amazon Order ID', orderId, true)}
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

          ${it.length > 1 ? `<div class="sp-items-title">Items (${it.length})</div>${itemRows}` : ''}
        </div>
      </div>
    `;
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

          result.innerHTML = renderOrder(data, orderId);
          result.querySelectorAll('.sp-block-title').forEach(title => {
            title.addEventListener('click', e => {
              e.stopPropagation();
              title.closest('.sp-block').classList.toggle('collapsed');
            });
          });

          const pageAsins = [...new Set([...document.body.innerText.matchAll(ASIN_RE)].map(m => m[1]))];
          const detectedAsin = data.items?.[0]?.ASIN || pageAsins[0];
          const asinInput = document.getElementById('sp-asin-input');
          if (detectedAsin && asinInput && !asinInput.value) {
            asinInput.value = detectedAsin;
            renderProductInfo(detectedAsin);
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
    const excludedText = [...document.querySelectorAll(
      '[data-test-id="header-tab"], [data-test-id="tooltip-description"]'
    )].map(el => el.innerText || '').join('\n');
    const excludedIds = new Set([...excludedText.matchAll(/\d{3}-\d{7}-\d{7}/g)].map(m => m[0]));

    const inputText = [...document.querySelectorAll('input, textarea')].map(el => el.value || '').join('\n');
    const text = (document.body.innerText || '') + '\n' + inputText;
    return [...new Set([...text.matchAll(ORDER_RE)].map(m => m[1]))]
      .filter(id => !excludedIds.has(id));
  }

  function updateDetectedChips(panel, skipAutoLoad) {
    const ids = detectOrderIds();
    const bar = panel.querySelector('#sp-detected-ids');
    if (!bar) return;

    const current = [...bar.querySelectorAll('.sp-chip')].map(c => c.dataset.id).join(',');
    if (current === ids.join(',')) return;

    bar.innerHTML = '';
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
        setStatus('Multiple order IDs found — click a chip to look up.');
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
    if (document.getElementById(PANEL_ID)) return;

    let toggleBtn = document.getElementById('sp-toggle-btn');
    if (!toggleBtn) {
      toggleBtn = document.createElement('button');
      toggleBtn.id          = 'sp-toggle-btn';
      toggleBtn.textContent = '📦 Order Lookup';
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
      const asin = asinInput.value.trim().toUpperCase();
      if (asin) renderProductInfo(asin);
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
      getTicketFields((orderId, asin) => {
        const orderInput = panel.querySelector('#sp-order-input');
        if (orderId && orderInput && !orderInput.value) {
          orderInput.value = orderId;
          fetchOrder(orderId);
        }
        updateDetectedChips(panel, !!orderId);

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

  setTimeout(init, 800);
})();
