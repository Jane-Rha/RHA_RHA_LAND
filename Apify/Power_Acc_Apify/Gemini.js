/**********************************************************
 * CONFIG
 **********************************************************/
const SHEET_NAME = 'Defect';
const CACHE_TTL_SECONDS = 60 * 60 * 6;


/**********************************************************
 * MAIN FUNCTION
 **********************************************************/
function DR(inputText, category) {
  try {
    inputText = String(inputText || '').trim().toLowerCase();
    category = String(category || '').trim();

    if (!inputText || !category) return '';

    const cacheKey =
      'DR_v14_' +
      Utilities.base64Encode(inputText + '|' + category).slice(0, 100);

    const cache = CacheService.getScriptCache();
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

    // flash attempt 1
    output = callGeminiModel_(inputText, enrichedList, 'gemini-3.1-flash-preview');

    // flash retry
    if (!isValid_(output)) {
      output = callGeminiModel_(inputText, enrichedList, 'gemini-3.1-flash-preview');
    }

    // fallback → flash-lite
    if (!isValid_(output)) {
      output = callGeminiModel_(inputText, enrichedList, 'gemini-3.1-flash-lite-preview');
    }

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

    return '';

  } catch (e) {
    return '';
  }
}


/**********************************************************
 * GEMINI CALL (USING COLUMN C)
 **********************************************************/
function callGeminiModel_(inputText, enrichedList, model) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) return '';

    const prompt = `
You are classifying customer feedback into predefined categories.

Each category has a label and description.

Choose the MOST appropriate label based on meaning.

Categories:
${enrichedList.join('\n')}

Rules:
- Choose ONLY one label
- Return ONLY the label text (NOT description)

Input:
${inputText}
`;

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` +
      apiKey;

    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 20
        }
      }),
      muteHttpExceptions: true
    });

    const json = JSON.parse(res.getContentText());

    return (json.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || '')
      .join('')
      .trim();

  } catch (e) {
    return '';
  }
}


/**********************************************************
 * LOAD DEFECT DATA (NOW USES COLUMN C)
 **********************************************************/
function loadDefectData_(category) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) return { rawList: [], list: [], enrichedList: [] };

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { rawList: [], list: [], enrichedList: [] };

  const values = sh.getRange(2, 1, lastRow - 1, 3).getValues();

  const filtered = values.filter(r =>
    String(r[0]).trim() === category && r[1]
  );

  const rawList = filtered.map(r => String(r[1]).trim());
  const list = rawList.map(v => normalizeLoose_(v));

  // 🔥 핵심: label + description 결합
  const enrichedList = filtered.map(r => {
    const label = String(r[1]).trim();
    const desc = String(r[2] || '').trim();
    return `${label}: ${desc}`;
  });

  return { rawList, list, enrichedList };
}


/**********************************************************
 * KEYWORD FALLBACK
 **********************************************************/
function keywordFallback_(text) {
  if (text.includes('heavy') || text.includes('bulky')) return '두꺼움';
  if (text.includes('yellow')) return '황변';
  if (text.includes('button')) return '버튼불량';
  if (text.includes('attach') || text.includes('difficult')) return '부착어려움';
  return '';
}


/**********************************************************
 * HELPERS
 **********************************************************/
function isValid_(text) {
  return text && text.trim().length > 0;
}

function cleanOutput_(text) {
  return text.replace(/["'\n]/g, '').trim();
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
  const cache = CacheService.getScriptCache();
  cache.removeAll([]);
}