// ── Trigger end date for this project ────────────────────────────────────────
const MASTER_END_DATE = '2026-06-30';

// ── Webhooks ──────────────────────────────────────────────────────────────────
const STATUS_WEBHOOK = 'https://chat.googleapis.com/v1/spaces/AAQAc9NQmJQ/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=T_rTrPKTYq6biglb8kRL3GOVfQg3AAOH-JPKELutbAY';
const GCX_WEBHOOK    = 'https://chat.googleapis.com/v1/spaces/AAQAT2QdNVY/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=zgIS4cZcPnnOzTGong5UecIOYyGgcJTb3UlkNZ_nrYc';

// ── All monitored projects ─────────────────────────────────────────────────────
// endDate: null  →  permanent (bar shows full + "permanent" label, no expiry countdown)
const TRIGGER_PROJECTS = [
  { name: 'Apify Master',  endDate: '2026-06-30', time: '04:00 KST (Mon–Fri)' },
  { name: '오전보고',      endDate: '2026-06-30', time: '09:00 KST (Mon–Fri)' },
  { name: 'TCT시트 보고',  endDate: '2026-06-30', time: '17:30 KST (Mon–Fri, Thu 15:30)' },
  { name: 'MCF Tracker',   endDate: null,          time: '09:00 KST (Mon–Fri, permanent)' },
  { name: 'ASIN Master',   endDate: null,          time: 'on-demand (permanent)' },
];

// ── Korean public holiday check via Google Calendar ───────────────────────────
// dateStr: 'YYYY-MM-DD'
function _isKoreanHoliday_(dateStr) {
  try {
    var d    = new Date(dateStr + 'T00:00:00+09:00');
    var next = new Date(d.getTime() + 24 * 3600 * 1000);
    var cal  = CalendarApp.getCalendarById('ko.south_korea#holiday@group.v.calendar.google.com');
    return cal.getEvents(d, next).length > 0;
  } catch (e) {
    Logger.log('Holiday check failed (fail-open): ' + e.message);
    return false; // fail open — don't skip the job if calendar is unavailable
  }
}

// ── Is today a working day? (KST weekday + not a Korean public holiday) ────────
function _isTodayWorkingDay_() {
  var kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  var day    = kstNow.getUTCDay(); // 0=Sun, 6=Sat (interpreted in KST via +9h shift)
  if (day === 0 || day === 6) return false;
  var dateStr = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  return !_isKoreanHoliday_(dateStr);
}

