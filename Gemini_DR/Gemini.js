/**********************************************************
 * CONFIG
 **********************************************************/
const SHEET_NAME = 'Defect';
const CACHE_TTL_SECONDS = 60 * 60 * 6;
const DR_CACHE_VERSION = 'DR_v22_'; // bump this string to invalidate all cached results

const GEMINI_MODELS = [
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
];


/**********************************************************
 * MAIN FUNCTION — =dr(text) or =dr(text, category)
 **********************************************************/
function DR(inputText, category) {
  try {
    inputText = String(inputText || '').trim().toLowerCase();
    category  = String(category  || '').trim();

    if (!inputText) return '';

    const cacheKey =
      DR_CACHE_VERSION +
      Utilities.base64Encode(inputText + '|' + category).slice(0, 100);

    const cache  = CacheService.getScriptCache();
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { rawList, list, enrichedList } = loadDefectData_(category);

    if (!rawList.length) return '';

    /***********************
     * 1. KEYWORD FAST PATH
     ***********************/
    const fast = keywordFallback_(inputText);
    if (fast && rawList.includes(fast)) return fast;

    /***********************
     * 2. GEMINI FLOW
     ***********************/
    let output = '';
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const model of GEMINI_MODELS) {
      const r = callGeminiModel_(inputText, enrichedList, model);
      totalInputTokens  += r.inputTokens;
      totalOutputTokens += r.outputTokens;
      if (isValid_(r.text)) { output = r.text; break; }
    }

    Logger.log(
      `[DR] tokens — input: ${totalInputTokens}, output: ${totalOutputTokens}, ` +
      `total: ${totalInputTokens + totalOutputTokens} | ` +
      `"${inputText.slice(0, 60).replace(/\n/g, ' ')}…" → "${output.slice(0, 40)}"`
    );

    if (!isValid_(output)) return '';

    output = cleanOutput_(output);

    /***********************
     * 3. STRICT MATCH
     ***********************/
    const normalized = normalizeLoose_(output);
    const idx = list.findIndex(v => v === normalized);

    if (idx !== -1) {
      const result = rawList[idx];
      cache.put(cacheKey, result, CACHE_TTL_SECONDS);
      return result;
    }

    /***********************
     * 4. LOOSE CONTAINS MATCH
     ***********************/
    const looseIdx = list.findIndex(v =>
      normalized.includes(v) || v.includes(normalized)
    );

    if (looseIdx !== -1) {
      const result = rawList[looseIdx];
      cache.put(cacheKey, result, CACHE_TTL_SECONDS);
      return result;
    }

    return '';

  } catch (e) {
    return 'ERROR: ' + e.message;
  }
}


/**********************************************************
 * GEMINI CALL — returns { text, inputTokens, outputTokens }
 **********************************************************/
function callGeminiModel_(inputText, enrichedList, model) {
  const EMPTY = { text: '', inputTokens: 0, outputTokens: 0 };
  try {
    const apiKey = PropertiesService
      .getScriptProperties()
      .getProperty('GEMINI_API_KEY');

    if (!apiKey) { Logger.log('Missing GEMINI_API_KEY'); return EMPTY; }

    const prompt = `
You are classifying customer feedback into predefined categories.

Each category has:
- label
- description

Choose the MOST appropriate label.

Categories:
${enrichedList.join('\n')}

Rules:
- Return ONLY ONE label
- Return ONLY the label text
- No explanation
- No punctuation
- No quotes
- No markdown

Input:
${inputText}
`;

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 20,
        thinkingConfig: { thinkingBudget: 0 }
      }
    };

    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = res.getResponseCode();
    const body = res.getContentText();

    Logger.log('MODEL: ' + model + ' | STATUS: ' + code);

    if (code !== 200) return EMPTY;

    const json  = JSON.parse(body);
    const text  = (json.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || '')
      .join('')
      .trim();

    const usage = json.usageMetadata || {};
    const inputTokens  = usage.promptTokenCount     || 0;
    const outputTokens = usage.candidatesTokenCount || 0;

    Logger.log(`[DR] model=${model} in=${inputTokens} out=${outputTokens}`);

    return { text, inputTokens, outputTokens };

  } catch (e) {
    Logger.log('callGeminiModel_ ERROR: ' + e.message);
    return EMPTY;
  }
}


/**********************************************************
 * LOAD DEFECT DATA
 * If category is '' (omitted), all rows are included.
 **********************************************************/
function loadDefectData_(category) {
  const sh = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(SHEET_NAME);

  if (!sh) return { rawList: [], list: [], enrichedList: [] };

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { rawList: [], list: [], enrichedList: [] };

  const values = sh.getRange(2, 1, lastRow - 1, 3).getValues();

  const filtered = values.filter(r =>
    (!category || String(r[0]).trim() === category) && r[1]
  );

  const rawList     = filtered.map(r => String(r[1]).trim());
  const list        = rawList.map(v => normalizeLoose_(v));
  const enrichedList = filtered.map(r => {
    const label = String(r[1]).trim();
    const desc  = String(r[2] || '').trim();
    return `${label}: ${desc}`;
  });

  return { rawList, list, enrichedList };
}


/**********************************************************
 * KEYWORD FALLBACK
 **********************************************************/
function keywordFallback_(text) {
  if (text.includes('heavy') || text.includes('bulky'))      return '두꺼움';
  if (text.includes('yellow'))                                return '황변';
  if (text.includes('button'))                                return '버튼불량';
  if (text.includes('attach') || text.includes('difficult')) return '부착어려움';
  if (text.includes('scratch') || text.includes('scratched'))return '스크래치';
  return '';
}


/**********************************************************
 * HELPERS
 **********************************************************/
function isValid_(text) {
  return text && String(text).trim().length > 0;
}

function cleanOutput_(text) {
  return String(text || '').replace(/["'\n\r]/g, '').trim();
}


/**********************************************************
 * NORMALIZATION
 **********************************************************/
function normalizeLoose_(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9가-힣]/gi, '')
    .trim();
}


/**********************************************************
 * CACHE CLEAR
 **********************************************************/
function clearDRCache() {
  CacheService.getScriptCache().removeAll([]);
}


/**********************************************************
 * DEBUG
 **********************************************************/
function DEBUG_DR(inputText, category) {
  const result = { inputText, category, models: GEMINI_MODELS, output: '', error: '', logs: [] };

  try {
    inputText = String(inputText || '').trim().toLowerCase();
    category  = String(category  || '').trim();

    const data = loadDefectData_(category);
    result.matchedRows = data.rawList.length;
    result.rawList     = data.rawList.slice(0, 20);

    for (const model of GEMINI_MODELS) {
      result.logs.push('Trying: ' + model);
      const r = callGeminiModel_(inputText, data.enrichedList, model);
      result.logs.push(`Output: ${r.text} (in=${r.inputTokens} out=${r.outputTokens})`);

      if (isValid_(r.text)) {
        result.output = r.text;
        const normalized = normalizeLoose_(r.text);
        const idx = data.list.findIndex(v => v === normalized);
        result.finalResult = idx !== -1 ? data.rawList[idx] : null;
        if (idx === -1) result.error = 'No exact match after normalization';
        break;
      }
    }

    return JSON.stringify(result, null, 2);

  } catch (e) {
    result.error = e.message;
    return JSON.stringify(result, null, 2);
  }
}
