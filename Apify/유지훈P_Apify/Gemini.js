  const SHEET_NAME = 'Defect';                              
  const CACHE_TTL_SECONDS = 60 * 60 * 6;

  const GEMINI_MODELS = [
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite',
  ];

  function DR(inputText, category) {                                                              
    try {
      inputText = String(inputText || '').trim().toLowerCase();                                   
      category  = String(category  || '').trim();           

      if (category === '태블릿케이스') category = '휴대폰케이스';
      if (!inputText || !category) return '';
                                                                                                  
      // v17: invalidates all v16 cached empty results
      const cacheKey = 'DR_v18_' + Utilities.base64Encode(inputText + '|' + category).slice(0, 100);                                                                                           
      const cache  = CacheService.getScriptCache();
      const cached = cache.get(cacheKey);                                                         
      if (cached !== null) return cached;  // only hit when a previous call SUCCEEDED             
                                                                                                  
      const { rawList, list, enrichedList } = loadDefectData_(category);                          
      if (!rawList.length) return '';                                                             
                                                            
      // 1. Quick keyword check
      const fast = keywordFallback_(inputText);
      if (fast && rawList.includes(fast)) {
        cache.put(cacheKey, fast, CACHE_TTL_SECONDS);                                             
        return fast;
      }                                                                                           
                                                            
      // 2. Try each model; accept as soon as output matches the list exactly
      let lastValidOutput = '';
      for (const model of GEMINI_MODELS) {
        const raw = callGeminiModel_(inputText, enrichedList, model);                             
        if (!isValid_(raw)) continue;
                                                                                                  
        lastValidOutput = raw;                              
        const result = resolveOutput_(raw, rawList, list);
        if (result !== null) {                                                                    
          if (result === '모니터링대상아님') return '';
          cache.put(cacheKey, result, CACHE_TTL_SECONDS);                                         
          return result;                                    
        }                                                                                         
      }
                                                                                                  
      // 3. Partial/contains fallback on best available output
      if (lastValidOutput) {
        const normalized = normalizeLoose_(cleanOutput_(lastValidOutput));
        let bestIdx = -1, bestLen = 0;                                                            
        for (let i = 0; i < list.length; i++) {
          if (normalized.includes(list[i]) || list[i].includes(normalized)) {                     
            if (list[i].length > bestLen) { bestLen = list[i].length; bestIdx = i; }              
          }
        }                                                                                         
        if (bestIdx !== -1 && rawList[bestIdx] !== '모니터링대상아님') {
          const result = rawList[bestIdx];                                                        
          cache.put(cacheKey, result, CACHE_TTL_SECONDS);
          return result;                                                                          
        }                                                   
      }

      // Do NOT cache empty/failed results — allows a clean retry on next recalc                  
      return '';
                                                                                                  
    } catch (e) {                                           
      return '';
    }
  }

  // Returns the rawList value if output matches, null if no match                                
  function resolveOutput_(raw, rawList, list) {
    const normalized = normalizeLoose_(cleanOutput_(raw));                                        
    const idx = list.findIndex(v => v === normalized);      
    if (idx === -1) return null;
    return rawList[idx];                                                                          
  }
                                                                                                  
  function callGeminiModel_(inputText, enrichedList, model) {
    try {
      const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
      if (!apiKey) return '';                                                                     
  
      const prompt =                                                                              
        'You are classifying customer feedback into predefined categories.\n\n' +
        'Each category has a label and description.\n\n' +
        'Choose the MOST appropriate label based on meaning.\n\n' +                               
        'Categories:\n' + enrichedList.join('\n') +
        '\n\nRules:\n- Choose ONLY one label\n- Return ONLY the label text (NOT description)\n\n' 
  +                                                         
        'Input:\n' + inputText;                                                                   
                                                                                                  
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model +
                  ':generateContent?key=' + apiKey;                                               
                                                                                                  
      const res = UrlFetchApp.fetch(url, {
        method: 'post',                                                                           
        contentType: 'application/json',                    
        payload: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 20 }                               
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

  // ── Run this manually from the Apps Script editor to diagnose API issues ──────               
  function testDR() {
    const inputText  = '케이스가 너무 두껍고 버튼이 잘 안눌려요';  // ← change to a real review   
    const category   = '휴대폰케이스';                              // ← change to a real category
    const { rawList, list, enrichedList } = loadDefectData_(category);
                                                                                                  
    Logger.log('Category list: ' + rawList.join(', '));                                           
                                                                                                  
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');         
    Logger.log('API key present: ' + !!apiKey);             
                                                                                                  
    for (const model of GEMINI_MODELS) {
      const raw = callGeminiModel_(inputText, enrichedList, model);                               
      const result = resolveOutput_(raw, rawList, list);    
      Logger.log(`[${model}] raw="${raw}" → resolved="${result}"`);
    }                                                                                             
  }
                                                                                                  
  function loadDefectData_(category) {                      
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);                  
    if (!sh) return { rawList: [], list: [], enrichedList: [] };
                                                                                                  
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { rawList: [], list: [], enrichedList: [] };                          
                                                            
    const values = sh.getRange(2, 1, lastRow - 1, 3).getValues();                                 
  
    const filtered = values.filter(r =>                                                           
      String(r[0]).trim() === category &&                   
      r[1] &&
      String(r[1]).trim() !== '모니터링대상아님'
    );                                                                                            
  
    const rawList      = filtered.map(r => String(r[1]).trim());                                  
    const list         = rawList.map(v => normalizeLoose_(v));
    const enrichedList = filtered.map(r => {                                                      
      const label = String(r[1]).trim();
      const desc  = String(r[2] || '').trim();                                                    
      return label + ': ' + desc;                           
    });                                                                                           
  
    return { rawList, list, enrichedList };                                                       
  }                                                         

  function keywordFallback_(text) {
    if (text.includes('heavy') || text.includes('bulky')) return '두꺼움';
    if (text.includes('yellow'))                          return '황변';                          
    if (text.includes('button'))                          return '버튼불량';
    if (text.includes('attach') || text.includes('difficult')) return '부착어려움';               
    return '';                                              
  }                                                                                               
                                                            
  function isValid_(text)      { return !!text && text.trim().length > 0; }                       
  function cleanOutput_(text)  { return text.replace(/["'\n]/g, '').trim(); }
                                                                                                  
  function normalizeLoose_(text) {                          
    return String(text || '')                                                                     
      .toLowerCase()                                        
      .replace(/\s+/g, '')
      .replace(/[()]/g, '')
      .replace(/[^a-z0-9가-힣]/gi, '')
      .trim();                                                                                    
  }
                                                                                                  
  function clearDRCache() {                                 
    // Bump DR_v17_ → DR_v18_ in cacheKey above to invalidate all cached results
  }  