// ── Count remaining weekdays from tomorrow (KST) through endDateStr ───────────
// (Weekday-only count; holiday exclusion not applied here for performance)
function _countRemainingWeekdays_(endDateStr) {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const d   = new Date(kst);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  const end = new Date(endDateStr + 'T23:59:59+09:00');
  let count = 0;
  while (d <= end) {
    const day = d.getUTCDay();
    if (day >= 1 && day <= 5) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

// ── Display width: CJK/Korean chars count as 2, ASCII as 1 ──────────────────
function _displayWidth_(str) {
  var w = 0;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    var wide = (c >= 0xAC00 && c <= 0xD7AF) || // Korean syllables
               (c >= 0x4E00 && c <= 0x9FFF) || // CJK unified ideographs
               (c >= 0x3000 && c <= 0x303F) || // CJK symbols
               (c >= 0x3040 && c <= 0x30FF) || // Hiragana / Katakana
               (c >= 0xFF00 && c <= 0xFFEF);   // Fullwidth forms
    w += wide ? 2 : 1;
  }
  return w;
}

function _padToWidth_(str, targetWidth) {
  return str + ' '.repeat(Math.max(0, targetWidth - _displayWidth_(str)));
}

// ── ASCII bar: filled = remaining / maxDays scaled to barWidth chars ──────────
function _makeBar_(remaining, maxDays, barWidth) {
  const filled = Math.round(Math.min(remaining, maxDays) / maxDays * barWidth);
  return '█'.repeat(filled) + '░'.repeat(barWidth - filled);
}

// ── Build & send combined trigger-countdown bar chart to Google Chat ──────────
function sendAllTriggerStatus(webhookOverride) {
  const webhook  = webhookOverride || GCX_WEBHOOK;
  const kst      = new Date(Date.now() + 9 * 3600 * 1000);
  const todayStr = Utilities.formatDate(kst, 'UTC', 'yyyy-MM-dd (EEE)');

  const BAR_MAX = 20; // 20 weekdays ≈ 4 weeks = full bar
  const BAR_W   = 15;

  const rows = TRIGGER_PROJECTS.map(p => {
    if (!p.endDate) {
      return { name: p.name, rem: null, bar: '█'.repeat(BAR_W), icon: '✅ ', endDate: null, permanent: true };
    }
    const rem  = _countRemainingWeekdays_(p.endDate);
    const bar  = _makeBar_(rem, BAR_MAX, BAR_W);
    const icon = rem === 0 ? '🔴' : rem <= 5 ? '⚠️ ' : rem <= 10 ? '🔔 ' : '✅ ';
    return { name: p.name, rem, bar, icon, endDate: p.endDate, permanent: false };
  });

  const padLen     = Math.max(...rows.map(r => _displayWidth_(r.name)));
  const chartLines = rows.map(r => {
    const name = _padToWidth_(r.name, padLen);
    if (r.permanent) return `${r.icon} ${name}  ${r.bar}  permanent`;
    const cnt = String(r.rem).padStart(2);
    return `${r.icon} ${name}  ${r.bar}  ${cnt}d  (~ ${r.endDate})`;
  });

  const urgentRows = rows.filter(r => !r.permanent && r.rem <= 3 && r.rem > 0);
  const urgentNote = urgentRows.length
    ? '\n⚠️ *' + urgentRows.map(r => `${r.name}: ${r.rem}d left`).join(', ') + ' — 만료 임박*'
    : '';

  const text = [
    `*Trigger Timeline — ${todayStr}*`,
    '```',
    ...chartLines,
    '```',
    urgentNote,
  ].filter(l => l !== '').join('\n');

  const resp = UrlFetchApp.fetch(webhook, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: JSON.stringify({ text }),
    muteHttpExceptions: true,
  });
  Logger.log('Trigger status sent (HTTP %s) → %s', resp.getResponseCode(), webhook === STATUS_WEBHOOK ? 'STATUS room' : 'GCX room');
  rows.forEach(r => Logger.log('  %s: %s', r.name, r.permanent ? 'permanent' : r.rem + ' days remaining'));
}

// ── Test: send to STATUS_WEBHOOK (private room) instead of GCX ───────────────
function testSendTriggerStatus() {
  sendAllTriggerStatus(STATUS_WEBHOOK);
}

// ── Recreate all masterDailyJob triggers at 09:00 KST, skip weekends + holidays
function createTriggers() {
  const endDate = new Date(MASTER_END_DATE + 'T23:59:59+09:00');
  let date = new Date();
  date.setHours(4, 0, 0, 0); // 04:00 KST

  // Delete ALL existing masterDailyJob triggers in this project
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  let created = 0;
  const now = new Date();

  while (date <= endDate) {
    const dateStr = Utilities.formatDate(date, 'Asia/Seoul', 'yyyy-MM-dd');
    const day     = date.getDay(); // 0=Sun, 6=Sat
    const isWeekend = day === 0 || day === 6;

    if (!isWeekend && !_isKoreanHoliday_(dateStr) && date > now) {
      ScriptApp.newTrigger('masterDailyJob')
        .timeBased()
        .at(new Date(date))
        .create();
      Logger.log('Trigger set for: %s', dateStr);
      created++;
    } else if (isWeekend) {
      Logger.log('Skip (weekend): %s', dateStr);
    } else {
      Logger.log('Skip (holiday): %s', dateStr);
    }

    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
  }

  Logger.log('Created %s working-day 09:00 KST triggers until %s', created, MASTER_END_DATE);
}

// ── Daily entry point ─────────────────────────────────────────────────────────
function masterDailyJob() {
  if (!_isTodayWorkingDay_()) {
    Logger.log('Skipping — today is not a working day in Korea (%s)',
      Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd (EEE)'));
    return;
  }
  runAllScrapers();
  sendAllTriggerStatus();
}
