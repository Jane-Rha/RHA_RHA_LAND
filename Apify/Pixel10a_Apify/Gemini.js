/**********************************************************
 * CONFIG
 **********************************************************/
const SHEET_NAME = 'Defect';
const CACHE_TTL_SECONDS = 60 * 60 * 6; // 6 hours

const GEMINI_MODELS = ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];


/**********************************************************
 * Public custom function
 **********************************************************/
function DR(inputText) {
  try {
    inputText = String(inputText || '').trim();
    if (!inputText) return '';

    // cache version added (important)
    const cacheKey =
      'DR_v3_' +
      Utilities.base64Encode(inputText).slice(0, 100);

    const cache = CacheService.getScriptCache();
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const result = defectGemini_INTERNAL_(inputText);

    if (result) {
      cache.put(cacheKey, result, CACHE_TTL_SECONDS);
    }

    return result || '';

  } catch (err) {
    return 'ERROR: ' + (err.message || err);
  }
}


/**********************************************************
 * Read Defect list (formatted for prompt)
 **********************************************************/
function getInReasonListFromDefect_SHEET_() {
  const sh = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(SHEET_NAME);

  if (!sh) throw new Error('Sheet not found: ' + SHEET_NAME);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    throw new Error('인입사유 목록이 비어 있습니다');
  }

  const values = sh.getRange(2, 1, lastRow - 1, 3).getValues();

  return values
    .filter(r => r[1])
    .map(r => `- ${r[1]}${r[2] ? ': ' + r[2] : ''}`)
    .join('\n');
}


/**********************************************************
 * Read allowed list
 **********************************************************/
function getAllowedReasons_() {
  const sh = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(SHEET_NAME);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  return sh
    .getRange(2, 2, lastRow - 1, 1)
    .getValues()
    .flat()
    .filter(Boolean)
    .map(v => String(v).trim());
}


/**********************************************************
 * Gemini call + HARD FILTER
 **********************************************************/
function defectGemini_INTERNAL_(inputText) {
  const apiKey = PropertiesService
    .getScriptProperties()
    .getProperty('GEMINI_API_KEY');

  if (!apiKey) throw new Error('Missing GEMINI_API_KEY');

  const inReasonListText = getInReasonListFromDefect_SHEET_();

  const prompt = `역할
너는 Spigen 제품 리뷰/클레임을 내부 "인입사유"로 분류하는 분류기이다.

목표
고객 리뷰 내용을 분석하여 아래 인입사유 목록 중 가장 정확한 1개를 선택한다.

중요 규칙
- 반드시 아래 목록 중 EXACT MATCH로 1개만 선택
- 목록에 없는 단어 생성 금지
- 설명, 확률, 문장, 기호 출력 금지
- 내부 추론 과정 절대 출력 금지
- 반드시 인입사유 텍스트만 출력
- 출력은 정확히 한 줄

추가 규칙 (매우 중요)
- 일반 항목과 상세 항목이 동시에 존재할 경우:
  → 반드시 더 일반적인 항목을 선택
- "(MagSafe)"는 고객이 명확히 MagSafe 관련 문제를 언급한 경우에만 선택

허용된 인입사유 목록
${inReasonListText}

분석할 고객 리뷰
"""${inputText}"""`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 100
    }
  };

  let rawText = '';
  for (const model of GEMINI_MODELS) {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' +
      apiKey;

    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (res.getResponseCode() !== 200) continue;

    const json = JSON.parse(res.getContentText());
    rawText = (json.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || '')
      .join('')
      .trim();

    if (rawText) break;
  }

  if (!rawText) return '';

  /**********************************************************
   * HARD FILTER (FINAL FIX)
   **********************************************************/

  const cleaned = rawText
    .replace(/[\n\r"]/g, ' ')
    .replace(/[.。]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const normalized = cleaned
    .replace(/\(MagSafe\)/gi, '')
    .trim();

  const allowedList = getAllowedReasons_();

  // detect MagSafe intent from USER INPUT
  const isMagSafeContext = /magsafe|mag safe|자석|자력|magnet|磁石/i.test(inputText);

  // split allowed list
  const genericList = allowedList.filter(v => !/\(.*?\)/.test(v));

  // restrict label space BEFORE matching
  const candidateList = isMagSafeContext
    ? allowedList
    : genericList;

  // EXACT MATCH (use normalized)
  let exact = candidateList.find(v => normalized === v);
  if (exact) return exact;

  // GENERIC FIRST MATCH
  let matched = candidateList
    .slice()
    .sort((a, b) => a.length - b.length)
    .find(reason => normalized.includes(reason));

  if (matched) return matched;

  // FUZZY MATCH
  matched = candidateList.find(reason =>
    normalized.includes(reason) ||
    reason.includes(normalized)
  );

  if (matched) return matched;

  // FINAL FALLBACK
  return candidateList[0] || '';
}