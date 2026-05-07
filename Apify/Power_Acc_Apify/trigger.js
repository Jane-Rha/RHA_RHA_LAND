const APIFY_TRIGGER_WINDOW = {
  startDate: Utilities.formatDate(
    new Date(Date.now() + 24 * 60 * 60 * 1000), // today + 1 day
    'Asia/Seoul',
    'yyyy-MM-dd'
  ),
  endDate: '2026-01-14', // yyyy-MM-dd (inclusive)
  hour: 5,    // 05:30 KST
  minute: 30,
};

function createApifyWeekdayTriggers() {
  // Clean old triggers for this handler
  deleteApifyWeekdayTriggers();

  // Build date range in KST
  const tz = 'Asia/Seoul';
  const start = new Date(APIFY_TRIGGER_WINDOW.startDate + 'T00:00:00+09:00');
  const end   = new Date(APIFY_TRIGGER_WINDOW.endDate   + 'T23:59:59+09:00');

  let d = new Date(start);
  let created = 0;

  while (d <= end) {
    const day = d.getDay(); // 0 = Sunday, 6 = Saturday
    if (day !== 0 && day !== 6) {
      const runAt = new Date(d);
      runAt.setHours(APIFY_TRIGGER_WINDOW.hour, APIFY_TRIGGER_WINDOW.minute, 0, 0);

      // Create one-off trigger only on weekdays (Mon–Fri)
      ScriptApp.newTrigger('runApifyNowAndPollAfter2Hours')
        .timeBased()
        .at(runAt)
        .create();

      Logger.log('Apify weekday trigger set for: %s', Utilities.formatDate(runAt, tz, 'yyyy-MM-dd HH:mm:ss Z'));
      created++;
    } else {
      Logger.log('Skipped weekend: %s', Utilities.formatDate(d, tz, 'yyyy-MM-dd (EEE)'));
    }

    // Move to next day
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
  }

  Logger.log(
    'Created %s weekday triggers (%s:%s KST) from %s to %s.',
    created,
    String(APIFY_TRIGGER_WINDOW.hour).padStart(2, '0'),
    String(APIFY_TRIGGER_WINDOW.minute).padStart(2, '0'),
    APIFY_TRIGGER_WINDOW.startDate,
    APIFY_TRIGGER_WINDOW.endDate
  );
}

function deleteApifyWeekdayTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'runApifyNowAndPollAfter2Hours') {
      ScriptApp.deleteTrigger(t);
    }
  });
  Logger.log('Deleted existing runApifyNowAndPollAfter2Hours triggers (if any).');
}
