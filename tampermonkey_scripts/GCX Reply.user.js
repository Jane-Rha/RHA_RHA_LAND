// ==UserScript==
// @name         GCX Reply
// @namespace    https://spigen.com/gcx
// @version      2.8.8
// @description  Amazon order data via GAS web app + Spigen product info + Zendesk auto-fill
// @author       Spigen GCX
// @updateURL    https://raw.githubusercontent.com/codingintheusa0402/spigen-gcx-automation/main/tampermonkey_scripts/GCX%20Reply.user.js
// @downloadURL  https://raw.githubusercontent.com/codingintheusa0402/spigen-gcx-automation/main/tampermonkey_scripts/GCX%20Reply.user.js
// @match        https://spigenhelp.zendesk.com/agent/tickets/*
// @match        https://spigenhelp.zendesk.com/agent/filters
// @match        https://spigenhelp.zendesk.com/agent/filters/*
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
    DAEBUNRYU:     58529165213721,
    SAENGSAN:      58529176884761,
    ORIGIN_INFO:   58529167605273,
  };

  const COUNTRY_MAP = {
    US:'us', GB:'uk', DE:'de', FR:'fr', IT:'it', ES:'es', JP:'jp',
    NL:'nl', SE:'se', IE:'ie', PL:'pl', TR:'tr', BE:'be', IN:'in',
    SG:'sg', AU:'au', CA:'ca', MX:'mx', KR:'kr',
  };

  const FULFILLMENT_MAP = { AFN: 'fba', MFN: 'merchant__fbm_' };
  const SCRIPT_VER = (typeof GM_info !== 'undefined' ? GM_info?.script?.version : null) || '2.8.5';

  // ── Module state ─────────────────────────────────────────────────────────
  let lastOrderData    = null;
  let lastProductData  = null;
  let _panelSession    = 0; // incremented on every resetPanel(); guards stale async callbacks
  let _productReady    = false; // true once product lookup finishes (or is determined impossible)
  let _gcrFilledThisTicket = false; // true after Auto-Fill confirmed & submitted on current ticket

  // ── UI state persistence ──────────────────────────────────────────────────
  function loadUi() {
    try { return JSON.parse(localStorage.getItem('gcx_ui') || '{}'); } catch { return {}; }
  }
  function saveUi(patch) {
    try { localStorage.setItem('gcx_ui', JSON.stringify(Object.assign(loadUi(), patch))); } catch {}
  }
  function applySectionState(container) {
    const c = loadUi().collapsed || {};
    container.querySelectorAll('[data-sp-section]').forEach(block => {
      const key = block.dataset.spSection;
      if (!(key in c)) return;
      if (c[key]) block.classList.add('collapsed');
      else block.classList.remove('collapsed');
    });
  }
  let lastAmazonProduct = null;
  let lastAiReason      = null;

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

  // Build Seller Central buyer order history search URL (last 2 years)
  function sellerCentralSearchUrl_(salesChannel, countryCode, buyerEmail) {
    if (!buyerEmail) return null;
    const domain = salesChannel ? salesChannel.toLowerCase()
      : (countryCode ? (COUNTRY_SC[countryCode] || null) : null);
    if (!domain) return null;
    const now         = Date.now();
    const twoYearsAgo = Math.round(now - 2 * 365.25 * 24 * 3600 * 1000);
    return `https://sellercentral.${domain}/orders-v3/search?qt=email&q=${encodeURIComponent(buyerEmail)}&date-range=${twoYearsAgo}-${now}`;
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

  // All Zendesk text/date field labels that GCX Reply ever writes via fillZdInput.
  // Used by clearAllZdFields_() to wipe React state on ticket navigation so stale
  // values from a previous ticket never get submitted when the agent marks Solved/Pending.
  const ZD_TEXT_FIELD_LABELS = [
    'Order ID', 'ASIN', '문의SKU', 'Customer Full Name', 'Purchase Date',
    'Order Status', 'Order Total', 'Delivery Level', '대분류', '생산업체', '원산지정보',
  ];

  function clearAllZdFields_() {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const needle_list = ZD_TEXT_FIELD_LABELS.map(normLabel);
    for (const input of document.querySelectorAll(
      '[data-test-id="ticket-fields-text-field"], [data-test-id="ticket-fields-date-field"]'
    )) {
      if (!input.value) continue; // already empty — skip
      let node = input.parentElement;
      for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
        const lbl = node.querySelector('label');
        if (lbl) {
          const t = normLabel(lbl.textContent);
          if (needle_list.some(n => t.startsWith(n))) {
            setter.call(input, '');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            break;
          }
        }
      }
    }
  }

  // Read the current value of a Zendesk React text/date input by label text
  function readZdInput_(labelText) {
    const needle = normLabel(labelText);
    for (const input of document.querySelectorAll(
      '[data-test-id="ticket-fields-text-field"], [data-test-id="ticket-fields-date-field"]'
    )) {
      let node = input.parentElement;
      for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
        const lbl = node.querySelector('label');
        if (lbl && normLabel(lbl.textContent).startsWith(needle)) return input.value || '';
      }
    }
    return '';
  }

  // Returns the actual DOM label text for the ZD field whose label starts with `labelPrefix`.
  function resolveZdLabel_(labelPrefix) {
    const needle = normLabel(labelPrefix);
    for (const input of document.querySelectorAll(
      '[data-test-id="ticket-fields-text-field"], [data-test-id="ticket-fields-date-field"]'
    )) {
      let node = input.parentElement;
      for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
        const lbl = node.querySelector('label');
        if (lbl && normLabel(lbl.textContent).startsWith(needle)) return lbl.textContent.trim();
      }
    }
    return null;
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

  // Tokenize: split camelCase + letter↔digit boundaries, lowercase, strip dots/specials.
  // Letter↔digit split ensures "Fold7"→"Fold 7" and "Flip7"→"Flip 7" match dropdown options.
  function tokenize_(s) {
    return s.replace(/([a-z])([A-Z])/g, '$1 $2')      // camelCase: "MagFit" → "Mag Fit"
            .replace(/([a-zA-Z])(\d)/g, '$1 $2')       // letter→digit: "Fold7" → "Fold 7"
            .replace(/(\d)([a-zA-Z])/g, '$1 $2')       // digit→letter: "7Pro" → "7 Pro"
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
    return bestScore >= 0.5 ? bestVal : null;
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

  // ── Fill confirmation modal ──────────────────────────────────────────────

  function showFillConfirm_(rows, onConfirm, onCancel) {
    const overlay = document.createElement('div');
    overlay.id = 'sp-fill-confirm-overlay';
    overlay.style.cssText = [
      'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:2147483646',
      'display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join(';');

    const fillable = rows.filter(r => r.after);
    const card = document.createElement('div');
    card.style.cssText = [
      'background:#fff;border-radius:8px;padding:20px 24px 16px',
      'max-width:680px;width:94vw;max-height:82vh;overflow-y:auto',
      'box-shadow:0 8px 40px rgba(0,0,0,0.28);display:flex;flex-direction:column;gap:0',
    ].join(';');

    function esc_(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <span style="font-weight:700;font-size:13px;color:#1f2d3d;">Confirm Auto-Fill</span>
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:#555;cursor:pointer;user-select:none;">
          <input type="checkbox" id="sp-chk-all" style="margin:0;cursor:pointer;" ${fillable.length ? 'checked' : ''}> Select all
        </label>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
        <thead>
          <tr style="border-bottom:2px solid #e4e8ed;">
            <th style="width:22px;padding:4px 6px;"></th>
            <th style="text-align:left;padding:4px 8px;color:#888;font-weight:600;white-space:nowrap;">Field</th>
            <th style="text-align:left;padding:4px 8px;color:#888;font-weight:600;min-width:130px;">Before</th>
            <th style="text-align:left;padding:4px 8px;color:#888;font-weight:600;min-width:160px;">After</th>
          </tr>
        </thead>
        <tbody id="sp-confirm-tbody">
          ${rows.map((r, i) => {
            const hasBefore = r.before && r.before !== r.after;
            const noChange  = r.before && r.before === r.after;
            const rowStyle  = noChange ? 'opacity:0.5;' : '';
            const afterColor = r.after ? (noChange ? '#888' : '#1a6e3a') : '#aaa';
            return `<tr data-idx="${i}" style="border-bottom:1px solid #f2f4f7;${rowStyle}">
              <td style="padding:5px 6px;text-align:center;">
                <input type="checkbox" data-row="${i}" style="margin:0;cursor:pointer;"
                  ${r.after && !noChange ? 'checked' : ''} ${!r.after ? 'disabled' : ''}>
              </td>
              <td style="padding:5px 8px;font-weight:500;color:#1f2d3d;white-space:nowrap;">${esc_(r.label)}</td>
              <td style="padding:5px 8px;color:#999;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                  title="${esc_(r.before)}">${esc_(r.before) || '<span style="color:#ccc">—</span>'}</td>
              <td style="padding:5px 8px;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${afterColor};font-weight:${r.after && !noChange ? '600' : 'normal'};"
                  title="${esc_(r.after)}">${esc_(r.after) || '<span style="color:#ccc">—</span>'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end;margin-top:14px;padding-top:12px;border-top:1px solid #eef0f3;">
        <span id="sp-confirm-count" style="font-size:11px;color:#888;margin-right:auto;"></span>
        <button id="sp-confirm-cancel" style="padding:6px 16px;border:1px solid #d0d5dd;border-radius:5px;background:#fff;cursor:pointer;font-size:12px;color:#444;">Cancel</button>
        <button id="sp-confirm-ok" style="padding:6px 16px;border:none;border-radius:5px;background:#2a7a50;color:#fff;cursor:pointer;font-size:12px;font-weight:600;">Fill Selected</button>
      </div>`;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const allChk  = card.querySelector('#sp-chk-all');
    const countEl = card.querySelector('#sp-confirm-count');
    const rowChks = () => [...card.querySelectorAll('input[data-row]:not([disabled])')]

    function refreshCount() {
      const n = rowChks().filter(c => c.checked).length;
      countEl.textContent = `${n} field${n !== 1 ? 's' : ''} selected`;
      card.querySelector('#sp-confirm-ok').disabled = n === 0;
    }
    refreshCount();

    allChk.addEventListener('change', () => {
      rowChks().forEach(c => c.checked = allChk.checked);
      refreshCount();
    });
    card.querySelector('#sp-confirm-tbody').addEventListener('change', e => {
      if (!e.target.matches('input[data-row]')) return;
      const all = rowChks();
      const checkedCount = all.filter(c => c.checked).length;
      allChk.indeterminate = checkedCount > 0 && checkedCount < all.length;
      allChk.checked = checkedCount === all.length;
      refreshCount();
    });

    card.querySelector('#sp-confirm-cancel').addEventListener('click', () => {
      overlay.remove(); onCancel?.();
    });
    card.querySelector('#sp-confirm-ok').addEventListener('click', () => {
      const sel = new Set(rowChks().filter(c => c.checked).map(c => +c.dataset.row));
      overlay.remove();
      onConfirm(rows.filter((_, i) => sel.has(i)));
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); onCancel?.(); } });
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
    const btn = panel?.querySelector('#sp-autofill-btn');
    if (bar && lastOrderData) {
      bar.style.display = 'block';
      // Only touch button state when not mid-fill (Preparing… / Filling…)
      if (btn && btn.textContent !== 'Preparing…' && btn.textContent !== 'Filling…') {
        btn.disabled = !_productReady;
        btn.textContent = _productReady ? 'Auto-Fill Form' : 'Loading…';
        btn.title = _productReady ? '' : 'Product info still loading — please wait';
      }
    }
    const mcfBar = panel?.querySelector('#sp-mcf-bar');
    if (mcfBar && lastOrderData) mcfBar.style.display = 'block';
  }

  // ── MCF: 티켓 본문 읽기 ────────────────────────────────────────────────────
  function getTicketBodyText_() {
    const m = location.pathname.match(/\/tickets\/(\d+)/);
    const pane = (m && document.querySelector(`[data-test-id="ticket-${m[1]}-standard-layout"]`)) || document.body;
    const inputText = [...pane.querySelectorAll('input, textarea')].map(el => el.value || '').join('\n');
    return (pane.innerText || '') + '\n' + inputText;
  }

  // ── MCF: 티켓 본문에서 고객 주소 파싱 (MCF Autofill parseClipboard와 동일 로직) ─
  const _MCF_PHONE_CC = {
    PT:'+351',ES:'+34',DE:'+49',FR:'+33',IT:'+39',NL:'+31',SE:'+46',FI:'+358',
    BE:'+32',AT:'+43',IE:'+353',PL:'+48',RO:'+40',HU:'+36',GR:'+30',CZ:'+420',
    SK:'+421',LT:'+370',LV:'+371',EE:'+372',MT:'+356',CY:'+357',SI:'+386',
    HR:'+385',BG:'+359',LU:'+352',DK:'+45',GB:'+44',US:'+1',CA:'+1',IN:'+91',JP:'+81',
  };
  function _mcfNormCountry(tok) {
    if (!tok) return '';
    const t = tok.trim();
    if (/^UK$/i.test(t) || /^United\s*Kingdom$/i.test(t) || /^Grande.Bretagne$/i.test(t)) return 'GB';
    if (/^DEU?$/i.test(t) || /^Germany$/i.test(t) || /^Deutschland$/i.test(t) || /^Allemagne$/i.test(t)) return 'DE';
    if (/^Espa/i.test(t) || /^Spain$/i.test(t)) return 'ES';
    if (/^Portugal/i.test(t)) return 'PT';
    if (/^France$/i.test(t) || /^Francia$/i.test(t)) return 'FR';
    if (/^Italy$/i.test(t) || /^Itali[ae]$/i.test(t) || /^Italie$/i.test(t)) return 'IT';
    if (/^Netherlands$/i.test(t) || /^Holland$/i.test(t) || /^Pays.Bas$/i.test(t)) return 'NL';
    if (/^Belgium$/i.test(t) || /^Belgique$/i.test(t) || /^Belgien$/i.test(t)) return 'BE';
    if (/^Sweden$/i.test(t) || /^Sverige$/i.test(t)) return 'SE';
    if (/^Poland$/i.test(t) || /^Polen$/i.test(t)) return 'PL';
    if (/^Austria$/i.test(t) || /^[OÖ]sterreich$/i.test(t)) return 'AT';
    if (/^Ireland$/i.test(t) || /^Irland$/i.test(t)) return 'IE';
    if (/^Denmark$/i.test(t) || /^D[äa]nemark$/i.test(t)) return 'DK';
    if (/^Finland$/i.test(t) || /^Finnland$/i.test(t)) return 'FI';
    if (/^Greece$/i.test(t) || /^Griechenland$/i.test(t)) return 'GR';
    if (/^Romania$/i.test(t) || /^Roumanie$/i.test(t)) return 'RO';
    if (/^Hungary$/i.test(t) || /^Ungarn$/i.test(t)) return 'HU';
    if (/^Czech/i.test(t) || /^Tschechien$/i.test(t)) return 'CZ';
    if (/^Slovenia$/i.test(t) || /^Slowenien$/i.test(t)) return 'SI';
    if (/^Slovakia$/i.test(t) || /^Slowakei$/i.test(t)) return 'SK';
    if (/^Croatia$/i.test(t) || /^Kroatien$/i.test(t)) return 'HR';
    if (/^Bulgaria$/i.test(t) || /^Bulgarie$/i.test(t)) return 'BG';
    if (/^Estonia$/i.test(t) || /^Estland$/i.test(t)) return 'EE';
    if (/^Latvia$/i.test(t) || /^Lettland$/i.test(t)) return 'LV';
    if (/^Lithuania$/i.test(t) || /^Litauen$/i.test(t)) return 'LT';
    if (/^Malta$/i.test(t)) return 'MT';
    if (/^Cyprus$/i.test(t) || /^Zypern$/i.test(t)) return 'CY';
    if (/^Luxembourg$/i.test(t)) return 'LU';
    if (/^India$/i.test(t) || /^Inde$/i.test(t)) return 'IN';
    if (/^Japan$/i.test(t) || /^日本$/.test(t)) return 'JP';
    if (/^United\s*States$/i.test(t) || /^USA?$/i.test(t)) return 'US';
    if (/^Canada$/i.test(t)) return 'CA';
    return /^[A-Za-z]{2}$/.test(t) ? t.toUpperCase() : '';
  }
  function parseTicketAddress_(txt) {
    if (!txt) return {};
    const t = txt.replace(/\r/g,'').replace(/[–—]/g,'-').replace(/ /g,' ').replace(/[ \t]+/g,' ').trim();
    const emailAll = t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
    const email = [...emailAll].reverse().find(e =>
      !/spigen\.com|zendesk\./i.test(e) &&
      !(/amazon\.(com|co\.uk|de|fr|es|it|nl|se)/i.test(e) && !/marketplace\.amazon\./i.test(e))
    ) || '';
    const asin = (t.match(/\bASIN\b[^\w]{0,5}(B[A-Z0-9]{9})\b/i) || [])[1] || '';
    const sku  = (t.match(/\bSKU\b[^\w]{0,5}([\w.-]{5,})/i) || [])[1] || '';
    let cRaw = (t.match(/Country\*?\s*[:\-：]\s*([^\n]+)/i) || [])[1]
            || (t.match(/^Country\*\n([A-Za-z]{2})\s*$/m) || [])[1]
            || (t.match(/국가\s*[:\-：]\s*([^\n]+)/i) || [])[1] || '';
    cRaw = cRaw.trim().replace(/\W+$/, '').trim();
    const blocks = [];
    let cur = null;
    const pushCur = () => { if (cur && Object.values(cur).some(Boolean)) blocks.push(cur); cur = null; };
    for (const line of t.split('\n').map(s => s.trim()).filter(Boolean)) {
      const m = line.match(/^\s*\(?(\d+)\)?[.)]\s*(.+)$/i);
      if (!m) continue;
      const idx = parseInt(m[1], 10);
      const val = m[2].trim().replace(/^(.+?):\s*/i,'').replace(/^(.+?)\s+--?\s*/i,'').trim();
      if (idx === 1) { pushCur(); cur = { name:'',street:'',city:'',state:'',postal:'',phone:'' }; }
      if (!cur) cur = { name:'',street:'',city:'',state:'',postal:'',phone:'' };
      if      (idx === 1) cur.name   = val;
      else if (idx === 2) cur.street = val;
      else if (idx === 3) cur.city   = val;
      else if (idx === 4) cur.state  = val;
      else if (idx === 5) cur.postal = val;
      else if (idx === 6) cur.phone  = val;
      if (idx === 6) pushCur();
    }
    pushCur();
    const addr = blocks.length ? blocks[blocks.length - 1] : {};
    const phoneCountry = Object.entries(_MCF_PHONE_CC).find(([, cc]) => (addr.phone || '').includes(cc))?.[0] || '';
    const country = _mcfNormCountry(cRaw) || phoneCountry;
    return {
      name:   addr.name   || '', street: addr.street || '', city:   addr.city   || '',
      state:  addr.state  || '', postal: addr.postal || '', phone:  addr.phone  || '',
      email, q: asin || sku, country,
    };
  }

  // ── MCF: 주문 API + 티켓 본문 주소를 합쳐 해시 페이로드 생성 ─────────────────
  function buildMcfPayload_(panelEl) {
    const o  = lastOrderData?.order   || {};
    const ad = lastOrderData?.address || {};
    const b  = lastOrderData?.buyer   || {};
    const itemAsins = (lastOrderData?.items || []).map(i => i.ASIN).filter(Boolean);
    const asin    = itemAsins[0] || panelEl?.querySelector('#sp-asin-input')?.value.trim() || '';
    const orderId = panelEl?.querySelector('#sp-order-input')?.value.trim() || '';
    // 고객이 티켓에 직접 쓴 주소가 주문 API 주소보다 우선 (MCF 배송지이므로)
    const ta = parseTicketAddress_(getTicketBodyText_());
    const country = ta.country || ad.CountryCode || '';
    return {
      name:    ta.name   || b.BuyerName || o.BuyerInfo?.BuyerName || ad.Name || '',
      street:  ta.street || ad.AddressLine1 || '',
      city:    ta.city   || ad.City || '',
      state:   ta.state  || ad.StateOrRegion || '',
      postal:  ta.postal || ad.PostalCode || '',
      phone:   ta.phone  || ad.Phone || '',
      email:   ta.email  || b.BuyerEmail || '',
      country,
      asin:    ta.q || asin,
      orderId,
      region:  country === 'JP' ? 'JP' : 'global',
    };
  }

  function sendToMCF(panel) {
    if (!lastOrderData) return;
    const payload = buildMcfPayload_(panel);
    const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
    const mcfBase = payload.country === 'JP'
      ? 'https://sellercentral-japan.amazon.com/mcf/orders/create-order/'
      : 'https://sellercentral.amazon.com/mcf/orders/create-order';
    window.open(mcfBase + '#spigen_mcf=' + encoded, '_blank');
    const status = panel.querySelector('#sp-mcf-status');
    if (status) {
      status.textContent = '✓ MCF 탭 열림 — 자동입력 대기중';
      status.style.display = 'block';
      setTimeout(() => { status.style.display = 'none'; }, 4000);
    }
  }

  // ── Auto-fill: PUT all fields to Zendesk API, fill text fields in DOM ────

  function autoFillTicket(panel) {
    const ticketId = location.pathname.match(/\/tickets\/(\d+)/)?.[1];
    if (!ticketId || !lastOrderData) return;

    const btn = panel.querySelector('#sp-autofill-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
    setFillStatus(panel, '');

    const o  = lastOrderData.order   || {};
    const ad = lastOrderData.address || {};
    const b  = lastOrderData.buyer   || {};
    const p  = lastProductData || {};

    const orderId   = panel.querySelector('#sp-order-input')?.value.trim() || '';
    const panelAsin = panel.querySelector('#sp-asin-input')?.value.trim()  || '';
    const itemAsins  = (lastOrderData.items || []).map(i => i.ASIN).filter(Boolean);
    const asinValue  = itemAsins.length ? itemAsins.join(', ') : panelAsin;
    const rawSellerSku = lastOrderData.items?.[0]?.SellerSKU || '';
    // Sheet SKU (p.SKU) always takes priority. Only accept rawSellerSku when it matches the
    // Spigen SKU pattern (3 uppercase letters + 5 digits, e.g. "ACH06437", "ACS06557PAN").
    // Rejects barcodes ("8809613760408"), model names ("PE2213IN 35w"), and non-Spigen codes ("PE2213IN").
    const itemSku = p.SKU || (!/^[A-Z]{3}\d{5}/.test(rawSellerSku) ? '' : rawSellerSku) || '';
    const totalPurchases = lastOrderData.totalPurchases ?? lastOrderData.orderCount;
    const totalRefunds   = lastOrderData.totalRefunds;
    const purchasesVal   = totalPurchases != null ? `q${Math.min(totalPurchases, 50)}` : null;
    const refundsVal     = totalRefunds   != null ? `q${Math.min(totalRefunds,   50)}` : null;
    const buyerName    = b.BuyerName || o.BuyerInfo?.BuyerName || ad.Name || '';
    const orderTotal   = o.OrderTotal ? `${o.OrderTotal.Amount} ${o.OrderTotal.CurrencyCode}` : '';
    const purchaseDateIso = purchaseDateLocal_(o.PurchaseDate, ad.CountryCode);
    const purchaseDateDom = purchaseDateIso
      ? new Date(purchaseDateIso + 'T00:00:00Z').toLocaleDateString('en-US',
          { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
      : '';
    const amz = lastAmazonProduct || {};
    const daebunryu  = p['대분류']     || amz['대분류']     || '';
    const saengsan   = p['생산업체']   || amz['생산업체']   || '';
    const originInfo = p['원산지정보'] || amz['원산지정보'] || '';
    const deviceLabel    = p['기종명'] || '';
    const productLabel   = p['모델명']  || '';
    const ticketText     = document.body.innerText || '';
    // PAN EU detection must check the raw SP-API SellerSKU (e.g. "ACS06557PAN"), NOT the
    // sheet SKU — the sheet stores the base SKU without the PAN/EUP suffix.
    const skuHasPan      = /pan|eup/i.test(rawSellerSku);
    const fulfillChannel = o.FulfillmentChannel || '';
    const brandTag       = brandFromDaebunryu(p['대분류'] || '');
    const pop            = salesChannelToPOP(o.SalesChannel);

    // DOM text-field rows — read current values for "before" column
    const DOM_DEFS = [
      { label: 'Order ID',           zdId: ZD.ORDER_ID,     after: orderId,           apiVal: orderId },
      { label: 'ASIN',               zdId: ZD.ASIN,         after: asinValue,          apiVal: asinValue },
      { label: '문의SKU',            zdId: ZD.SKU,          after: itemSku,            apiVal: itemSku },
      { label: 'Customer Full Name', zdId: ZD.CUST_NAME,    after: buyerName,          apiVal: buyerName },
      { label: 'Purchase Date',      zdId: ZD.PURCHASE_DATE,after: purchaseDateDom,    apiVal: purchaseDateIso, isDate: true },
      { label: 'Order Status',       zdId: ZD.ORDER_STATUS, after: o.OrderStatus||'',  apiVal: o.OrderStatus||'' },
      { label: 'Order Total',        zdId: ZD.ORDER_TOTAL,  after: orderTotal,         apiVal: orderTotal },
      { label: 'Delivery Level',     zdId: ZD.DELIVERY_LVL, after: o.ShipmentServiceLevelCategory||'', apiVal: o.ShipmentServiceLevelCategory||'' },
      { label: '대분류',             zdId: ZD.DAEBUNRYU,    after: daebunryu,          apiVal: daebunryu },
      { label: '생산업체',           zdId: ZD.SAENGSAN,     after: saengsan,           apiVal: saengsan },
      { label: '원산지정보',         zdId: ZD.ORIGIN_INFO,  after: originInfo,         apiVal: originInfo },
    ];
    const textRows = DOM_DEFS.map(d => ({
      label: resolveZdLabel_(d.label) || d.label, before: readZdInput_(d.label), after: d.after,
      dom: d, // carry definition for execution phase
    }));

    // Async-resolved rows (Device, Product Name, Fulfillment, Photo, API-only fields)
    let resolvedDevice   = null; // { val, name, opts }
    let resolvedProduct  = null; // { val, name }
    let resolvedFulfill  = null; // { val, name }
    let fulfillOpts      = [];   // all fulfillment opts — for before display name
    let resolvedHasPhoto = null;
    let currentCfMap     = {};   // fieldId → raw value from current ticket
    let ticketSubject    = '';   // captured from ticket JSON — used for invoice detection

    // Always fetch device opts (was conditional on deviceLabel); needed for invoice override
    let remain = 1 + (productLabel ? 1 : 0) + 3; // device + fulfillment + comments + ticket

    const BRAND_TAG_LABEL = {
      spigen_case_: 'CASE', spigen_sp_: 'SP', spigen_sda_: 'SDA',
      'spigen_pacc._': 'PAcc.', spigen_new_biz_: 'Newbiz', 'n/a': 'n/a',
    };

    function buildAndShow() {
      if (--remain > 0) return;

      // Invoice ticket override: if subject contains "invoice", force Device to the invoice option
      if (/invoice/i.test(ticketSubject) && resolvedDevice?.opts) {
        const invoiceOpt = resolvedDevice.opts.find(o => /invoice/i.test(o.name));
        if (invoiceOpt) resolvedDevice = { val: invoiceOpt.value, name: invoiceOpt.name, opts: resolvedDevice.opts };
      }

      // Refresh textRows "before" from ZD API (currentCfMap) — more reliable than DOM snapshot
      for (const row of textRows) {
        const cf = currentCfMap[row.dom.zdId];
        if (cf !== undefined) row.before = cf;
      }

      // API-only rows (no DOM text field counterpart)
      const apiOnlyRows = [
        { label: 'Device*', before: resolvedDevice?.opts?.find(o => o.value === currentCfMap[ZD.DEVICE])?.name || currentCfMap[ZD.DEVICE] || '',
          after: resolvedDevice?.name || '', api: resolvedDevice?.val ? { id: ZD.DEVICE, value: resolvedDevice.val } : null },
        { label: 'Product Name *', before: '', // resolved below using product opts
          after: resolvedProduct?.name || '', api: resolvedProduct?.val ? { id: ZD.PRODUCT_NAME, value: resolvedProduct.val } : null },
        { label: 'Country*',      before: currentCfMap[ZD.COUNTRY]     || '', after: COUNTRY_MAP[ad.CountryCode] || '', api: COUNTRY_MAP[ad.CountryCode] ? { id: ZD.COUNTRY, value: COUNTRY_MAP[ad.CountryCode] } : null },
        { label: 'Point of Purchase', before: currentCfMap[ZD.POINT_OF_PUR] || '', after: pop || '', api: pop ? { id: ZD.POINT_OF_PUR, value: pop } : null },
        { label: 'Amazon Fulfillment Methods*', before: fulfillOpts.find(o => o.value === currentCfMap[ZD.FULFILLMENT])?.name || currentCfMap[ZD.FULFILLMENT] || '', after: resolvedFulfill?.name || '', api: resolvedFulfill?.val ? { id: ZD.FULFILLMENT, value: resolvedFulfill.val } : null },
        { label: 'Brand(상세)*', before: BRAND_TAG_LABEL[currentCfMap[ZD.BRAND_DETAIL]] || currentCfMap[ZD.BRAND_DETAIL] || '', after: brandTag || '', api: brandTag ? { id: ZD.BRAND_DETAIL, value: brandTag } : null },
        { label: '✅전체 주문 (Product Issue, 아크테크X)*', before: currentCfMap[ZD.TOTAL_ORDERS]  || '', after: purchasesVal || '', api: purchasesVal ? { id: ZD.TOTAL_ORDERS, value: purchasesVal } : null },
        { label: '❎전체 환불*', before: currentCfMap[ZD.TOTAL_REFUNDS] || '', after: refundsVal || '', api: refundsVal ? { id: ZD.TOTAL_REFUNDS, value: refundsVal } : null },
        { label: '❗사진/영상 유무❗*', before: currentCfMap[ZD.PHOTO_EXIST] || '', after: resolvedHasPhoto != null ? (resolvedHasPhoto ? 'yes' : 'no') : '', api: resolvedHasPhoto != null ? { id: ZD.PHOTO_EXIST, value: resolvedHasPhoto ? 'yes' : 'no' } : null },
      ];

      // Resolve Product Name "before" using product opts
      const pnRow = apiOnlyRows.find(r => r.label === 'Product Name *');
      if (pnRow && resolvedProduct?.opts) {
        pnRow.before = resolvedProduct.opts.find(o => o.value === currentCfMap[ZD.PRODUCT_NAME])?.name?.replace(/^[^_]+_/, '') || currentCfMap[ZD.PRODUCT_NAME] || '';
      }

      const allRows = [...textRows, ...apiOnlyRows];

      if (btn) { btn.disabled = false; btn.textContent = 'Auto-Fill Form'; }

      showFillConfirm_(allRows, selectedRows => {
        _gcrFilledThisTicket = true; // track that GCX Reply filled this ticket's fields
        if (btn) { btn.disabled = true; btn.textContent = 'Filling…'; }

        // DOM fills first
        let dispatchEsc = false;
        for (const r of selectedRows) {
          if (!r.dom) continue;
          fillZdInput(r.dom.label, r.dom.after);
          if (r.dom.isDate && r.dom.after) dispatchEsc = true;
        }
        if (dispatchEsc) {
          setTimeout(() => document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
          ), 150);
        }

        // Build API payload from selected rows
        const af = [];
        for (const r of selectedRows) {
          if (r.api?.value) { af.push(r.api); continue; }
          if (!r.dom) continue;
          // DOM rows also write via API
          const v = r.dom.label === 'Purchase Date' ? r.dom.apiVal : r.dom.after;
          if (v) af.push({ id: r.dom.zdId, value: v });
        }

        putZdTicket(ticketId, af, btn, panel);
      }, () => {
        if (btn) { btn.disabled = false; btn.textContent = 'Auto-Fill Form'; }
      });
    }

    // Async fetches — device opts always fetched (invoice detection needs opts even without product)
    fetchZdFieldOpts(ZD.DEVICE, opts => {
      if (deviceLabel) {
        const v = bestDeviceOptVal(opts, deviceLabel, ticketText);
        resolvedDevice = v ? { val: v, name: opts.find(o => o.value === v)?.name || v, opts } : { val: null, name: '', opts };
      } else {
        resolvedDevice = { val: null, name: '', opts }; // no product, but keep opts for invoice override
      }
      buildAndShow();
    });
    if (productLabel) {
      fetchZdFieldOpts(ZD.PRODUCT_NAME, opts => {
        const v = bestMatchOptVal(opts, productLabel, true);
        resolvedProduct = { val: v, name: v ? opts.find(o => o.value === v)?.name?.replace(/^[^_]+_/, '') || v : '', opts };
        buildAndShow();
      });
    }
    fetchZdFieldOpts(ZD.FULFILLMENT, opts => {
      fulfillOpts = opts;
      let fv = null;
      if (skuHasPan) { const o2 = opts.find(x => /pan\s*eu/i.test(x.name)); if (o2) fv = o2.value; }
      if (!fv && fulfillChannel) {
        const kw = fulfillChannel === 'AFN' ? 'fba' : fulfillChannel === 'MFN' ? 'merchant' : null;
        if (kw) { const o2 = opts.find(x => x.name.toLowerCase().startsWith(kw)); if (o2) fv = o2.value; }
      }
      resolvedFulfill = fv ? { val: fv, name: opts.find(o => o.value === fv)?.name || fv } : null;
      buildAndShow();
    });
    fetchTicketComments(ticketId, hasPhoto => { resolvedHasPhoto = hasPhoto; buildAndShow(); });
    GM_xmlhttpRequest({
      method: 'GET',
      url: `https://spigenhelp.zendesk.com/api/v2/tickets/${ticketId}.json`,
      onload(res) {
        try {
          const t = JSON.parse(res.responseText).ticket || {};
          for (const f of (t.custom_fields || [])) currentCfMap[f.id] = f.value || '';
          ticketSubject = t.subject || '';
        } catch {}
        buildAndShow();
      },
      onerror() { buildAndShow(); },
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
        setFillStatus(panel, res.status === 200 ? `✓ ${af.length} fields saved` : `API error ${res.status}`);
      },
      onerror() {
        if (btn) { btn.disabled = false; btn.textContent = 'Auto-Fill Form'; }
        setFillStatus(panel, 'Network error');
      },
    });
  }

  // ── AI 인입사유 ───────────────────────────────────────────────────────────
  function fetchAiReason_(review, category) {
    const container = document.getElementById('sp-ai-reason-result');
    if (!container || !review) return;
    const _session = _panelSession;
    container.innerHTML = `<div style="padding:0 14px;"><div style="font-size:11px;color:#aaa;padding:6px 0;">AI 인입사유 분석 중…</div></div>`;
    logStep_('AI 인입사유 분석 중…');
    GM_xmlhttpRequest({
      method:   'GET',
      url:      `${GAS_URL}?action=inferReason&review=${encodeURIComponent(review.slice(0, 2000))}&category=${encodeURIComponent(category || '')}`,
      redirect: 'follow',
      timeout:  35000,
      onload(res) {
        if (_panelSession !== _session || !container.isConnected) return;
        try {
          const data = JSON.parse(res.responseText);
          if (data.error) logStep_(`AI GAS오류: ${data.error}`);
          lastAiReason = data.reason || null;
          renderAiReason_(lastAiReason);
          logStep_(`AI 인입사유: ${lastAiReason || '(결과 없음)'}`);
        } catch (err) {
          renderAiReason_(null);
          logStep_(`AI 인입사유 오류: JSON파싱실패 — ${res.responseText.slice(0, 120)}`);
        }
      },
      onerror(res) {
        if (_panelSession !== _session) return;
        container.innerHTML = '';
        logStep_(`AI 인입사유 오류: network error (status=${res.status})`);
      },
      ontimeout() {
        if (_panelSession !== _session) return;
        container.innerHTML = '';
        logStep_('AI 인입사유 오류: timeout (35s 초과)');
      },
    });
  }

  function renderAiReason_(reason) {
    const container = document.getElementById('sp-ai-reason-result');
    if (!container) return;
    const color = reason ? '#7c3aed' : '#9ca3af';
    const fill  = reason ? '#7c3aed' : '#9ca3af';
    container.innerHTML = `
      <div style="padding:0 14px 0;">
        <div class="sp-block" data-sp-section="ai_reason">
          <div class="sp-block-title" style="color:${color};border-top:1px solid #e9ebec;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="${fill}" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2l1.09 6.26L19 6l-4.26 4.91L21 12l-6.26 1.09L19 19l-4.91-4.26L12 21l-1.09-6.26L5 18l4.26-4.91L3 12l6.26-1.09L5 6l4.91 4.26L12 2z"/>
            </svg>
            AI 인입사유
            <span class="sp-chevron">▾</span>
          </div>
          <div class="sp-block-body">
            ${row('인입사유', reason || '(분류 불가)')}
          </div>
        </div>
      </div>`;
    container.querySelectorAll('.sp-block-title').forEach(t => {
      t.addEventListener('click', e => { e.stopPropagation(); t.closest('.sp-block').classList.toggle('collapsed'); });
    });
    applySectionState(container);
  }

  // ── Product info renderer ────────────────────────────────────────────────

  function renderProductInfo(asin) {
    renderAllProducts([asin]);
  }

  function renderAllProducts(asins, _retry, _forceExpand) {
    const container = document.getElementById('sp-product-result');
    if (!container) return;
    if (!asins.length) { container.innerHTML = ''; return; }
    const _session = _panelSession;
    container.innerHTML = `<div style="font-size:11px;color:#aaa;padding:4px 14px;">Loading product info…</div>`;
    if (!_retry) logStep_(`GAS product lookup: ${asins.join(', ')}`);

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
          if (res.responseText.trimStart().startsWith('<')) {
            results[idx] = { asin, product: null, source: null, marketplaces: [], error: '__html__', allSources: null };
            done(idx);
            return;
          }
          try {
            const data = JSON.parse(res.responseText);
            const mkts = data.marketplaces || [];
            if (data.product && data.productSource !== 'market') {
              // Full data from sheet1 or sheet2 — use directly
              logStep_(`Product: found in ${data.productSource || 'sheet'} (${asin})`);
              results[idx] = { asin, product: data.product, source: data.productSource || 'sheet', marketplaces: mkts, allSources: data.allSources || null };
              done(idx);
            } else if (data.product && data.productSource === 'market') {
              // Partial from country sheet (기종명 col A, 모델명 col B) — merge with Amazon
              logStep_(`Product: market sheet partial (${asin}), fetching Amazon…`);
              const partial = data.product;
              fetchAmazonProduct_(asin, (amazonProduct, amazonUrl) => {
                let merged = partial, src = 'market';
                if (amazonProduct) {
                  merged = Object.assign({}, amazonProduct);
                  if (partial['기종명']) merged['기종명'] = partial['기종명'];
                  if (partial['모델명']) merged['모델명'] = partial['모델명'];
                  src = 'market+amazon';
                }
                logStep_(amazonProduct ? `Product: Amazon merged (${asin})` : `Product: Amazon not found (${asin})`);
                results[idx] = { asin, product: merged, source: src, sourceUrl: amazonUrl, marketplaces: mkts, allSources: data.allSources || null, amazonProduct: amazonProduct || null, amazonUrl };
                done(idx);
              });
            } else {
              // Not in any sheet → fall back to Amazon product page
              logStep_(`Product: not in sheets (${asin}), fetching Amazon…`);
              fetchAmazonProduct_(asin, (amazonProduct, amazonUrl) => {
                logStep_(amazonProduct ? `Product: Amazon (${asin})` : `Product: not found anywhere (${asin})`);
                results[idx] = {
                  asin,
                  product:      amazonProduct,
                  source:       amazonProduct ? 'amazon' : null,
                  sourceUrl:    amazonUrl,
                  marketplaces: mkts,
                  error:        amazonProduct ? null : `${asin} not found in any sheet or Amazon page.`,
                  allSources:   data.allSources || null,
                  amazonProduct: amazonProduct || null,
                  amazonUrl,
                };
                done(idx);
              });
            }
          } catch (err) {
            results[idx] = { asin, product: null, source: null, marketplaces: [], error: 'Parse error: ' + err.message, allSources: null };
            done(idx);
          }
        },
        onerror() {
          results[idx] = { asin, product: null, source: null, error: 'Cannot reach GAS endpoint.', allSources: null };
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
      if (_panelSession !== _session || !container.isConnected) return;
      if (!_retry && results.every(r => r.error === '__html__')) {
        logStep_('GAS not ready, retrying product lookup…');
        container.innerHTML = `<div style="font-size:11px;color:#aaa;padding:4px 14px;">Retrying…</div>`;
        setTimeout(() => renderAllProducts(asins, true, _forceExpand), 2000);
        return;
      }
      results.forEach(r => { if (r.error === '__html__') r.error = 'GAS error — refresh and try again'; });
      const valid = results.filter(r => r.product);
      // Prefer sheet data for auto-fill (sheet1 > sheet2 > market+amazon > amazon > market)
      lastProductData =
        valid.find(r => r.source === 'sheet' || r.source === 'sheet1' || r.source === 'sheet2')?.product ||
        valid.find(r => r.source === 'market+amazon')?.product ||
        valid[0]?.product || null;
      // Store Amazon product for fallback (대분류/생산업체/원산지정보 may be empty in sheet)
      const amzResult = valid.find(r => r.amazonProduct);
      if (amzResult?.amazonProduct) lastAmazonProduct = amzResult.amazonProduct;
      _productReady = true;  // product lookup finished — enable Auto-Fill Form button
      maybeShowAutoFill(document.getElementById(PANEL_ID));

      const aiCategory = lastProductData?.['대분류'] || '';
      const aiReview   = getTicketBodyText_();
      if (aiReview) fetchAiReason_(aiReview, aiCategory);

      container.innerHTML = `<div style="padding:0 14px 8px;">${results.map(({ asin, product, source, sourceUrl, error, marketplaces }) => {
        if (!product) {
          const msg = error || `${esc(asin)} not found.`;
          return `<div style="font-size:11px;color:${error ? '#c00' : '#aaa'};padding:4px 0;">${esc(msg)}</div>`;
        }
        const label = asins.length > 1 ? esc(asin) : 'Product Info';
        return `
          <div class="sp-block" style="margin-top:0;" data-sp-section="product_${esc(asin)}">
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

      if (_forceExpand) {
        // ASIN-only ticket: apply saved state for non-product sections only;
        // product blocks stay expanded (default) so product info is the focus
        const _c = loadUi().collapsed || {};
        container.querySelectorAll('[data-sp-section]').forEach(block => {
          const key = block.dataset.spSection;
          if (key.startsWith('product_')) return;
          if (!(key in _c)) return;
          if (_c[key]) block.classList.add('collapsed'); else block.classList.remove('collapsed');
        });
      } else {
        applySectionState(container);
      }
      appendSourcesSection_(container, results);
    }
  }

  // ── ASIN source blocks ────────────────────────────────────────────────────

  function buildSourceBlock_(title, linkUrl, product) {
    const link = linkUrl
      ? ` <a href="${esc(linkUrl)}" target="_blank" rel="noopener"
           style="font-size:10px;font-weight:normal;color:#5ba4cf;text-decoration:none;margin-left:4px;">↗</a>`
      : '';
    const fields = SHEET_COLS.map(col => {
      const val = product[col];
      if (!val) return '';
      return `<div class="sp-row"><span class="sp-label" style="font-size:11.5px;">${esc(col)}</span><span class="sp-val" style="font-size:11.5px;">${esc(val)}</span></div>`;
    }).filter(Boolean).join('');
    return `
      <div class="sp-block collapsed" style="margin-top:0;">
        <div class="sp-block-title" style="border-top:1px solid #e9ebec;font-size:11.5px;">
          ${esc(title)}${link}<span class="sp-chevron" style="margin-left:auto;">▾</span>
        </div>
        <div class="sp-block-body">
          ${fields || '<div class="sp-row"><span class="sp-val" style="color:#aaa;font-size:11px;">No data</span></div>'}
        </div>
      </div>`;
  }

  function addCollapseListeners_(el) {
    el.querySelectorAll('.sp-block-title').forEach(t => {
      t.addEventListener('click', e => { e.stopPropagation(); t.closest('.sp-block').classList.toggle('collapsed'); });
    });
  }

  function appendSourcesSection_(container, results) {
    const SHEET1_LINK = 'https://docs.google.com/spreadsheets/d/1fx9K4r2T9SeZK076zy9kMHoLzAKDgmlRp-C2VtnTKVo/edit?gid=0#gid=0';
    const SHEET2_LINK = 'https://docs.google.com/spreadsheets/d/172fDVw4tu-hgbpV5FShWj4_SAMxeB54-v5BUlVgJUoA/edit?gid=716900287';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:0 14px 4px;';

    // Collapsible header — collapsed by default
    const hdr = document.createElement('div');
    hdr.style.cssText = 'font-size:11.5px;font-weight:600;color:#5ba4cf;padding:8px 0 4px;border-top:1px solid #e9ebec;margin-top:4px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;user-select:none;';
    const hdrText = document.createElement('span');
    hdrText.textContent = 'ASIN Sources';
    const hdrChevron = document.createElement('span');
    hdrChevron.textContent = '▸';
    hdrChevron.style.cssText = 'font-size:10px;color:#aaa;';
    hdr.appendChild(hdrText);
    hdr.appendChild(hdrChevron);

    const body = document.createElement('div');
    const _asinSrcCollapsed = (loadUi().collapsed || {})['asin_sources'] !== false;
    body.style.display = _asinSrcCollapsed ? 'none' : '';
    hdrChevron.textContent = _asinSrcCollapsed ? '▸' : '▾';

    hdr.addEventListener('click', () => {
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      hdrChevron.textContent = open ? '▸' : '▾';
      const c = loadUi().collapsed || {};
      c['asin_sources'] = open;
      saveUi({ collapsed: c });
    });

    wrap.appendChild(hdr);
    wrap.appendChild(body);
    container.appendChild(wrap);
    logStep_('Checking ASIN sources…');

    results.forEach(r => {
      if (!r || !r.asin) return;
      const { asin, allSources } = r;

      if (results.length > 1) {
        const lbl = document.createElement('div');
        lbl.style.cssText = 'font-size:11px;font-weight:600;color:#888;padding:2px 0;font-family:monospace;';
        lbl.textContent = asin;
        body.appendChild(lbl);
      }

      // ASIN Master (Sheet1)
      const s1el = document.createElement('div');
      if (allSources === null) {
        s1el.innerHTML = `<div style="font-size:11px;color:#c00;padding:2px 0;">ASIN Master — fetch error</div>`;
        logStep_(`Source: ASIN Master fetch error (${asin})`);
      } else {
        const s1 = allSources.sheet1;
        if (s1) {
          s1el.innerHTML = buildSourceBlock_('✓ ASIN Master', SHEET1_LINK, s1);
          logStep_(`Source: ASIN Master found (${asin})`);
        } else {
          s1el.innerHTML = `<div style="font-size:11px;color:#bbb;padding:2px 0;">✗ ASIN Master — not found</div>`;
          logStep_(`Source: ASIN Master not found (${asin})`);
        }
      }
      body.appendChild(s1el);
      addCollapseListeners_(s1el);

      // Sheet2
      const s2el = document.createElement('div');
      if (allSources === null) {
        s2el.innerHTML = `<div style="font-size:11px;color:#c00;padding:2px 0;">Sheet2 — fetch error</div>`;
        logStep_(`Source: Sheet2 fetch error (${asin})`);
      } else {
        const s2 = allSources.sheet2;
        if (s2) {
          s2el.innerHTML = buildSourceBlock_('✓ Sheet2', SHEET2_LINK, s2);
          logStep_(`Source: Sheet2 found (${asin})`);
        } else {
          s2el.innerHTML = `<div style="font-size:11px;color:#bbb;padding:2px 0;">✗ Sheet2 — not found</div>`;
          logStep_(`Source: Sheet2 not found (${asin})`);
        }
      }
      body.appendChild(s2el);
      addCollapseListeners_(s2el);

      // Amazon (async — reuse if already fetched during Product Info lookup)
      const amzEl = document.createElement('div');
      amzEl.innerHTML = `<div style="font-size:11px;color:#aaa;padding:2px 0;">Amazon — checking…</div>`;
      body.appendChild(amzEl);

      function setAmz(product, url) {
        if (product) lastAmazonProduct = product; // fallback for 대분류/생산업체/원산지정보
        if (!amzEl.isConnected) return;
        if (product) {
          amzEl.innerHTML = buildSourceBlock_('✓ Amazon', url || null, product);
          logStep_(`Source: Amazon found (${asin})`);
        } else {
          amzEl.innerHTML = `<div style="font-size:11px;color:#bbb;padding:2px 0;">✗ Amazon — not found</div>`;
          logStep_(`Source: Amazon not found (${asin})`);
        }
        addCollapseListeners_(amzEl);
      }

      // amazonProduct is undefined → not yet fetched (sheet1/sheet2 path); null → fetched+not found
      if (r.amazonProduct !== undefined) {
        setAmz(r.amazonProduct, r.amazonUrl);
      } else {
        logStep_(`Source: Amazon fetching… (${asin})`);
        fetchAmazonProduct_(asin, setAmz);
      }
    });
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
      top: 72px;
      width: 330px;
      min-width: 200px;
      max-width: 700px;
      max-height: calc(100vh - 80px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
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
    #sp-minimize-btn {
      margin-left: auto;
      cursor: pointer;
      opacity: .5;
      font-size: 18px;
      line-height: .7;
      padding: 2px 6px 4px;
      border-radius: 3px;
    }
    #sp-minimize-btn:hover { opacity: 1; background: #e3e5e7; }
    #sp-panel-close {
      cursor: pointer;
      opacity: .5;
      font-size: 15px;
      line-height: 1;
      padding: 2px 5px;
      border-radius: 3px;
    }
    #sp-panel-close:hover { opacity: 1; background: #e3e5e7; }

    #sp-order-panel.minimized #sp-panel-body,
    #sp-order-panel.minimized #sp-resize-handle { display: none; }
    #sp-order-panel.minimized #sp-panel-header { border-radius: 6px; border-bottom: none; cursor: pointer; }

    #sp-resize-handle {
      position: absolute;
      bottom: 0;
      right: 0;
      width: 16px;
      height: 16px;
      cursor: se-resize;
      opacity: .35;
      background: repeating-linear-gradient(
        -45deg,
        #999 0px, #999 2px,
        transparent 2px, transparent 5px
      );
    }
    #sp-resize-handle:hover { opacity: .75; }

    #sp-panel-body {
      padding: 10px 14px 8px;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
    }

    #sp-order-panel.sp-compact .sp-row { flex-direction: column; gap: 1px; }
    #sp-order-panel.sp-compact .sp-label { min-width: 0; font-size: 10.5px; }
    #sp-order-panel.sp-compact .sp-val   { font-size: 11.5px; }

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

    #sp-load-log {
      font-size: 10px;
      color: #999;
      padding: 3px 14px 4px;
      border-top: 1px dashed #e5e7ea;
      max-height: 56px;
      overflow-y: auto;
      font-family: monospace;
      line-height: 1.6;
      flex-shrink: 0;
    }
    #sp-load-log:empty { display: none; }

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

    #sp-mcf-bar { margin-bottom: 8px; display: none; }
    #sp-mcf-btn {
      background: #ff9900;
      color: #fff;
      border: none;
      border-radius: 4px;
      padding: 5px 0;
      cursor: pointer;
      font-size: 12px;
      width: 100%;
    }
    #sp-mcf-btn:hover { background: #e68a00; }
    #sp-mcf-status {
      display: none;
      font-size: 11px;
      color: #27ae60;
      margin-top: 4px;
      text-align: center;
    }

    #sp-notes-bar {
      margin-bottom: 6px;
    }
    #sp-notes-bar label {
      display: flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      user-select: none;
      font-size: 12px;
      color: #5ba4cf;
      font-weight: 500;
    }
    #sp-notes-toggle { cursor: pointer; accent-color: #5ba4cf; }
    #sp-notes-section {
      display: none;
      margin-bottom: 8px;
    }
    #sp-notes-content {
      font-size: 12px;
      color: #2f3941;
      white-space: pre-wrap;
      padding: 6px 8px;
      background: #f8f9fa;
      border: 1px solid #e9ebec;
      border-radius: 4px;
      min-height: 36px;
    }
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
        <span style="font-size:9.5px;font-weight:normal;color:#bbb;margin-left:3px;vertical-align:middle;letter-spacing:0.3px;">v${SCRIPT_VER}</span>
        <span id="sp-minimize-btn" title="Minimize">─</span>
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
        <div id="sp-mcf-bar">
          <button id="sp-mcf-btn">→ MCF</button>
          <div id="sp-mcf-status"></div>
        </div>
        <div id="sp-notes-bar">
          <label><input type="checkbox" id="sp-notes-toggle"> Notes</label>
        </div>
        <div id="sp-notes-section">
          <div id="sp-notes-content"></div>
        </div>
        <div id="sp-ai-reason-result"></div>
        <div id="sp-result">
          <div id="sp-status">Scanning ticket for order IDs…</div>
        </div>
        <div id="sp-product-result"></div>
      </div>
      <div id="sp-load-log"></div>
      <div id="sp-resize-handle"></div>
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

  // Seller Central shows purchase dates in the marketplace's local timezone, not UTC.
  // SP-API returns UTC. Convert so GCX Reply matches Seller Central.
  const PURCHASE_TZ_ = {
    IN: 'Asia/Kolkata',     // IST = UTC+5:30
    JP: 'Asia/Tokyo',       // JST = UTC+9
    SG: 'Asia/Singapore',   // SGT = UTC+8
    AU: 'Australia/Sydney', // AEST/AEDT
    KR: 'Asia/Seoul',       // KST = UTC+9
  };
  function purchaseDateLocal_(isoUtc, countryCode) {
    if (!isoUtc) return '';
    const tz = PURCHASE_TZ_[countryCode];
    if (!tz) return isoUtc.slice(0, 10);
    return new Date(isoUtc).toLocaleDateString('sv-SE', { timeZone: tz });
  }
  function fmtPurchaseDate_(isoUtc, countryCode) {
    if (!isoUtc) return '—';
    const tz = PURCHASE_TZ_[countryCode];
    if (!tz) return fmtDate(isoUtc) + ' (UTC)';
    const local = new Date(isoUtc).toLocaleString('sv-SE', { timeZone: tz }).slice(0, 16).replace('T', ' ');
    const label = { IN:'IST', JP:'JST', SG:'SGT', AU:'AEST', KR:'KST' }[countryCode] || tz;
    return `${local} (${label})`;
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

  function fulfillmentLabel_(channel, sku) {
    if (sku && /pan|eup/i.test(sku)) return 'PAN EU';
    if (channel === 'AFN') return 'FBA';
    if (channel === 'MFN') return 'Merchant (FBM)';
    return channel || '—';
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
    const buyerEmail   = b.BuyerEmail || '';
    const scSearchUrl  = sellerCentralSearchUrl_(o.SalesChannel, ad.CountryCode, buyerEmail);

    const itemAsins    = it.map(i => i.ASIN).filter(Boolean);
    const returnAsin   = itemAsins.length ? itemAsins.join(', ') : (panelAsin || '—');
    const fulfillLabel = fulfillmentLabel_(o.FulfillmentChannel, it[0]?.SellerSKU || '');
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

    const orderCountNote = data.totalPurchases != null
      ? ` <span style="color:#888;font-size:11px;">(구매 ${data.totalPurchases}건 / 환불 ${data.totalRefunds}건)</span>`
      : data.orderCount != null
        ? ` <span style="color:#888;font-size:11px;">(총 ${data.orderCount}건)</span>`
        : '';

    return `
      ${rowReturnAsin(returnAsin, o.SalesChannel, data.itemsStatus)}

      <div class="sp-block" data-sp-section="order">
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
          ${row('Seller SKU',       it[0]?.SellerSKU || '')}
          ${row('Order Status',     o.OrderStatus)}
          ${row('Purchase Date',    fmtPurchaseDate_(o.PurchaseDate, ad.CountryCode))}
          ${row('Amount',           amount)}
          ${row('Delivery Level',   o.ShipmentServiceLevelCategory || o.ShipServiceLevelCategory)}
          ${row('Ship Date',        fmtShipRange(o.EarliestShipDate, o.LatestShipDate))}

          <div class="sp-block collapsed" data-sp-section="shipping">
            <div class="sp-block-title" style="font-size:12px;">
              Shipping Address
              <span class="sp-chevron">▾</span>
            </div>
            <div class="sp-block-body">
              ${row('Amazon Fulfillment Methods', fulfillLabel)}
              ${addrRows || '<div class="sp-row"><span class="sp-val">—</span></div>'}
            </div>
          </div>
          ${row('Ship Service Level',  o.ShipServiceLevel)}
          ${row('Buyer Name',          buyerName)}
          ${rowLinked('구매이력 (2yr)',
              data.totalPurchases != null
                ? `구매 ${data.totalPurchases}건 / 환불 ${data.totalRefunds}건`
                : '—',
              scSearchUrl)}

          ${it.length > 0 ? `<div class="sp-items-title">Items (${it.length})</div>${itemRows}` : ''}
        </div>
      </div>
    `;
  }

  // ── Seller Central buyer purchase stats (SC session fallback) ────────────
  // SP-API often lacks BuyerEmail PII permission → use the user's logged-in SC
  // session. Hits /orders-api/order/{id} for buyer email, then
  // /orders-api/search?qt=email&q={email} for a 2-year order count.
  function fetchScBuyerStats_(orderId, salesChannel, countryCode, cb) {
    const scUrl = sellerCentralUrl(orderId, salesChannel, countryCode);
    if (!scUrl) { cb(null); return; }
    const base = scUrl.match(/^https:\/\/[^/]+/)[0];

    GM_xmlhttpRequest({
      method: 'GET',
      url: `${base}/orders-api/order/${orderId}`,
      redirect: 'follow',
      timeout: 15000,
      onload(res) {
        let email = null;
        if (res.status === 200) {
          try {
            const d = JSON.parse(res.responseText);
            email = d.order?.buyerEmail || d.order?.buyer?.email || null;
          } catch {}
          if (!email) {
            const m = res.responseText.match(/"([^"@]+@marketplace\.amazon\.[^"]+)"/);
            if (m) email = m[1];
          }
        }
        if (!email) { cb(null); return; }
        countByEmail_(email);
      },
      onerror() { cb(null); },
      ontimeout() { cb(null); },
    });

    function countByEmail_(email) {
      const now = Date.now();
      const twoYearsAgo = Math.round(now - 2 * 365.25 * 24 * 3600 * 1000);
      GM_xmlhttpRequest({
        method: 'GET',
        url: `${base}/orders-api/search?qt=email&q=${encodeURIComponent(email)}&date-range=${twoYearsAgo}-${now}`,
        redirect: 'follow',
        timeout: 15000,
        onload(res) {
          let count = null;
          if (res.status === 200) {
            try {
              const d = JSON.parse(res.responseText);
              count = d.totalCount ?? d.totalOrders
                   ?? (Array.isArray(d.orders) ? d.orders.length : null);
            } catch {
              const m = res.responseText.match(/"(?:totalCount|totalOrders)"\s*:\s*(\d+)/);
              if (m) count = parseInt(m[1], 10);
            }
          }
          cb({ email, totalPurchases: count, totalRefunds: 0 });
        },
        onerror()  { cb({ email, totalPurchases: null }); },
        ontimeout() { cb({ email, totalPurchases: null }); },
      });
    }
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
  function fetchOrder(orderId, _retries) {
    _retries = _retries || 0;
    const _session = _panelSession;
    setStatus('Fetching order data…', true);
    if (!_retries) logStep_(`Fetching order ${orderId}…`);
    GM_xmlhttpRequest({
      method:   'GET',
      url:      `${GAS_URL}?orderId=${encodeURIComponent(orderId)}`,
      redirect: 'follow',
      timeout:  30000,
      onload(res) {
        if (_panelSession !== _session) return;
        const result = document.getElementById('sp-result');
        if (!result) return;
        if (res.responseText.trimStart().startsWith('<')) {
          if (_retries < 2) {
            logStep_(`GAS not ready — retry ${_retries + 1}/2…`);
            setStatus('Retrying…', true);
            setTimeout(() => fetchOrder(orderId, _retries + 1), 2000);
            return;
          }
          setStatus('GAS error — refresh and try again');
          logStep_('Order fetch: GAS returned error page');
          return;
        }
        try {
          const data = JSON.parse(res.responseText);
          if (data.error) { setStatus(data.error); logStep_('Order error: ' + data.error); return; }

          // Store for auto-fill
          lastOrderData = data;
          logStep_(`Order loaded — ${data.order?.SalesChannel || data.region || 'unknown'} | 구매이력: ${data.totalPurchases != null ? `구매 ${data.totalPurchases}건 / 환불 ${data.totalRefunds}건` : 'N/A'}`);
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
          applySectionState(result);

          // SC session fallback: get buyer email + 2yr order count when SP-API can't provide it
          if (data.totalPurchases == null) {
            fetchScBuyerStats_(orderId, data.order?.SalesChannel, data.address?.CountryCode, stats => {
              if (_panelSession !== _session || !result.isConnected || !stats) return;
              if (stats.totalPurchases == null && !stats.email) return;
              const updated = Object.assign({}, data, {
                totalPurchases: stats.totalPurchases ?? data.totalPurchases,
                totalRefunds:   stats.totalRefunds   ?? data.totalRefunds ?? 0,
                buyer: Object.assign({}, data.buyer || {}, stats.email ? { BuyerEmail: stats.email } : {}),
              });
              lastOrderData = Object.assign({}, lastOrderData, updated);
              logStep_(`SC buyer stats: 구매 ${stats.totalPurchases ?? '?'}건`);
              result.innerHTML = renderOrder(updated, orderId, resolvedAsin);
              result.querySelectorAll('.sp-block-title').forEach(t => {
                t.addEventListener('click', e => { e.stopPropagation(); t.closest('.sp-block').classList.toggle('collapsed'); });
              });
              applySectionState(result);
              maybeShowAutoFill(document.getElementById(PANEL_ID));
            });
          }

          if (itemAsins.length) {
            logStep_(`Product lookup: ${itemAsins.join(', ')}`);
            renderAllProducts(itemAsins);
          } else if (resolvedAsin) {
            logStep_(`Product lookup: ${resolvedAsin}`);
            renderAllProducts([resolvedAsin]);
            // SP-API items were blocked → also fetch SC in parallel just to get SellerSKU
            // (product lookup already started above with the known ASIN — don't block it)
            if (data.itemsStatus !== 200) {
              fetchScItems(orderId, data.order?.SalesChannel, data.address?.CountryCode, scItems => {
                if (_panelSession !== _session || !result.isConnected) return;
                if (scItems && scItems.length) {
                  lastOrderData.items = scItems;
                  result.innerHTML = renderOrder(Object.assign({}, lastOrderData, { items: scItems }), orderId, resolvedAsin);
                  result.querySelectorAll('.sp-block-title').forEach(t => {
                    t.addEventListener('click', e => { e.stopPropagation(); t.closest('.sp-block').classList.toggle('collapsed'); });
                  });
                  applySectionState(result);
                  maybeShowAutoFill(document.getElementById(PANEL_ID));
                }
              });
            }
          } else if (data.itemsStatus !== 200) {
            // SP-API items blocked AND no ASIN → query Seller Central for ASIN + SellerSKU
            const asinValEl = result.querySelector('.sp-row .sp-val');
            if (asinValEl) asinValEl.textContent = 'Seller Central…';
            fetchScItems(orderId, data.order?.SalesChannel, data.address?.CountryCode, scItems => {
              if (_panelSession !== _session || !result.isConnected) return;
              if (scItems && scItems.length) {
                lastOrderData.items = scItems;
                const newAsins = scItems.map(i => i.ASIN).filter(Boolean);
                if (asinInput && !asinInput.value) asinInput.value = newAsins.join(', ');
                result.innerHTML = renderOrder(Object.assign({}, data, { items: scItems }), orderId, newAsins.join(', '));
                result.querySelectorAll('.sp-block-title').forEach(t => {
                  t.addEventListener('click', e => { e.stopPropagation(); t.closest('.sp-block').classList.toggle('collapsed'); });
                });
                applySectionState(result);
                renderAllProducts(newAsins); // finish() will set _productReady = true
                maybeShowAutoFill(document.getElementById(PANEL_ID));
              } else {
                // SC returned no items → no product lookup possible → enable button now
                _productReady = true;
                maybeShowAutoFill(document.getElementById(PANEL_ID));
              }
            });
          } else {
            // No ASIN detected and items were accessible but empty → no product lookup → enable now
            _productReady = true;
            maybeShowAutoFill(document.getElementById(PANEL_ID));
          }
        } catch (err) {
          setStatus('Parse error: ' + err.message);
        }
      },
      onerror()   { setStatus('Cannot reach GAS endpoint — check GAS_URL in script settings.'); },
      ontimeout() {
        if (_panelSession !== _session) return;
        if (_retries < 2) {
          logStep_(`Order timeout — retry ${_retries + 1}/2…`);
          setStatus('Retrying…');
          setTimeout(() => fetchOrder(orderId, _retries + 1), 3000);
        } else {
          setStatus('Request timed out.');
          logStep_('Order fetch: timed out after 2 retries');
        }
      },
    });
  }

  const LOADING_GIF = 'https://upload.wikimedia.org/wikipedia/commons/b/b1/Loading_icon.gif?_=20151024034921';
  function setStatus(msg, isLoading = false) {
    const html = isLoading
      ? `<img src="${LOADING_GIF}" style="width:14px;height:14px;vertical-align:middle;margin-right:5px;">${esc(msg)}`
      : esc(msg);
    const el = document.getElementById('sp-status');
    if (el) { el.innerHTML = html; return; }
    const result = document.getElementById('sp-result');
    if (result) result.innerHTML = `<div id="sp-status">${html}</div>`;
  }

  function logStep_(msg) {
    const el = document.getElementById('sp-load-log');
    if (!el) return;
    const t    = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const line = document.createElement('div');
    line.textContent = `${t}  ${msg}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
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
    handle.addEventListener('mousedown', e => {
      if (e.target.closest('#sp-minimize-btn, #sp-panel-close, #sp-resize-handle')) return;
      e.preventDefault();
      const rect = panel.getBoundingClientRect();
      const offX = e.clientX - rect.left;
      const offY = e.clientY - rect.top;
      let moved = false;
      const onMove = e2 => {
        moved = true;
        panel.style.left  = (e2.clientX - offX) + 'px';
        panel.style.top   = (e2.clientY - offY) + 'px';
        panel.style.right = 'auto';
      };
      const onUp = () => {
        handle._dragMoved = moved;
        if (moved) saveUi({ x: parseInt(panel.style.left), y: parseInt(panel.style.top) });
        removeEventListener('mousemove', onMove);
        removeEventListener('mouseup', onUp);
      };
      addEventListener('mousemove', onMove);
      addEventListener('mouseup', onUp);
    });
  }

  // ── Resizable panel ───────────────────────────────────────────────────────
  function makeResizable_(panel, handle) {
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      const startW = panel.offsetWidth, startH = panel.offsetHeight;
      const onMove = e2 => {
        const w = Math.max(200, Math.min(700, startW + e2.clientX - startX));
        const h = Math.max(80,  startH + e2.clientY - startY);
        panel.style.width  = w + 'px';
        panel.style.height = h + 'px';
      };
      const onUp = () => {
        saveUi({ w: panel.offsetWidth, h: panel.offsetHeight });
        removeEventListener('mousemove', onMove);
        removeEventListener('mouseup', onUp);
      };
      addEventListener('mousemove', onMove);
      addEventListener('mouseup', onUp);
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function isTicketPage_() { return !!location.pathname.match(/\/tickets\/\d+/); }
  function isFiltersPage_() { return !!location.pathname.match(/\/agent\/filters/); }

  function init() {
    if (!isTicketPage_() && !isFiltersPage_()) return;
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

    // Restore saved size + position — clamp to viewport so panel never starts off-screen.
    const _savedUi = loadUi();
    if (_savedUi.w) panel.style.width  = _savedUi.w + 'px';
    if (_savedUi.h) panel.style.height = _savedUi.h + 'px';
    if (_savedUi.x != null) {
      const clampedX = Math.max(4, Math.min(_savedUi.x, window.innerWidth - 220));
      panel.style.left = clampedX + 'px';
      panel.style.right = 'auto';
    }
    if (_savedUi.y != null) {
      const clampedY = Math.max(72, Math.min(_savedUi.y, window.innerHeight - 80));
      panel.style.top = clampedY + 'px';
    }

    // Start minimized on filter/list pages; expanded on ticket pages
    if (!isTicketPage_()) panel.classList.add('minimized');

    const header = panel.querySelector('#sp-panel-header');
    makeDraggable(panel, header);
    makeResizable_(panel, panel.querySelector('#sp-resize-handle'));

    // Minimize / expand
    panel.querySelector('#sp-minimize-btn').onclick = e => {
      e.stopPropagation();
      const minimized = panel.classList.toggle('minimized');
      if (minimized) {
        panel.dataset.savedH = panel.style.height || '';
        panel.style.height = '';
      } else if (panel.dataset.savedH) {
        panel.style.height = panel.dataset.savedH;
      }
    };
    header.addEventListener('click', () => {
      if (header._dragMoved) { header._dragMoved = false; return; }
      if (panel.classList.contains('minimized')) {
        panel.classList.remove('minimized');
        if (panel.dataset.savedH) panel.style.height = panel.dataset.savedH;
      }
    });

    // Reactive compact layout via ResizeObserver
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(([e]) => {
        panel.classList.toggle('sp-compact', e.contentRect.width < 260);
      }).observe(panel);
    }

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
    panel.querySelector('#sp-mcf-btn').onclick = () => sendToMCF(panel);

    const notesToggle  = panel.querySelector('#sp-notes-toggle');
    const notesSection = panel.querySelector('#sp-notes-section');
    const notesContent = panel.querySelector('#sp-notes-content');

    function refreshNotes() {
      const ta = document.querySelector('[data-test-id="notes-edit-text-area-test-id"]');
      notesContent.textContent = ta?.value?.trim() || '(no notes)';
    }
    notesToggle.addEventListener('change', () => {
      notesSection.style.display = notesToggle.checked ? 'block' : 'none';
      if (notesToggle.checked) refreshNotes();
      saveUi({ notes: notesToggle.checked });
    });
    if (loadUi().notes) {
      notesToggle.checked = true;
      notesSection.style.display = 'block';
      refreshNotes();
    }
    document.addEventListener('input', e => {
      if (notesToggle.checked && e.target.matches('[data-test-id="notes-edit-text-area-test-id"]'))
        notesContent.textContent = e.target.value.trim() || '(no notes)';
    });

    // ── Persist section collapse state (capture phase runs before stopPropagation) ──
    panel.addEventListener('click', e => {
      const title = e.target.closest('.sp-block-title');
      if (!title) return;
      const block = title.closest('[data-sp-section]');
      if (!block) return;
      setTimeout(() => {
        const c = loadUi().collapsed || {};
        c[block.dataset.spSection] = block.classList.contains('collapsed');
        saveUi({ collapsed: c });
      }, 0);
    }, true);

    // ── Reset panel on ticket navigation ────────────────────────────────────
    function resetPanel() {
      orderInput.value = '';
      asinInput.value  = '';
      lastOrderData    = null;
      lastProductData  = null;
      lastAmazonProduct = null;
      _productReady    = false;
      // Only wipe GCX Reply-filled ZD fields when Auto-Fill was actually confirmed on this
      // ticket. Clearing unconditionally caused Zendesk's own saved field values to be lost
      // whenever the agent navigated away and back (regression from v2.7.3).
      if (_gcrFilledThisTicket) clearAllZdFields_();
      _gcrFilledThisTicket = false;
      const result = document.getElementById('sp-result');
      if (result) result.innerHTML = '<div id="sp-status">Scanning ticket for order IDs…</div>';
      const productResult = document.getElementById('sp-product-result');
      if (productResult) productResult.innerHTML = '';
      const aiReasonEl = document.getElementById('sp-ai-reason-result');
      if (aiReasonEl) aiReasonEl.innerHTML = '';
      lastAiReason = null;
      const chips = document.getElementById('sp-detected-ids');
      if (chips) chips.innerHTML = '';
      const autoBar = panel.querySelector('#sp-autofill-bar');
      if (autoBar) autoBar.style.display = 'none';
      const mcfBar = panel.querySelector('#sp-mcf-bar');
      if (mcfBar) mcfBar.style.display = 'none';
      const notesToggleEl = panel.querySelector('#sp-notes-toggle');
      if (notesToggleEl) notesToggleEl.checked = false;
      const notesSectionEl = panel.querySelector('#sp-notes-section');
      if (notesSectionEl) notesSectionEl.style.display = 'none';
      const logEl = document.getElementById('sp-load-log');
      if (logEl) logEl.innerHTML = '';
      setFillStatus(panel, '');
      _panelSession++;
    }

    function autoDetectAll() {
      const _session = _panelSession;
      getTicketFields((orderId, asin, bodyIds) => {
        if (_panelSession !== _session) return; // stale callback from prev ticket — discard
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
          if (ai && !ai.value) {
            ai.value = detectedAsin;
            const _asinOnly = !orderId && (!bodyIds || !bodyIds.length);
            renderAllProducts([detectedAsin], false, _asinOnly);
          }
        }
      });
    }

    let lastTicketId = location.pathname.match(/\/tickets\/(\d+)/)?.[1];
    let navTimer = null;
    function onNav() {
      const newId = location.pathname.match(/\/tickets\/(\d+)/)?.[1];
      if (newId) {
        // Navigated to a ticket — always expand
        if (panel.classList.contains('minimized')) {
          panel.classList.remove('minimized');
          if (panel.dataset.savedH) panel.style.height = panel.dataset.savedH;
        }
        if (newId !== lastTicketId) {
          lastTicketId = newId;
          resetPanel();
          clearTimeout(navTimer);
          navTimer = setTimeout(autoDetectAll, 2500);
        }
      } else {
        // Left ticket pages (filters, views, etc.) — always collapse
        lastTicketId = null;
        if (location.pathname.startsWith('/agent/filters')) resetPanel();
        if (!panel.classList.contains('minimized')) {
          panel.dataset.savedH = panel.style.height || '';
          panel.style.height = '';
          panel.classList.add('minimized');
        }
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

    if (isTicketPage_()) setTimeout(autoDetectAll, 2500);
  }

  // 국가 코드 → Amazon MCF Seller Central URL
  function getMcfBase_(country) {
    if (country === 'JP') return 'https://sellercentral-japan.amazon.com/mcf/orders/create-order';
    const dom = {
      DE:'amazon.de', FR:'amazon.fr', IT:'amazon.it', ES:'amazon.es',
      NL:'amazon.nl', PL:'amazon.pl', SE:'amazon.se', BE:'amazon.be',
      GB:'amazon.co.uk', IN:'amazon.in', AU:'amazon.com.au',
      CA:'amazon.ca', MX:'amazon.com.mx', TR:'amazon.com.tr',
    }[country];
    return `https://sellercentral.${dom || 'amazon.com'}/mcf/orders/create-order`;
  }

  // MCF 링크 패치 — Amazon MCF 직접 링크 + Zendesk 매크로 Netlify 리다이렉트 링크 모두 커버
  function patchMcfLinks_(rootEl) {
    try {
      // Amazon MCF 직접 링크
      (rootEl || document).querySelectorAll('a[href*="mcf/orders/create-order"]').forEach(link => {
        if (link.href.includes('spigen_mcf=')) return;
        const base = link.href.split('#')[0].replace(/\?[^]*$/, '');
        link.onclick = e => {
          e.preventDefault();
          const payload = buildMcfPayload_(document.getElementById(PANEL_ID));
          const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
          window.open(base + '#spigen_mcf=' + encoded, '_blank');
        };
      });
      // Zendesk 매크로 Netlify 리다이렉트 링크 → Amazon MCF로 직접 열기
      (rootEl || document).querySelectorAll('a[href*=".netlify.app"]').forEach(link => {
        link.onclick = e => {
          e.preventDefault();
          const payload = buildMcfPayload_(document.getElementById(PANEL_ID));
          const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
          window.open(getMcfBase_(payload.country) + '#spigen_mcf=' + encoded, '_blank');
        };
      });
    } catch(e) {}
  }

  // 메인 문서 감시
  const _mcfLinkObs = new MutationObserver(() => patchMcfLinks_());
  _mcfLinkObs.observe(document.body, { childList: true, subtree: true });
  patchMcfLinks_();

  // iframe 내부도 감시 (Zendesk 에디터 등)
  if (typeof setInterval === 'function') setInterval(() => {
    document.querySelectorAll('iframe').forEach(iframe => {
      try {
        const doc = iframe.contentDocument;
        if (!doc || !doc.body || doc.body.dataset.mcfWatching) return;
        doc.body.dataset.mcfWatching = '1';
        patchMcfLinks_(doc);
        new MutationObserver(() => patchMcfLinks_(doc))
          .observe(doc.body, { childList: true, subtree: true });
      } catch(e) {}
    });
  }, 1000);

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

