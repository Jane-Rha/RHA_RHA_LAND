/***** ===== CONFIG (Galaxy S26) ===== *****/

/* ===== SHEET ===== */
const UPLOAD_SHEET_ID = '1fpv9TEDPGR8D6QRRc0ll-WzF7sOkfxe9UNBCmdBSE9g';
const UPLOAD_SHEET_NAME = '1-3점';

// "Update 날짜" index
const DATE_COL_INDEX_1BASED = 15;


/* ===== MONDAY BOARD ===== */
const BOARD_ID = 18399593191;   // 📌Galaxy S26 Case+CP
const MONDAY_API_URL = 'https://api.monday.com/v2';


/* ===== BOARD COLUMN IDS (Galaxy S26) ===== */

const LINK_COLUMN_ID = 'link_mm0fkspz';
const CLAIM_REVIEW_COLUMN_ID = 'color_mm0f7bwq';
const COUNTRY_COLUMN_ID = 'color_mm0fcch4';
const PHOTO_COLUMN_ID = 'color_mm0ffgz8';
const CHANNEL_COLUMN_ID = 'color_mm0ft7a5';


/* ===== SHEET HEADER NAMES ===== */
const ITEM_NAME_HEADER = 'Review Title';
const BODY_HEADER_TITLE = '본문';


/* ===== BEHAVIOR ===== */

const DRY_RUN = false;
const DEFAULT_CLAIM_REVIEW_LABEL = '리뷰';

const AUTO_TRANSLATE_BOARD_TITLE = '자동번역';
const AUTO_TRANSLATE_TARGET = 'ko';


/* ===== COLUMN OVERRIDES ===== */
const COLUMN_OVERRIDES_BY_TITLE = {
  'Review Link': LINK_COLUMN_ID
};


function getSpreadsheetId_() {
  return SpreadsheetApp.getActive().getId();
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

/* ===== GROUP MAPPING ===== */
const MODEL_HEADER_CANDIDATES = ['기종명', '모델명', 'Model', 'Model Name'];

const GROUP_TITLES = [
  'Galaxy S26',
  'Galaxy S26 Plus',
  'Galaxy S26 Ultra'
];


/* ===== SAFETY ===== */
const MONDAY_PAGE_LIMIT = 500;
const MAX_EXISTING_LINKS_SCAN = 2000;

const RETRY_MAX = 3;
const RETRY_BASE_MS = 300;


/***** ===== ENV ===== */
function _prop(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return (v == null || v === '') ? fallback : v;
}

const CONFIG = {
  pollIntervalMinutes: 1,
  pollMaxMinutes: 180,
  timezone: 'Asia/Seoul'
};
