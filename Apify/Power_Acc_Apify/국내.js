function updateScoreSheet() {
  const scoreSS = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/1qs03gqcnDo9t94BrqPCcN0nYjCAE43sL7BmS8bB7kOQ/edit');
  const scoreSheet = scoreSS.getSheetByName('1-3점');
  
  const badReviewSS = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/1UVXNdfYlGxCCkhwhcmRZsxsHvctiAi6DX3LmuMk-DjU/edit');
  const badSheet = badReviewSS.getSheetByName('국내 고객배드리뷰');
  
  const badData = badSheet.getDataRange().getValues().slice(1); // 헤더 제외
  
  const tz = 'Asia/Seoul';
  const today = new Date();
  const formatDate = d => Utilities.formatDate(d, tz, 'yyyy. M. d');
  
  const output = badData.map(row => {
    const L = row[11]; // L열 (국내 고객배드리뷰 기준)
    const filled = L !== '' ? 'Y' : 'N';
    
    return [
      row[0],   // A
      row[1],   // B
      '', '', '', '', 
      row[5],   // G (F열)
      '', 
      filled,   // I (L열 여부 → Y/N)
      '', 
      row[4],   // K (E열)
      row[7],   // L (H열)
      row[7],   // M (H열)
      'KOREA',  // N
      '', '', 
      row[8],   // Q (I열)
      row[9],   // R (J열)
      formatDate(today), // S (오늘 날짜)
      'KR',     // T
      row[1],   // U (B열)
      filled,   // V (L열 여부 → Y/N)
      row[2],   // W (C열)
      row[3],   // X (D열)
      row[12],  // Y (M열)
      row[13],  // Z (N열)
      row[14],  // AA (O열)
      row[15]   // AB (P열)
    ];
  });
  
  if (output.length === 0) {
    Logger.log('이동할 데이터가 없습니다.');
    return;
  }
  
  // 기존 1-3점 시트는 새로 채우기 (덮어쓰기)
  scoreSheet.clearContents();
  scoreSheet.getRange(1,1,output.length,output[0].length).setValues(output);
}