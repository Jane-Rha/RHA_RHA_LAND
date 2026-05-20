const CONFIG = {
  sheetBaseName: 'Apify',
  timezone: 'Asia/Seoul',
  actorTaskIdOrSlug: 'TgpoNoMcN4a5bYsyX',
  datasetFormat: 'json',
  pollIntervalMinutes: 1,
  pollMaxMinutes: 180,
  TEST_MODE: false,
  POLL_DELAY: { hours: 2, minutes: 0 },
  TEST_POLL_DELAY: { hours: 0, minutes: 2 }
};

function getSpreadsheetId_() {
  return '1QC8Is6UvTnFXaOeXviKM_331i3Fo_CBIYx80VS696LI';
}


// const CHAT_WEBHOOK_URL = 'https://chat.googleapis.com/v1/spaces/AAQAc9NQmJQ/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=PSHPzKIgMGy6kVu1yWvFiE332iPfDNZHaBPAB3MmcMs'; // Private test ❤️
const CHAT_WEBHOOK_URL = 'https://chat.googleapis.com/v1/spaces/AAQAFjxOPoY/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=MHegeUf86uuXeDIRL9E9zaFp2ASPwk-CVXhF3u3JJTo'; // TCK GCX Spigen

function getPollDelayMs_() {
  const d = CONFIG.TEST_MODE ? CONFIG.TEST_POLL_DELAY : CONFIG.POLL_DELAY;
  const h = Number(d.hours || 0);
  const m = Number(d.minutes || 0);
  if (isNaN(h) || isNaN(m)) throw new Error('Invalid POLL_DELAY in CONFIG.');
  return (h * 60 + m) * 60 * 1000;
}

// Preferred headers (used by _overwriteSheet)
const PREFERRED_HEADERS = [
  'country',
  'date',
  'variantAsin',
  'productAsin',
  'productOriginalAsin',
  'username',
  'ratingScore',
  'reviewTitle',
  'reviewDescription',
  'reviewId',
  'reviewImages/0',
  'reviewImages/1',
  'reviewImages/2',
  'reviewImages/3',
  'reviewImages/4',
  'reviewImages/5',
  'reviewImages/6',
  'reviewImages/7',
  'reviewImages/8',
  'reviewImages/9',
  'reviewImages/10',
  'reviewUrl',
  'product/productPageReviews/0/variant',
  'totalCategoryRatings',
  'totalCategoryReviews',
  'filterByRating',
  'variantAttributes',
  'averageCustomerReviews',
];
