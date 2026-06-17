// ==UserScript==
// @name         Amazon MCF Autofill
// @version      1.2.0
// @updateURL    https://raw.githubusercontent.com/codingintheusa0402/spigen-gcx-automation/main/tampermonkey_scripts/Amazon%20MCF%20Autofill.user.js
// @downloadURL  https://raw.githubusercontent.com/codingintheusa0402/spigen-gcx-automation/main/tampermonkey_scripts/Amazon%20MCF%20Autofill.user.js
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
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Capture hash at document-start before Amazon's SPA can clear it
  const _INIT_HASH = (() => {
    const h = location.hash;
    if (h && h.includes('spigen_mcf=')) {
      try { sessionStorage.setItem('_spigen_mcf_hash', h); } catch(e) {}
      history.replaceState(null, '', location.pathname + location.search);
    }
    return h;
  })();

  function waitForDOM(fn) {
    if (document.body) { fn(); return; }
    const t = setInterval(() => { if (document.body) { clearInterval(t); fn(); } }, 20);
  }

  waitForDOM(function () {

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
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
        <span style="color:#9cffd8;white-space:nowrap;font-size:11px;">발송자:</span>
        <input id="mcf-person" type="text"
          style="background:#0b0f0c;color:#00ff9c;border:1px solid #00ff9c66;border-radius:4px;
                 padding:3px 7px;font-family:Consolas,Menlo,monospace;font-size:12px;width:90px;" />
      </div>
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

  const personInput = ui.querySelector('#mcf-person');
  personInput.value = localStorage.getItem('mcf_person') || '김지우';
  personInput.addEventListener('input', () => localStorage.setItem('mcf_person', personInput.value));

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

  // Try multiple label candidates (English + Korean) — whichever matches the current SC language
  const setByAnyLabel = (labels, v) => {
    if (!v) return false;
    const allKat = [...document.querySelectorAll('kat-input')];
    const el = allKat.find(k =>
      labels.some(lbl => (k.getAttribute('label') || '').trim().toLowerCase() === lbl.toLowerCase())
    );
    return el ? setKatInput(el, v) : false;
  };

  const setByLabel = (label, v) => setByAnyLabel([label], v);

  const setById = (id, v) =>
    v ? setKatInput(document.getElementById(id), v) : false;
      // ---------------------------------
  // COUNTRY DROPDOWN
  // ---------------------------------
  function setCountry(code) {
    if (!code) return false;
    const upper = code.toUpperCase().replace(/^UK$/, 'GB').replace(/^EL$/, 'GR');

    const dd = document.querySelector('kat-dropdown[label="Country"]') ||
               document.querySelector('kat-dropdown[label="국가"]');
    if (!dd) { LOG('Country dropdown not found.'); return false; }

    const sr = dd.shadowRoot;
    if (!sr) { LOG('Country dropdown has no shadow root.'); return false; }

    // Open the dropdown by clicking the header
    const header = sr.querySelector('.select-header, [part="dropdown-header"]');
    if (header) header.click();

    // Poll until kat-option is VISIBLE (offsetParent !== null means the panel is open)
    // The option element always exists in the shadow root even when the panel is closed,
    // so checking existence alone is wrong — we must wait for it to become visible.
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      const opt = sr.querySelector(`kat-option[value="${upper}"]`);
      if (opt && opt.offsetParent !== null) {
        // kat-option ignores synthetic events dispatched on itself.
        // Must click inside its own shadow root's .content-wrapper to trigger selection.
        const inner = opt.shadowRoot && opt.shadowRoot.querySelector('.content-wrapper');
        (inner || opt).click();
        clearInterval(timer);
        LOG('Country set via inner shadow click =', upper);
        return;
      }
      if (attempts > 30) {
        clearInterval(timer);
        LOG('Could not find visible kat-option for', upper);
      }
    }, 100);

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
    BG: '+359', LU: '+352', DK: '+45', GB: '+44'
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
    if (/^United\s*Kingdom$/i.test(t) || /^Grande.Bretagne$/i.test(t)) return 'GB';
    if (/^DEU?$/i.test(t) || /^Germany$/i.test(t) || /^Deutschland$/i.test(t) || /^Allemagne$/i.test(t)) return 'DE';
    if (/^Espa/i.test(t) || /^Spain$/i.test(t)) return 'ES';
    if (/^Portugal/i.test(t)) return 'PT';
    if (/^France$/i.test(t) || /^Francia$/i.test(t)) return 'FR';
    if (/^Italy$/i.test(t) || /^Itali[ae]$/i.test(t) || /^Italie$/i.test(t)) return 'IT';
    if (/^Netherlands$/i.test(t) || /^Holland$/i.test(t) || /^Pays.Bas$/i.test(t)) return 'NL';
    if (/^Belgium$/i.test(t) || /^Belgique$/i.test(t) || /^Belgien$/i.test(t)) return 'BE';
    if (/^Sweden$/i.test(t) || /^Su[eè]de$/i.test(t) || /^Sverige$/i.test(t)) return 'SE';
    if (/^Poland$/i.test(t) || /^Pologne$/i.test(t) || /^Polen$/i.test(t)) return 'PL';
    if (/^Austria$/i.test(t) || /^Autriche$/i.test(t) || /^[OÖ]sterreich$/i.test(t)) return 'AT';
    if (/^Ireland$/i.test(t) || /^Irlande$/i.test(t) || /^Irland$/i.test(t)) return 'IE';
    if (/^Denmark$/i.test(t) || /^Danemark$/i.test(t) || /^D[äa]nemark$/i.test(t)) return 'DK';
    if (/^Finland$/i.test(t) || /^Finlande$/i.test(t) || /^Finnland$/i.test(t)) return 'FI';
    if (/^Greece$/i.test(t) || /^Gr[eè]ce$/i.test(t) || /^Griechenland$/i.test(t)) return 'GR';
    if (/^Romania$/i.test(t) || /^Roumanie$/i.test(t)) return 'RO';
    if (/^Hungary$/i.test(t) || /^Hongrie$/i.test(t) || /^Ungarn$/i.test(t)) return 'HU';
    if (/^Czech/i.test(t) || /^Tch[eè]quie$/i.test(t) || /^Tschechien$/i.test(t)) return 'CZ';
    if (/^Slovenia$/i.test(t) || /^Slowenien$/i.test(t)) return 'SI';
    if (/^Slovakia$/i.test(t) || /^Slovaquie$/i.test(t) || /^Slowakei$/i.test(t)) return 'SK';
    if (/^Croatia$/i.test(t) || /^Croatie$/i.test(t) || /^Kroatien$/i.test(t)) return 'HR';
    if (/^Bulgaria$/i.test(t) || /^Bulgarie$/i.test(t)) return 'BG';
    if (/^Estonia$/i.test(t) || /^Estonie$/i.test(t) || /^Estland$/i.test(t)) return 'EE';
    if (/^Latvia$/i.test(t) || /^Lettonie$/i.test(t) || /^Lettland$/i.test(t)) return 'LV';
    if (/^Lithuania$/i.test(t) || /^Lituanie$/i.test(t) || /^Litauen$/i.test(t)) return 'LT';
    if (/^Malta$/i.test(t)) return 'MT';
    if (/^Cyprus$/i.test(t) || /^Chypre$/i.test(t) || /^Zypern$/i.test(t)) return 'CY';
    if (/^Luxembourg$/i.test(t)) return 'LU';
    if (/^India$/i.test(t) || /^Inde$/i.test(t)) return 'IN';
    if (/^Japan$/i.test(t) || /^Japon$/i.test(t) || /^日本$/.test(t)) return 'JP';
    if (/^United\s*States$/i.test(t) || /^USA?$/i.test(t)) return 'US';

    return /^[A-Za-z]{2}$/.test(t) ? t.toUpperCase() : '';
  };

  // ---------------------------------
  // CLIPBOARD PARSER (stable)
  // ---------------------------------
  function parseClipboard(txt) {
    // The GCX Reply panel is appended to document.body end, so when the agent does
    // Cmd+A+C on the Zendesk ticket page the panel text (including "Return ASIN B0...")
    // appears after the ticket content. Strip it to prevent the SP-API ASIN (the
    // originally ordered product) from overriding the ticket's replacement ASIN.
    const gcxStart = txt.search(/(?:^|\n)GCX Reply\b/);
    const raw = gcxStart > 0 ? txt.slice(0, gcxStart) : txt;

    const t = raw
      .replace(/\r/g, '')
      .replace(/[–—]/g, '-')
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();

      const asin = (t.match(/\bASIN\b[^\w]{0,5}(B[A-Z0-9]{9})\b/i) || [])[1];
      const sku  = (t.match(/\bSKU\b[^\w]{0,5}([\w.-]{5,})/i) || [])[1];
      const q = asin || sku || '';

      // FIXED: use real customer email
      let email = extractBestEmail(t) || '';
    let ticketCountryRaw =
      (t.match(/Country\*?\s*[:\-：]\s*([^\n]+)/i) || [])[1] ||
      (t.match(/^Country\*\n([A-Za-z]{2})\s*$/m) || [])[1] ||
      (t.match(/국가\s*[:\-：]\s*([^\n]+)/i) || [])[1] ||
      '';

    // Strip trailing non-alpha chars, e.g. "IT)" from "(Country: IT)"
    ticketCountryRaw = (ticketCountryRaw || '').trim().replace(/\W+$/, '').trim();
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
       .replace(/^(.+?)\s+--?\s*/i, '')
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
      const isExpedited = attrText === 'expedited' || /\bexpedited\b/.test(txt) || txt.includes('빠른 배송');
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
      const person = (document.getElementById('mcf-person')?.value || '').trim() || '김지우';
      const url =
        SHEET_MCF_FLAG_ENDPOINT +
        '?email=' + encodeURIComponent(email) +
        '&action=markMcf&match=last' +
        '&person=' + encodeURIComponent(person);

      const res = await fetch(url, { method:'GET' });
      if (!res.ok) return false;

      const data = await res.json().catch(() => null);
      if (!data || data.success !== true) return null;

      LOG('Row marked MCF for:', email, '| orderId:', data.orderId);
      return data.orderId || null;
    } catch (e) {
      LOG('markRowMcfByEmail error', e);
      return null;
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
      LOG('fetchOrderIdByEmail attempt failed', e);
      return null;
    }
  }

  const MAX_RETRIES = 8;
  for (let i = 0; i < MAX_RETRIES; i++) {
    if (i > 0) {
      msg(`Order ID: retry ${i}/${MAX_RETRIES - 1}…`);
      await sleep(1500);
    }
    const orderId = await tryFetch();
    if (orderId) return orderId;
  }
  return null;
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
  // AUTO-SELECT SKU (highest fulfillable)
  // ---------------------------------
  function autoSelectBestSku() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;

      const components = [...document.querySelectorAll('.search-result-component')];
      if (components.length === 0) {
        if (attempts > 60) { clearInterval(timer); LOG('autoSelectBestSku: no results after 30s.'); }
        return;
      }

      // Parse fulfillable count from each result row; exclude amzn.* internal SKUs
      const entries = components.map(comp => {
        const qtyEl = comp.querySelector('.search-result-component-quantity');
        const text = (qtyEl ? qtyEl.textContent : '').trim();
        const m = text.match(/([\d,]+)\s+fulfillable/i);
        const count = m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
        return { count, comp };
      }).filter(({ comp }) => !/\bamzn[.\-]/i.test(comp.textContent || ''));
      if (!entries.length) {
        if (attempts > 60) { clearInterval(timer); LOG('autoSelectBestSku: only amzn.* SKUs found, nothing to select.'); }
        return;
      }
      entries.sort((a, b) => b.count - a.count);
      const best = entries[0];

      const xBtn = best.comp.querySelector('.search-result-x');
      if (!xBtn) {
        if (attempts > 60) { clearInterval(timer); LOG('autoSelectBestSku: .search-result-x not found.'); }
        return;
      }

      clearInterval(timer);

      // 1. Try React fiber onClick (React 18 delegates to root; direct .click() on the
      //    div host works, but kat-icon shadow-DOM children may swallow the event)
      const fKey = Object.keys(xBtn).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (fKey) {
        let fiber = xBtn[fKey];
        while (fiber) {
          if (fiber.memoizedProps && typeof fiber.memoizedProps.onClick === 'function') {
            fiber.memoizedProps.onClick({ preventDefault() {}, stopPropagation() {}, type: 'click', target: xBtn });
            LOG('autoSelectBestSku: fired React onClick,', best.count, 'fulfillable');
            msg(`SKU selected (${best.count.toLocaleString()} fulfillable).`);
            return;
          }
          fiber = fiber.return;
        }
      }

      // 2. Fallback: dispatch full pointer + mouse + click sequence on the div host itself
      ['pointerover','pointerenter','mouseover','mouseenter',
       'pointermove','mousemove','pointerdown','mousedown',
       'pointerup','mouseup','click'].forEach(type =>
        xBtn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window }))
      );
      LOG('autoSelectBestSku: dispatched pointer events,', best.count, 'fulfillable');
      msg(`SKU selected (${best.count.toLocaleString()} fulfillable).`);
    }, 500);
  }

  // ---------------------------------
  // fillAll()
  // ---------------------------------
  function fillAll({ name, street, city, state, postal, phone, email, country, countryRaw, q }) {
    let ok = false;

    ok = setByAnyLabel(['Full name',        '전체 이름'],          name)   || ok;
    ok = setByAnyLabel(['Street address',   '상세 주소'],          street) || ok;
    ok = setByAnyLabel(['City',             '도시'],               city)   || ok;
    ok = setByAnyLabel(['State / Province', '시/도'],             state)  || ok;
    ok = setByAnyLabel(['Postcode',         '우편번호'],           postal) || ok;
    ok = setByAnyLabel(['Phone number',     '전화번호'],           phone)  || ok;

    if (email) {
      ok = setByAnyLabel(['Email address',  '이메일 주소'], email) || ok;
      setById('katal-id-9', email);
    }

    if (q) {
      setById('sku-search-input', q) || setById('katal-id-10', q);
      // Trigger ASIN search by pressing Enter on the inner input after a short settle
      setTimeout(() => {
        const inner = document.getElementById('sku-search-input')
          ?.shadowRoot?.querySelector('input');
        if (inner) {
          inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, composed: true }));
          inner.dispatchEvent(new KeyboardEvent('keyup',  { key: 'Enter', keyCode: 13, bubbles: true, composed: true }));
        }
      }, 400);
    }

    return ok;
  }
  // ---------------------------------
  // EXTRACT EMAIL (prefer last non-company)
  // ---------------------------------
    function extractBestEmail(text) {
        if (!text) return null;

        const all = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
        if (!all || !all.length) return null;

        // Block internal/system emails; allow marketplace.amazon.* (anonymized buyer addresses)
        const user = [...all].reverse().find(e =>
          !/spigen\.com|zendesk\./i.test(e) &&
          !(/amazon\.(com|co\.uk|de|fr|es|it|nl|se)/i.test(e) && !/marketplace\.amazon\./i.test(e))
        );
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

      if (d.q) autoSelectBestSku();

      // Country must be set AFTER all other field events have settled.
      // setById/setByLabel fire bubbling input+change events; the kat-dropdown
      // closes itself when it sees events outside its boundary. Delay 800ms.
      if (d.country && d.countryRaw?.toLowerCase() !== 'united kingdom') {
        setTimeout(() => setCountry(d.country), 800);
      }

      if (d.email) {
        msg('시트 업데이트 중…');
        const orderId = await markRowMcfByEmail(d.email);
        if (orderId) {
          setOrderIdInput(orderId);
          msg('Order ID 자동입력 완료: ' + orderId);
        } else {
          msg('시트 업데이트 완료 (Order ID 없음)');
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

  // ── 클립보드 붙여넣기 이벤트 (Ctrl+V 전역) ──────────────────────────────
  // Reads from e.clipboardData directly — no browser clipboard permission needed.
  // Works on Windows PCs where navigator.clipboard.readText() silently fails.
  document.addEventListener('paste', async (e) => {
    const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
    if (!text) return;

    // Only intercept if content looks like MCF ticket data
    const looksLikeMcf =
      /\b(B[A-Z0-9]{9})\b/.test(text) ||           // ASIN
      /\bSKU\b/i.test(text) ||
      /^\s*1[.)]\s+.{3,}/m.test(text) ||            // numbered address block starting with 1.
      (/Country.*:/i.test(text) && /\d{4,}/.test(text)); // country + postal code

    if (!looksLikeMcf) return; // Not ticket data — let native paste proceed

    // Prevent pasting raw text into whatever was focused
    e.preventDefault();

    const d = parseClipboard(text);
    if (!d.name && !d.q && !d.email) return;

    msg('클립보드 자동입력 중…');
    fillAll(d);

    if (d.q) autoSelectBestSku();
    if (d.country && d.countryRaw?.toLowerCase() !== 'united kingdom') {
      setTimeout(() => setCountry(d.country), 800);
    }
    if (d.email) {
      msg('시트 업데이트 중…');
      const orderId = await markRowMcfByEmail(d.email);
      if (orderId) {
        setOrderIdInput(orderId);
        msg('Order ID 자동입력 완료: ' + orderId);
      } else {
        msg('시트 업데이트 완료 (Order ID 없음)');
      }
    }
    ensureExpeditedAfterReady();
  });

  // ── URL 해시 브릿지: Zendesk GCX Reply → MCF 자동입력 ───────────────────
  async function autoFillFromUrlHash() {
    const hash = sessionStorage.getItem('_spigen_mcf_hash') || '';
    sessionStorage.removeItem('_spigen_mcf_hash');
    try {
      if (!hash || !hash.includes('spigen_mcf=')) return;
      const encoded = hash.split('spigen_mcf=')[1];
      if (!encoded) return;

      const d = JSON.parse(decodeURIComponent(atob(encoded)));
      if (!d || d.region === 'JP') return;

      msg('Zendesk에서 자동입력 중…');

      // 특정 필드 대신 fillAll 자체를 최대 30초간 재시도
      let filled = false;
      for (let i = 0; i < 60; i++) {
        await sleep(500);
        const ok = fillAll({ name:d.name, street:d.street, city:d.city, state:d.state,
                  postal:d.postal, phone:d.phone, email:d.email,
                  country:d.country, countryRaw:d.country, q:d.asin });
        if (ok) { filled = true; break; }
      }

      if (!filled) { msg('폼 타임아웃'); return; }

      msg('입력 중…');
      if (d.asin) autoSelectBestSku();
      if (d.country) setTimeout(() => setCountry(d.country), 800);
      if (d.email) {
        msg('시트 업데이트 중…');
        const orderId = await markRowMcfByEmail(d.email);
        if (orderId) { setOrderIdInput(orderId); msg('✓ Zendesk 자동입력 완료'); }
        else msg('✓ 자동입력 완료 (Order ID 없음)');
      } else {
        msg('✓ Zendesk 자동입력 완료');
      }
      ensureExpeditedAfterReady();
    } catch(e) { LOG('autoFillFromUrlHash error', e); }
  }

  setTimeout(autoFillFromUrlHash, 500);

  }); // end waitForDOM
})();

