/*******************************************************
 * CONFIG (FIXED COLUMNS)
 *******************************************************/
const ORDER_SHEET_ID   = '1g6a-S7eeA1oY19aTEFhTNAyp2A5nLqLNkPRqOqriWfc';
const ORDER_SHEET_NAME = 'MCF 발송 로그';

const HEADER_ROW = 3;   // <-- Your real header row is ROW 3

const COL_EMAIL = 8;    // H
const COL_P     = 16;   // P (발송일자)
const COL_Q     = 17;   // Q (Order ID)
const COL_U     = 21;   // U (담당자)
const COL_S_FALLBACK = 19; // S (Status fallback)

/*******************************************************
 * Allowed header names for Status column
 *******************************************************/
const STATUS_HEADERS = [
  'status', '상태', '배송상태', '배송 상태', 'mcf', 'mcf 상태'
];

/*******************************************************
 * WEB APP ENTRY
 *******************************************************/
function doGet(e) {
  try {
    const email = (e?.parameter?.email || '').trim();
    const action = (e?.parameter?.action || '').trim();
    const matchMode = (e?.parameter?.match || 'first').trim().toLowerCase();

    if (!email) {
      return jsonResponse({ success: false, error: 'Missing email parameter' });
    }

    const ss = SpreadsheetApp.openById(ORDER_SHEET_ID);
    const sh = ss.getSheetByName(ORDER_SHEET_NAME);
    if (!sh) {
      return jsonResponse({
        success: false,
        error: 'Sheet not found: ' + ORDER_SHEET_NAME
      });
    }

    const lastRow = sh.getLastRow();
    if (lastRow < HEADER_ROW + 1) {
      return jsonResponse({ success: false, error: 'No data rows' });
    }

    /***********************************************
     * Find row index
     ***********************************************/
    const rowIndex = findRowByEmail_(sh, email, matchMode);
    if (rowIndex === -1) {
      return jsonResponse({
        success: false,
        error: 'Email not found: ' + email
      });
    }

    /***********************************************
     * Mark as MCF
     ***********************************************/
    if (action === 'markMcf') {
      const person = (e?.parameter?.person || '김지우').trim() || '김지우';
      markMcfRow_(sh, rowIndex, person);
      return jsonResponse({
        success: true,
        email,
        rowIndex,
        message: 'Row marked as MCF'
      });
    }

    /***********************************************
     * Poll Order ID (Q col)
     ***********************************************/
    const orderId = pollOrderId_(sh, rowIndex);
    if (!orderId) {
      return jsonResponse({
        success: false,
        error: 'Order ID still empty for email: ' + email,
        rowIndex
      });
    }

    return jsonResponse({
      success: true,
      orderId,
      email,
      rowIndex
    });

  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  }
}

/*******************************************************
 * Email row lookup (robust match)
 *******************************************************/
function findRowByEmail_(sh, email, matchMode) {
  const lastRow = sh.getLastRow();
  const startRow = HEADER_ROW + 1;
  const numRows = lastRow - HEADER_ROW;

  const values = sh.getRange(startRow, COL_EMAIL, numRows, 1).getValues();
  const target = email.toLowerCase().replace(/\s+/g, '');

  if (matchMode === 'last') {
    for (let i = values.length - 1; i >= 0; i--) {
      const cell = (values[i][0] || '').toString().trim().toLowerCase().replace(/\s+/g, '');
      if (cell === target) return startRow + i;
    }
  } else {
    for (let i = 0; i < values.length; i++) {
      const cell = (values[i][0] || '').toString().trim().toLowerCase().replace(/\s+/g, '');
      if (cell === target) return startRow + i;
    }
  }

  return -1;
}

/*******************************************************
 * Detect Status column dynamically (HEADER_ROW = 3)
 *******************************************************/
function getStatusCol_(sh) {
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
  const targets = STATUS_HEADERS.map(h => h.toLowerCase());

  for (let c = 0; c < headers.length; c++) {
    const h = (headers[c] || '').toString().trim().toLowerCase();
    if (targets.includes(h)) {
      Logger.log(`Status header matched at col ${c + 1} ("${headers[c]}")`);
      return c + 1;
    }
  }

  Logger.log(`Status header not found. Falling back to S=${COL_S_FALLBACK}`);
  return COL_S_FALLBACK;
}

/*******************************************************
 * Mark 담당자 + 날짜 + Status="MCF"
 *******************************************************/
function markMcfRow_(sh, rowIndex, person) {
  const statusCol = getStatusCol_(sh);

  const 담당자Cell = sh.getRange(rowIndex, COL_U);
  const 날짜Cell = sh.getRange(rowIndex, COL_P);
  const statusCell = sh.getRange(rowIndex, statusCol);

  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');

  Logger.log(
    `Marking row ${rowIndex} => 담당자(U=${COL_U}), 날짜(P=${COL_P}), StatusCol=${statusCol}`
  );

  담당자Cell.setValue(person || '김지우');


  날짜Cell.setValue(today);


  statusCell.setValue('MCF');

  SpreadsheetApp.flush();
}

/*******************************************************
 * Poll Order ID (Q col) for up to 10 seconds
 *******************************************************/
function pollOrderId_(sh, rowIndex) {
  for (let i = 0; i < 10; i++) {
    Utilities.sleep(1000);
    const value = sh.getRange(rowIndex, COL_Q).getDisplayValue().trim();
    if (value) return value;
  }
  return '';
}

/*******************************************************
 * JSON response
 *******************************************************/
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
