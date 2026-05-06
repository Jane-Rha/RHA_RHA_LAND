// ==UserScript==
// @name         Amazon Invoice Automation
// @namespace    kevin.spigen.gcx
// @version      1.5 (2026-01-12)
// @description  Runs ONLY when you click "Run Now". Priority: Deemed resale/supply → fallback to Amazon generated invoice.
// @match        https://sellercentral.amazon.de/orders-v3/order/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM_download
// ==/UserScript==

(function () {
  'use strict';

  // ---------- UI ----------
  function panel() {
    let box = document.getElementById('auto-invoice-panel');
    if (box) return box;

    box = document.createElement('div');
    box.id = 'auto-invoice-panel';
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
      fontFamily: 'Consolas, Menlo, Monaco, monospace',
      fontSize: '12px',
      boxShadow: '0 0 12px rgba(0,255,156,.35)',
    });

    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <div style="font-weight:700;">Auto Invoice DL</div>
        <div style="flex:1;height:1px;background:#00ff9c30"></div>
        <button id="aid-hide" style="all:unset;cursor:pointer;color:#00ff9c;">×</button>
      </div>

      <div style="display:flex;gap:8px;">
        <button id="aid-run" class="zx-btn">Run Now</button>
        <button id="aid-copy" class="zx-btn">Copy Order ID</button>
      </div>

      <div id="aid-msg" style="margin-top:8px;min-width:320px;color:#9cffd8;"></div>
      <div style="margin-top:6px;color:#4ce6b4;">Toggle: Ctrl+Alt+M</div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #auto-invoice-panel .zx-btn {
        background:#0b0f0c;
        color:#00ff9c;
        border:1px solid #00ff9c;
        padding:6px 10px;
        border-radius:8px;
        cursor:pointer;
      }
      #auto-invoice-panel .zx-btn[disabled] {
        opacity:.5;
        cursor:default;
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(box);
    return box;
  }

  const ui = panel();
  const msg = (t) => (ui.querySelector('#aid-msg').textContent = t || '');
  const log = (t) => { console.log('[AutoInv]', t); msg(t); };

  ui.querySelector('#aid-hide').onclick = () => ui.style.display = 'none';
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'm') {
      ui.style.display = ui.style.display === 'none' ? 'block' : 'none';
    }
  });

  ui.querySelector('#aid-copy').onclick = () => {
    const id = extractOrderId();
    copyToClipboard(id);
    msg(`Order ID copied: ${id}`);
  };

  ui.querySelector('#aid-run').onclick = run;

  // ---------- Deep traversal ----------
  function* nodeWalker(root) {
    const q = [root];
    while (q.length) {
      const n = q.shift();
      yield n;
      if (n.shadowRoot) q.push(n.shadowRoot);
      if (n.tagName === 'IFRAME') {
        try { if (n.contentDocument) q.push(n.contentDocument); } catch {}
      }
      if (n.children) q.push(...n.children);
    }
  }

  function findAllDeep(predicate, limit = 1000) {
    const out = [];
    for (const n of nodeWalker(document)) {
      if (n instanceof Element && predicate(n)) {
        out.push(n);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  // ---------- Utils ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function extractOrderId() {
    const m = location.pathname.match(/\d{3}-\d{7}-\d{7}/);
    return m ? m[0] : 'order';
  }

  function copyToClipboard(text) {
    try { GM_setClipboard(text); return; } catch {}
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  async function downloadWithName(url, filename) {
    const full = new URL(url, location.origin).toString();
    if (typeof GM_download === 'function') {
      return new Promise((res, rej) => {
        GM_download({
          url: full,
          name: filename,
          saveAs: false,
          onload: res,
          onerror: rej
        });
      });
    }
    const r = await fetch(full, { credentials: 'include' });
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- Row matching ----------
  const RX_RESALE = /deemed\s*(resale|supply)/i;
  const RX_AMAZON = /amazon\s+generated/i;

  function isRow(el) {
    return el.getAttribute('role') === 'row' || el.tagName === 'KAT-TABLE-ROW';
  }

  function getHref(row) {
    const link =
      row.querySelector('kat-link[href]') ||
      row.querySelector('a[href*="download"]');
    return link?.getAttribute('href') || link?.href || null;
  }

  // ---------- Click Manage Invoice ----------
  async function clickManageInvoice() {
    log('Opening invoice modal...');
    const btn = findAllDeep(el =>
      el.matches?.('[data-test-id="manage-idu-invoice-button"] input'), 1
    )[0];

    btn?.click();
    await sleep(500);
  }

  // ---------- Scan + Download ----------
  async function scanAndDownload(orderId) {
    log('Scanning invoice rows...');
    const start = Date.now();

    while (Date.now() - start < 45000) {
      const rows = findAllDeep(isRow);

      const resaleRow = rows.find(r => RX_RESALE.test(r.textContent || ''));
      const amazonRow = rows.find(r => RX_AMAZON.test(r.textContent || ''));

      const target = resaleRow || amazonRow;

      if (target) {
        const href = getHref(target);
        if (href) {
          log(resaleRow ? 'Downloading Deemed resale/supply invoice…'
                        : 'Resale not found → downloading Amazon generated invoice…');
          await downloadWithName(href, `${orderId}.pdf`);
          log('Done.');
          return;
        }
      }
      await sleep(300);
    }

    log('ERROR: No invoice row found.');
  }

  // ---------- Main ----------
  let running = false;
  async function run() {
    if (running) return;
    running = true;

    const btn = ui.querySelector('#aid-run');
    btn.disabled = true;
    btn.textContent = 'Running…';

    try {
      const orderId = extractOrderId();
      copyToClipboard(orderId);
      log(`Order ID copied: ${orderId}`);

      await clickManageInvoice();
      await scanAndDownload(orderId);
    } catch (e) {
      log('FATAL: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Run Now';
      running = false;
    }
  }

})();
