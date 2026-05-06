// ==UserScript==
// @name         Amazon JP MCF Autofill
// @version      1.4.4
// @match        https://sellercentral-japan.amazon.com/mcf/orders/create-order/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /**********************************************************
   * CONFIG
   **********************************************************/
  const LOG = (...a) => console.log('[JP MCF Autofill]', ...a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const ORDER_ID_ENDPOINT =
    'https://script.google.com/macros/s/AKfycbyJhTa5W7Rj11JG121KfXCBHFHWshPUswKuElvEvC_LJqsj9wqYqZVigXu3i5ToiVOg/exec';

  /**********************************************************
   * JP PREFECTURE MAP
   **********************************************************/
  const JP_STATE_MAP = {
    '北海道': 'Hokkaido',
    '青森県': 'Aomori',
    '岩手県': 'Iwate',
    '宮城県': 'Miyagi',
    '秋田県': 'Akita',
    '山形県': 'Yamagata',
    '福島県': 'Fukushima',
    '茨城県': 'Ibaraki',
    '栃木県': 'Tochigi',
    '群馬県': 'Gunma',
    '埼玉県': 'Saitama',
    '千葉県': 'Chiba',
    '東京都': 'Tokyo',
    '神奈川県': 'Kanagawa',
    '新潟県': 'Niigata',
    '富山県': 'Toyama',
    '石川県': 'Ishikawa',
    '福井県': 'Fukui',
    '山梨県': 'Yamanashi',
    '長野県': 'Nagano',
    '岐阜県': 'Gifu',
    '静岡県': 'Shizuoka',
    '愛知県': 'Aichi',
    '三重県': 'Mie',
    '滋賀県': 'Shiga',
    '京都府': 'Kyoto',
    '大阪府': 'Osaka',
    '兵庫県': 'Hyogo',
    '奈良県': 'Nara',
    '和歌山県': 'Wakayama',
    '鳥取県': 'Tottori',
    '島根県': 'Shimane',
    '岡山県': 'Okayama',
    '広島県': 'Hiroshima',
    '山口県': 'Yamaguchi',
    '徳島県': 'Tokushima',
    '香川県': 'Kagawa',
    '愛媛県': 'Ehime',
    '高知県': 'Kochi',
    '福岡県': 'Fukuoka',
    '佐賀県': 'Saga',
    '長崎県': 'Nagasaki',
    '熊本県': 'Kumamoto',
    '大分県': 'Oita',
    '宮崎県': 'Miyazaki',
    '鹿児島県': 'Kagoshima',
    '沖縄県': 'Okinawa'
  };

  /**********************************************************
   * NORMALIZERS & VALIDATORS
   **********************************************************/
  const normalizePostalJP = v =>
    v ? v.replace(/[^\d]/g, '').slice(0, 7) : '';

  const normalizePhoneJP = v =>
    v ? v.replace(/[^\d]/g, '') : '';

  function isValidJPName(v) {
    if (!v) return false;
    if (/^_/.test(v)) return false;
    if (/issue|case|defect|문의|클레임/i.test(v)) return false;
    return true;
  }

  function isValidJPAddr2(v) {
    if (!v) return false;
    if (/^_/.test(v)) return false;
    if (/issue|case|defect|문의|클레임/i.test(v)) return false;
    return true;
  }

  /**********************************************************
   * KAT COMMIT (VALIDATION-SAFE)
   **********************************************************/
    async function commitKat(uniqueId, value) {
        if (!value) return false;

        const host = document.querySelector(`kat-input[unique-id="${uniqueId}"]`);
        const input = host?.shadowRoot?.querySelector('input,textarea');
        if (!host || !input) return false;

        const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
        ).set;

        // 1. Focus & set value
        input.focus();
        setter.call(input, value);

        // 2. React-standard events
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        // 3. Space key (required by some KAT validators)
        input.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true, composed: true,
            key: ' ', code: 'Space', keyCode: 32, which: 32
        }));
        input.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true, composed: true,
            key: ' ', code: 'Space', keyCode: 32, which: 32
        }));

        // 4. Restore exact value
        setter.call(input, value);

        // 5. Enter key (commit trigger)
        input.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true, composed: true,
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13
        }));
        input.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true, composed: true,
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13
        }));

        // 6. CRITICAL: bubble focus change to kat-input host
        input.dispatchEvent(new FocusEvent('focusout', {
            bubbles: true,
            composed: true,
            relatedTarget: null
        }));

        host.dispatchEvent(new FocusEvent('focusout', {
            bubbles: true,
            composed: true,
            relatedTarget: null
        }));

        input.blur();

        await sleep(300);
        return true;
    }


  async function setState(prefJP) {
    const prefEN = JP_STATE_MAP[prefJP];
    if (!prefEN) return;

    const dd = document.querySelector('kat-dropdown.japan-state');
    if (!dd) return;

    dd.click();
    await sleep(150);

    const opt = [...(dd.shadowRoot?.querySelectorAll('*') || [])].find(
      el => el.textContent?.trim() === prefEN
    );

    opt?.click();
    await sleep(150);
  }

  /**********************************************************
   * EMAIL EXTRACTION (AMAZON JP SAFE)
   **********************************************************/
    function extractCustomerContextEmail(text) {
        if (!text) return '';

        // Zendesk "Customer context" block:
        // Email
        // example@gmail.com
        const m = text.match(
            /\bEmail\s*\n\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i
        );

        return m ? m[1].trim() : '';
    }

    function extractBestEmail(text) {
        // 1️⃣ Customer context email has top priority
        const ctxEmail = extractCustomerContextEmail(text);
        if (ctxEmail) return ctxEmail;

        // 2️⃣ fallback: scan whole text
        const all = text.match(
            /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
        );
        if (!all) return '';

        // Prefer Amazon JP masked emails if exists
        const jp = all.filter(e =>
                              /@marketplace\.amazon\.co\.jp$/i.test(e)
                             );

        return jp.find(e => !/\+/.test(e)) || jp[0] || '';
    }


  /**********************************************************
   * PARSER
   **********************************************************/
    function parseJP(text) {
        const clean = text
        .replace(/\r/g, '')
        .replace(/[–—]/g, '-')
        .replace(/\u00A0/g, ' ');

        const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);

        let postal='', stateJP='', addr1='', addr2='', name='', phone='', asin='';

        // ---------- helpers ----------
        const emptyWords = /^(공란|なし|없음|blank|null|n\/a)$/i;

        const pickAfterColon = l =>
        l.includes(':') ? l.split(':').slice(1).join(':').trim() : '';

        // ---------- 1. LABEL-BASED PARSING ----------
        for (const line of lines) {
            const lower = line.toLowerCase();

            if (!postal && /(postal\s*code|郵便番号)/i.test(line)) {
                postal = pickAfterColon(line);
            }

            if (!stateJP && /(state|都道府県)/i.test(line)) {
                stateJP = pickAfterColon(line);
            }

            if (!addr1 && /(address\s*line\s*1|住所1)/i.test(line)) {
                addr1 = pickAfterColon(line);
            }

            if (!addr2 && /(address\s*line\s*2|住所2)/i.test(line)) {
                const v = pickAfterColon(line);
                if (!emptyWords.test(v) && isValidJPAddr2(v)) addr2 = v;
            }

            if (!name && /(full\s*name|氏名)/i.test(line)) {
                const v = pickAfterColon(line);
                if (isValidJPName(v)) name = v;
            }

            if (!phone && /(phone\s*number|電話番号)/i.test(line)) {
                phone = pickAfterColon(line);
            }
        }

        // ---------- 2. NUMBERED FALLBACK (existing logic) ----------
        const numbered = /^\s*\(?(\d+)\)?[.)]\s*(.+)$/;

        for (const line of lines) {
            const m = line.match(numbered);
            if (!m) continue;

            const idx = Number(m[1]);
            const val = m[2].replace(/^.*?:\s*/, '').trim();

            if (idx === 1 && !postal)  postal  = val;
            if (idx === 2 && !stateJP) stateJP = val;
            if (idx === 3 && !addr1)   addr1   = val;
            if (idx === 4 && !addr2 && isValidJPAddr2(val)) addr2 = val;
            if (idx === 5 && !name  && isValidJPName(val))  name  = val;
            if (idx === 6 && !phone)  phone  = val;
        }

        // ---------- 3. ASIN (unchanged) ----------
        const asinIdx = lines.findIndex(l => /\bASIN\b/i.test(l));
        if (asinIdx !== -1) {
            const next = lines[asinIdx + 1] || '';
            asin = (next.match(/^[A-Z0-9]{8,12}$/) || [])[0] || '';
        }

        return {
            postal: normalizePostalJP(postal),
            stateJP,
            addr1,
            addr2,
            name: (name || '').slice(0, 15),
            phone: normalizePhoneJP(phone),
            email: extractBestEmail(clean),
            asin
        };
    }


  /**********************************************************
   * GOOGLE SHEET
   **********************************************************/
  async function markRowMcfByEmail(email) {
    if (!email) return;
    await fetch(
      `${ORDER_ID_ENDPOINT}?email=${encodeURIComponent(
        email
      )}&action=markMcf&match=last`
    );
  }

  async function fetchOrderIdByEmail(email) {
    if (!email) return null;

    for (let i = 0; i < 2; i++) {
      const r = await fetch(
        `${ORDER_ID_ENDPOINT}?email=${encodeURIComponent(
          email
        )}&match=last`
      );
      const j = await r.json();
      if (j?.success && j.orderId) return j.orderId.trim();
      await sleep(500);
    }
    return null;
  }

  /**********************************************************
   * FILL JP MCF
   **********************************************************/
  async function fillJP(d) {
    await commitKat('katal-id-2', d.postal);
    await setState(d.stateJP);
    await sleep(200);
    await commitKat('katal-id-2', d.postal);

    await commitKat('katal-id-4', d.addr1);
    await commitKat('katal-id-5', d.addr2);
    await commitKat('katal-id-6', d.name);
    await commitKat('katal-id-7', d.phone);
    await commitKat('katal-id-8', d.email);

    if (d.asin) {
      const sku = document.getElementById('sku-search-input');
      if (sku) {
        sku.focus();
        sku.value = d.asin;
        sku.dispatchEvent(new Event('input', { bubbles: true }));
        sku.dispatchEvent(new Event('change', { bubbles: true }));
        sku.blur();
      }
    }

    if (d.email) {
      await markRowMcfByEmail(d.email);
      const orderId = await fetchOrderIdByEmail(d.email);
      if (orderId) await commitKat('katal-id-10', orderId);
    }

    LOG('JP MCF filled:', d);
  }

  /**********************************************************
   * UI
   **********************************************************/
  function mountUI() {
    const panel = document.createElement('div');
    panel.style.cssText = `
      position:fixed;
      top:12px;
      right:12px;
      z-index:2147483647;
      background:#0b0f0c;
      color:#00ff9c;
      border:1px solid #00ff9c;
      border-radius:10px;
      padding:10px;
      font:12px Consolas,monospace;
      box-shadow:0 0 12px rgba(0,255,156,.35);
    `;

    panel.innerHTML = `
      <b>Zendesk → JP MCF</b>
      <button id="jpPaste" style="margin-top:6px;width:100%">Paste</button>
    `;

    document.body.appendChild(panel);

    panel.querySelector('#jpPaste').onclick = async () => {
      const txt = await navigator.clipboard.readText();
      if (txt) await fillJP(parseJP(txt));
    };
  }

  const t = setInterval(() => {
    if (document.body) {
      clearInterval(t);
      mountUI();
    }
  }, 50);

  document.addEventListener('keydown', e => {
    if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      navigator.clipboard.readText().then(t => t && fillJP(parseJP(t)));
    }
  });
})();
