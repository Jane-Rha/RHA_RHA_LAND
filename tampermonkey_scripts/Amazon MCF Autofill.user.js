// ==UserScript==
// @name         Amazon MCF Autofill
// @version      0.8.1
// @match        https://sellercentral.amazon.*/mcf/orders/create-order*
// @match        https://sellercentral-europe.amazon.*/mcf/orders/create-order*
// @match        https://sellercentral-eu.amazon.*/mcf/orders/create-order*
// @match        https://sellercentral.*.amazon.*/mcf/orders/create-order*
// @match        https://mcf.sellercentral.amazon.*/mcf/orders/create-order*
// @match        https://sellercentral.amazon.com/mcf/orders/create-order*
// @match        https://sellercentral.amazon.co.uk/mcf/orders/create-order*
// @match        https://sellercentral.amazon.de/mcf/orders/create-order*
// @match        https://sellercentral.amazon.fr/mcf/orders/create-order*
// @match        https://sellercentral.amazon.it/mcf/orders/create-order*
// @match        https://sellercentral.amazon.es/mcf/orders/create-order*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const LOG = (...a) => console.log('[MCF Autofill]', ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // -------------------------------
  // UI PANEL
  // -------------------------------
  function panel() {
    let box = document.getElementById('mcf-autofill-panel');
    if (box) return box;

    box = document.createElement('div');
    box.id = 'mcf-autofill-panel';
    Object.assign(box.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      zIndex: 2147483647,
      background: '#0b0f0c',
      color: '#00ff9c',
      border: '1px solid #00ff9c',
      borderRadius: '10px',
      padding: '10px',
      fontFamily: 'Consolas, Menlo, monospace',
      fontSize: '12px',
      boxShadow: '0 0 12px rgba(0,255,156,.35)',
      letterSpacing: '0.2px',
    });

    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <div style="font-weight:700;text-transform:uppercase;">Zendesk → MCF</div>
        <div style="flex:1;height:1px;background:#00ff9c30"></div>
        <button id="mcf-hide" style="all:unset;cursor:pointer;color:#00ff9c;">×</button>
      </div>
      <button id="mcf-clip" class="zx-btn">Paste from Clipboard</button>
      <div id="mcf-msg" style="margin-top:8px;min-width:320px;color:#9cffd8;"></div>
      <div style="color:#4ce6b4;margin-top:6px;">
        Hotkeys: <b>Alt+Shift+V</b> paste • <b>Ctrl+Alt+M</b> toggle
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #mcf-autofill-panel .zx-btn {
        background:#0b0f0c; color:#00ff9c; border:1px solid #00ff9c;
        padding:6px 10px; cursor:pointer; border-radius:8px;
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(box);
    return box;
  }

  const ui = panel();
  const msg = t => (ui.querySelector('#mcf-msg').textContent = t);
  ui.querySelector('#mcf-hide').onclick = () => (ui.style.display = 'none');

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'v') {
      e.preventDefault(); pasteFromClipboard();
    }
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      ui.style.display = ui.style.display === 'none' ? 'block' : 'none';
    }
  });

  // -------------------------------
  // KAT INPUT SETTERS (stable)
  // -------------------------------
  function setKatInput(el, val) {
    if (!el || val == null) return false;
    try {
      el.value = val;
      el.setAttribute('value', val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));

      const inner = el.shadowRoot && el.shadowRoot.querySelector('input,textarea');
      if (inner) {
        inner.value = val;
        inner.dispatchEvent(new Event('input', { bubbles: true }));
        inner.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    } catch (e) {
      LOG('setKatInput fail', e);
      return false;
    }
  }

  const setByLabel = (label, v) =>
    v
      ? setKatInput(
          [...document.querySelectorAll('kat-input')].find(
            k => (k.getAttribute('label') || '').trim().toLowerCase() === label.toLowerCase()
          ),
          v
        )
      : false;

  const setById = (id, v) =>
    v ? setKatInput(document.getElementById(id), v) : false;
      // ---------------------------------
  // COUNTRY DROPDOWN — FULL FIX
  // ---------------------------------
  function setCountry(code) {
    if (!code) return false;
    const upper = code.toUpperCase().replace(/^UK$/, 'GB').replace(/^EL$/, 'GR');

    const dd = document.querySelector('kat-dropdown[label="Country"]');
    if (!dd) {
      LOG('Country dropdown not found yet.');
      return false;
    }

    try {
      // Attempt 1: set programmatically
      dd.value = upper;
      dd.setAttribute('value', upper);
      dd.dispatchEvent(new Event('input', { bubbles: true }));
      dd.dispatchEvent(new Event('change', { bubbles: true }));

      // Verify
      if (dd.value === upper) {
        LOG('Country set via direct value =', upper);
        return true;
      }
    } catch (e) {
      LOG('Direct country set failed, trying shadow fallback', e);
    }

    return clickCountryDropdownOption(dd, upper);
  }

  // ---------------------------------
  // SHADOW DOM FALLBACK CLICK
  // ---------------------------------
  function clickCountryDropdownOption(dd, value) {
    if (!dd) return false;

    try {
      dd.click(); // open dropdown
    } catch {}

    const openMenu = () => {
      try {
        const shadow = dd.shadowRoot;
        if (!shadow) return null;

        return shadow.querySelector('kat-menu, kat-select-menu, [part="menu"], ul, div.options');
      } catch {
        return null;
      }
    };

    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      const menu = openMenu();
      if (menu) {
        const options = menu.querySelectorAll('[value], kat-option, li, div.option');
        for (const opt of options) {
          const v = opt.getAttribute('value') || opt.dataset.value || '';
          if (v.toUpperCase() === value.toUpperCase()) {
            opt.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
            opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            clearInterval(timer);

            LOG('Country set via shadow-click =', value);
            return true;
          }
        }
      }
      if (attempts > 25) {
        clearInterval(timer);
        LOG('Could not find dropdown option for', value);
      }
    }, 120);

    return true;
  }

  // ---------------------------------
  // PHONE → COUNTRY MAPPING
  // ---------------------------------
  const PHONE_CC = {
    PT: '+351', ES: '+34', DE: '+49', FR: '+33', IT: '+39', NL: '+31',
    SE: '+46', FI: '+358', BE: '+32', AT: '+43', IE: '+353', PL: '+48',
    RO: '+40', HU: '+36', GR: '+30', CZ: '+420', SK: '+421', LT: '+370',
    LV: '+371', EE: '+372', MT: '+356', CY: '+357', SI: '+386', HR: '+385',
    BG: '+359', GB: '+44'
  };

  const countryFromPhone = (phone) => {
    if (!phone) return '';
    for (const [code, cc] of Object.entries(PHONE_CC)) {
      if (phone.includes(cc)) return code;
    }
    return '';
  };

  const normCountryToken = (tok) => {
    if (!tok) return '';
    const t = tok.trim();

    if (/^UK$/i.test(t)) return 'GB';
    if (/^United\s*Kingdom$/i.test(t)) return 'GB';
    if (/^DEU?$/i.test(t) || /^Germany$/i.test(t) || /^Deutschland$/i.test(t)) return 'DE';
    if (/^Espa/i.test(t) || /^Spain$/i.test(t)) return 'ES';
    if (/^Portugal/i.test(t)) return 'PT';

    return /^[A-Za-z]{2}$/.test(t) ? t.toUpperCase() : '';
  };

  // ---------------------------------
  // CLIPBOARD PARSER (stable)
  // ---------------------------------
  function parseClipboard(txt) {
    const t = txt
      .replace(/\r/g, '')
      .replace(/[–—]/g, '-')
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();

      const asin = (t.match(/\bASIN\b[^\w]{0,5}([A-Z0-9]{8,12})/i) || [])[1];
      const sku  = (t.match(/\bSKU\b[^\w]{0,5}([\w.-]{5,})/i) || [])[1];
      const q = asin || sku || '';

      // FIXED: use real customer email
      let email = extractBestEmail(t) || '';
    let ticketCountryRaw =
      (t.match(/Country\*?\s*[:\-：]\s*([^\n]+)/i) || [])[1] ||
      (t.match(/국가\s*[:\-：]\s*([^\n]+)/i) || [])[1] ||
      '';

    ticketCountryRaw = (ticketCountryRaw || '').trim();
    const ticketCountry = normCountryToken(ticketCountryRaw);

    const numberedLine = /^\s*\(?(\d+)\)?[.)]\s*(.+)$/i;
    const blocks = [];
    let cur = null;

    const pushCur = () => {
      if (cur && Object.values(cur).some(Boolean)) blocks.push(cur);
      cur = null;
    };

    const setByIndex = (o, i, v) => {
      if (i === 1) o.name = v;
      if (i === 2) o.street = v;
      if (i === 3) o.city = v;
      if (i === 4) o.state = v;
      if (i === 5) o.postal = v;
      if (i === 6) o.phone = v;
    };

    const unlabel = s =>
      s.replace(/^(.+?):\s*/i, '')
       .replace(/^(.+?)\-\s*/i, '')
       .trim();

    for (const line of t.split('\n').map(s => s.trim()).filter(Boolean)) {
      const m = line.match(numberedLine);
      if (!m) continue;

      const idx = parseInt(m[1], 10);
      const val = unlabel(m[2].trim());

      if (idx === 1) {
        pushCur();
        cur = { name:'', street:'', city:'', state:'', postal:'', phone:'' };
      }
      if (!cur) cur = { name:'', street:'', city:'', state:'', postal:'', phone:'' };

      setByIndex(cur, idx, val);
      if (idx === 6) pushCur();
    }

    let addr = { name:'', street:'', city:'', state:'', postal:'', phone:'' };
    if (blocks.length > 0) addr = blocks[blocks.length - 1];

    const country = ticketCountry || countryFromPhone(addr.phone);
    return { ...addr, email, q, country, countryRaw: ticketCountryRaw };
  }
  // ---------------------------------
  // SHIPPING SPEED (Expedited)
  // ---------------------------------
  function clickShowMoreIfAny(next) {
    const btn = document.querySelector('kat-button.toggle-inferior-ship-options-button');
    if (btn && btn.offsetParent !== null) {
      btn.click();
      setTimeout(next, 300);
    } else {
      next();
    }
  }

  function clickExpeditedKatLabel() {
    const labels = [
      ...document.querySelectorAll('kat-label[part="radiobutton-label"], kat-label[for]')
    ];

    for (const el of labels) {
      const attrText = (el.getAttribute('text') || '').trim().toLowerCase();
      const txt = (el.textContent || '').trim().toLowerCase();
      const isExpedited = attrText === 'expedited' || /\bexpedited\b/.test(txt);
      if (!isExpedited) continue;

      const nativeLabel = el.querySelector('label[for]');
      if (nativeLabel) {
        ['pointerdown','mousedown','mouseup','click','pointerup'].forEach(evt =>
          nativeLabel.dispatchEvent(new MouseEvent(evt, { bubbles:true }))
        );
        return true;
      }

      const forId = el.getAttribute('for');
      if (forId) {
        const ctrl = document.getElementById(forId);
        if (ctrl) {
          ctrl.click();
          ctrl.dispatchEvent(new Event('input', { bubbles:true }));
          ctrl.dispatchEvent(new Event('change', { bubbles:true }));
          return true;
        }
      }
    }

    return pickExpeditedByGroup();
  }

  function pickExpeditedByGroup() {
    const grp =
      document.querySelector('kat-radiobutton-group[name="shipping-speed"]') ||
      document.querySelector('kat-radiobutton-group');
    if (!grp) return false;

    try {
      grp.value = 'Expedited';
      grp.setAttribute('value', 'Expedited');
      grp.dispatchEvent(new Event('input', { bubbles:true }));
      grp.dispatchEvent(new Event('change', { bubbles:true }));
      return true;
    } catch {
      return false;
    }
  }

  function pickExpedited() {
    const rb = [...document.querySelectorAll('kat-radiobutton')]
      .find(rb => (rb.getAttribute('value') || '').toLowerCase() === 'expedited');
    if (rb) { rb.click(); return true; }

    const grp = document.querySelector('kat-radiobutton-group[name="shipping-speed"]');
    const radio =
      grp && grp.querySelector('input[type="radio"][name="shipping-speed"][value="Expedited"]');
    if (radio) { radio.click(); return true; }

    return false;
  }

  function forceExpedited({ attempts=80, everyMs=350 } = {}) {
    let left = attempts;
    const timer = setInterval(() => {
      clickShowMoreIfAny(() => {
        if (clickExpeditedKatLabel() || pickExpeditedByGroup() || pickExpedited()) {
          const grp =
            document.querySelector('kat-radiobutton-group[name="shipping-speed"]') ||
            document.querySelector('kat-radiobutton-group');
          if (!grp || (grp.value || '').toLowerCase() === 'expedited') {
            msg('Shipping speed set to: Expedited');
            clearInterval(timer);
            return;
          }
        }
      });

      if (--left <= 0) clearInterval(timer);
    }, everyMs);
  }

  // ---------------------------------
  // Detect if item has been added
  // ---------------------------------
  function hasItemSelected() {
    const qtyKat = [...document.querySelectorAll('kat-input')]
      .find(k => (k.getAttribute('label') || '').trim().toLowerCase() === 'quantity');

    const qtyNative = document.querySelector('input[name*="quantity"], input[id*="quantity"]');
    const itemRow   = document.querySelector('[data-testid*="order-item"], tr[data-row-index]');

    return !!(qtyKat || qtyNative || itemRow);
  }

  let shippingWaiterStarted = false;
  function ensureExpeditedAfterReady({ attempts=150, everyMs=400 } = {}) {
    if (shippingWaiterStarted) return;
    shippingWaiterStarted = true;

    let left = attempts;
    const timer = setInterval(() => {
      if (hasItemSelected() && isOrderIdFilled()) {
        LOG('Item + Order ID ready → Select Expedited.');
        forceExpedited();
        clearInterval(timer);
        return;
      }
      if (--left <= 0) {
        LOG('Shipping selection timeout.');
        clearInterval(timer);
      }
    }, everyMs);
  }

  // ---------------------------------
  // ORDER ID + SHEET FLAG ENDPOINTS
  // ---------------------------------
  const ORDER_ID_ENDPOINT =
    'https://script.google.com/macros/s/AKfycbwM02GYF6gvdT1mSD7ePeLMU2huRz4ARl2E5AJ2Oh-nKYLWD3nbyHqAcNreM8wGZwdo/exec';

  const SHEET_MCF_FLAG_ENDPOINT =
    'https://script.google.com/macros/s/AKfycbwM02GYF6gvdT1mSD7ePeLMU2huRz4ARl2E5AJ2Oh-nKYLWD3nbyHqAcNreM8wGZwdo/exec';

  async function markRowMcfByEmail(email) {
    if (!email) return false;

    try {
      const url =
        SHEET_MCF_FLAG_ENDPOINT +
        '?email=' + encodeURIComponent(email) +
        '&action=markMcf&match=last';

      const res = await fetch(url, { method:'GET' });
      if (!res.ok) return false;

      const data = await res.json().catch(() => null);
      if (!data || data.success !== true) return false;

      LOG('Row marked MCF for:', email);
      return true;
    } catch (e) {
      LOG('markRowMcfByEmail error', e);
      return false;
    }
  }

