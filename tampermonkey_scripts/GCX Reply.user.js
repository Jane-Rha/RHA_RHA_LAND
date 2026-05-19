// ==UserScript==
// @name         GCX Reply
// @namespace    https://spigen.com/gcx
// @version      1.2.0
// @description  Amazon order data via GAS web app + Spigen product info from Google Sheet
// @author       Spigen GCX
// @match        https://spigenhelp.zendesk.com/agent/tickets/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @run-at       document-idle
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  // Replace with your deployed GAS web app URL after deploying:
  //   GAS → Deploy → New deployment → Web app → Execute as Me → Anyone
  const GAS_URL    = 'YOUR_GAS_WEB_APP_URL';
  const ORDER_RE   = /\b(\d{3}-\d{7}-\d{7})\b/g;
  const ASIN_RE    = /\b(B[A-Z0-9]{9})\b/g;
  const PANEL_ID   = 'sp-order-panel';
  const SHEET_COLS = ['SKU', '모델명', '브랜드', '제조사명', '기종명', '색상명', '대분류', '생산업체', '원산지정보'];

  // ── Zendesk API: read ASIN from ticket custom fields ────────────────────────
  function getTicketASIN(cb) {
    const m = location.pathname.match(/\/tickets\/(\d+)/);
    if (!m) return cb(null);
    GM_xmlhttpRequest({
      method: 'GET',
      url: `https://spigenhelp.zendesk.com/api/v2/tickets/${m[1]}.json`,
      onload(res) {
        if (res.status !== 200) return cb(null);
        try {
          const fields = JSON.parse(res.responseText).ticket?.custom_fields || [];
          const asinField = fields.find(f => /^B[A-Z0-9]{9}$/.test(String(f.value || '')));
          cb(asinField?.value || null);
        } catch { cb(null); }
      },
      onerror() { cb(null); },
    });
  }

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

  // ── Styles ─────────────────────────────────────────────────────────────────
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

    /* ── Data rows ── */
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

    /* ── Toggle button (reopens panel after close) ── */
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

  // ── Panel HTML ──────────────────────────────────────────────────────────────
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
        <div id="sp-result">
          <div id="sp-status">Scanning ticket for order IDs…</div>
        </div>
        <div id="sp-product-result"></div>
      </div>
    `;
    return d;
  }

  // ── Format helpers ──────────────────────────────────────────────────────────
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

  // SalesChannel "Amazon.it" → "https://www.amazon.it/dp/{asin}"
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

  // ── Render order data ───────────────────────────────────────────────────────
  function renderOrder(data, orderId) {
    const o  = data.order   || {};
    const it = data.items   || [];
    const ad = data.address || {};
    const b  = data.buyer   || {};

    // Items endpoint returns 403 — ASIN is detected separately and shown in Product Info section
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

  // ── Fetch via GM_xmlhttpRequest (bypasses CORS) ─────────────────────────────
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
          result.innerHTML = renderOrder(data, orderId);
          result.querySelectorAll('.sp-block-title').forEach(title => {
            title.addEventListener('click', e => {
              e.stopPropagation();
              title.closest('.sp-block').classList.toggle('collapsed');
            });
          });

          // Auto-fill ASIN input if not already set
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

  // ── Auto-detect Amazon order IDs from visible ticket text ───────────────────
  function detectOrderIds() {
    const text = document.body.innerText || '';
    return [...new Set([...text.matchAll(ORDER_RE)].map(m => m[1]))];
  }

  function updateDetectedChips(panel) {
    const ids = detectOrderIds();
    const bar = panel.querySelector('#sp-detected-ids');
    if (!bar) return;

    // Only update if IDs actually changed
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

    // Auto-load if exactly one ID found and we haven't loaded yet
    if (ids.length === 1 && document.getElementById('sp-status')) {
      const input = panel.querySelector('#sp-order-input');
      if (!input.value) {
        input.value = ids[0];
        fetchOrder(ids[0]);
      }
    } else if (ids.length === 0) {
      setStatus('No Amazon order ID found on this ticket. Paste one above.');
    } else {
      setStatus('Multiple order IDs found — click a chip to look up.');
    }
  }

  // ── Draggable panel ─────────────────────────────────────────────────────────
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

  // ── Init ────────────────────────────────────────────────────────────────────
  function init() {
    if (document.getElementById(PANEL_ID)) return;

    // Toggle button to reopen panel
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

    // ── Reset panel when ticket changes ────────────────────────────────────────
    function resetPanel() {
      orderInput.value = '';
      asinInput.value  = '';
      const result = document.getElementById('sp-result');
      if (result) result.innerHTML = '<div id="sp-status">Scanning ticket for order IDs…</div>';
      const productResult = document.getElementById('sp-product-result');
      if (productResult) productResult.innerHTML = '';
      const chips = document.getElementById('sp-detected-ids');
      if (chips) chips.innerHTML = '';
    }

    function autoDetectAll() {
      updateDetectedChips(panel);
      getTicketASIN(asin => {
        const detected = asin || [...new Set([...document.body.innerText.matchAll(ASIN_RE)].map(m => m[1]))][0];
        if (detected) {
          const ai = document.getElementById('sp-asin-input');
          if (ai && !ai.value) { ai.value = detected; renderProductInfo(detected); }
        }
      });
    }

    // Intercept Zendesk SPA navigation (pushState + popstate)
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

    // Debounced MutationObserver to re-scan ticket content as it loads
    let scanTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => updateDetectedChips(panel), 1200);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Initial scan on first load
    setTimeout(autoDetectAll, 2500);
  }

  // Run immediately (document-idle guarantees DOM is ready);
  // short delay lets Zendesk's React finish its first render pass.
  setTimeout(init, 800);
})();