async function fetchOrderIdByEmail(email) {
  if (!email) return null;

  async function tryFetch() {
    try {
      const url =
        ORDER_ID_ENDPOINT +
        '?email=' + encodeURIComponent(email) +
        '&match=last';

      const res = await fetch(url, { method:'GET' });
      if (!res.ok) return null;

      const data = await res.json();
      if (!data || !data.success) return null;

      return (data.orderId || '').trim();
    } catch (e) {
      LOG('fetchOrderIdByEmail error (attempt failed)', e);
      return null;
    }
  }

  // First attempt
  let orderId = await tryFetch();
  if (orderId) return orderId;

  // Retry once with slight delay
  LOG('Order ID fetch failed → retrying…');
  await sleep(500);

  orderId = await tryFetch();
  return orderId || null;
}

  // ---------------------------------
  // ORDER ID SETTER
  // ---------------------------------
  function isOrderIdFilled() {
    const kat = [...document.querySelectorAll('kat-input')].find(k => {
      const lbl = (k.getAttribute('label') || '').trim().toLowerCase();
      return lbl.includes('order id') || lbl.includes('merchant order id');
    });
    if (kat && (kat.value || kat.getAttribute('value'))) return true;

    const inner = document.querySelector(
      'input[name*="orderId"], input[id*="orderId"], input[name*="order-id"]'
    );
    if (inner && inner.value.trim()) return true;

    return false;
  }

  function setOrderIdInput(v) {
    if (!v) return false;

    const kat = [...document.querySelectorAll('kat-input')].find(k => {
      const lbl = (k.getAttribute('label') || '').trim().toLowerCase();
      return lbl.includes('order id') || lbl.includes('merchant order id');
    });

    if (kat) return setKatInput(kat, v);

    const inner = document.querySelector(
      'input[name*="orderId"], input[id*="orderId"], input[name*="order-id"]'
    );
    if (inner) {
      inner.value = v;
      inner.dispatchEvent(new Event('input', { bubbles:true }));
      inner.dispatchEvent(new Event('change', { bubbles:true }));
      return true;
    }

    return false;
  }

  // ---------------------------------
  // fillAll()
  // ---------------------------------
  function fillAll({ name, street, city, state, postal, phone, email, country, countryRaw, q }) {
    let ok = false;

    ok = setByLabel('Full name',        name)   || ok;
    ok = setByLabel('Street address',   street) || ok;
    ok = setByLabel('City',             city)   || ok;
    ok = setByLabel('State / Province', state)  || ok;
    ok = setByLabel('Postcode',         postal) || ok;
    ok = setByLabel('Phone number',     phone)  || ok;

    if (email) {
      ok = setByLabel('Email address', email) || ok;
      setById('katal-id-9', email);
    }

    const skipUK = (countryRaw || '').trim().toLowerCase() === 'united kingdom';
    if (country && !skipUK) {
      setCountry(country);
    }

    if (q) setById('sku-search-input', q) || setById('katal-id-10', q);

    return ok;
  }
  // ---------------------------------
  // EXTRACT EMAIL (prefer last non-company)
  // ---------------------------------
    function extractBestEmail(text) {
        if (!text) return null;

        const all = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
        if (!all || !all.length) return null;

        // BLOCK all Zendesk subdomains + all internal emails
        const blacklist =
              /(spigen\.com|zendesk\.|amazon\.(com|co\.uk|de|fr|es|it|nl|se))/i;

        // Prefer LAST customer email (deepest reply)
        const user = [...all].reverse().find(e => !blacklist.test(e));
        return user || null;
    }


  // ---------------------------------
  // MAIN CLIPBOARD PASTE
  // ---------------------------------
  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        msg('Clipboard empty.');
        return;
      }

      const d = parseClipboard(text);
      msg('Parsed. Filling…');

      fillAll(d);

      if (d.email) {
        markRowMcfByEmail(d.email);
        const order = await fetchOrderIdByEmail(d.email);
          if (order) {
              setOrderIdInput(order);
              msg('Order ID auto-filled.');
          } else {
              msg('Order ID not found (2 attempts).');
          }
      }

      ensureExpeditedAfterReady();

    } catch (e) {
      msg('Clipboard error.');
      LOG(e);
    }
  }

  // Bind UI button
  ui.querySelector('#mcf-clip').onclick = pasteFromClipboard;

})();
