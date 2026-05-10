# Seller Central Review Scraper

Scrapes reviews from Amazon Seller Central and enriches each review with customer-attached image URLs. Top-level domains (US, EU, JP, IN) scrape in parallel; within EU, sub-countries scrape sequentially on one shared tab. Configurable per marketplace, star filter, detection avoidance level, and output columns.

## How it works

1. **Auto-launch Chrome** — Starts Chrome with a dedicated scraper profile (`~/.chrome-scraper-profile`) and remote debugging on port 9222. Sessions persist between runs — log in once, done.
2. **Session check** — Navigates to each SC portal and checks if the session is still valid. Skips the login step entirely for portals that are already authenticated.
3. **Login tabs** — Only for portals that need login: opens one tab per SC endpoint (US, EU, JP, IN). Complete login + OTP on all tabs, then press Enter (interactive) or wait for the countdown (background run).
4. **Parallel scraping** — Top-level domains (US, EU, JP, IN) each get their own tab and scrape simultaneously. EU sub-countries (DE → IT → FR → ES → UK) run **sequentially** on one shared tab — all EU countries share the same SC Europe session cookie so parallel tabs would race each other. DE scrapes first; all remaining countries reuse the same tab, switching marketplace via the account-switcher dropdown before each country. Reusing one tab keeps the SC Europe session active throughout the entire EU run. If the session expires between countries anyway, the script detects the login redirect, pauses up to `MID_RUN_LOGIN_WAIT_SECONDS` (default 120 s) for you to complete OTP, then retries the marketplace switch and current page automatically — no data is lost.
5. **Incremental CSV write** — Reviews are flushed to CSV after every page so no data is lost if the run is interrupted.
6. **Deduplication** — Removes duplicate Review IDs across page boundaries before image fetching.
7. **Image enrichment** — Navigates to the Amazon domain and fetches each review's detail page using in-browser `fetch()` with session cookies to extract customer-attached image URLs. **EU limitation**: only DE reviews get image URLs because the scraper Chrome profile has a customer session on amazon.de only. IT, FR, ES, and UK are skipped for image fetch until customer sessions for those domains are added to the profile.

## Prerequisites

```bash
pip install -r requirements.txt
playwright install chromium
```

> Chrome must be installed at `/Applications/Google Chrome.app` (default Mac path). Update `CHROME_PATH` in the config if yours differs.

## Usage

```bash
python3 scrape_sc_reviews.py
```

Or use the `/sc-scraper` Claude Code skill — it asks for all options interactively, edits the config, and runs the script automatically.

On first run Chrome opens automatically → log in to all SC accounts → press Enter. Subsequent runs reuse saved sessions and start scraping immediately.

---

## User Config

Edit the **USER CONFIG** section at the top of `scrape_sc_reviews.py`.

### `DOMAINS`

Marketplaces to scrape in parallel.

| Value | Marketplace | Output file | Notes |
|-------|-------------|-------------|-------|
| `"US"` | United States | `US_*.csv` | |
| `"EU"` | UK + DE + FR + IT + ES combined | `EU_*.csv` | Auto-expands; sub-countries scrape sequentially on one tab |
| `"UK"` | United Kingdom | `UK_*.csv` | Single-country run |
| `"DE"` | Germany | `DE_*.csv` | Single-country run |
| `"FR"` | France | `FR_*.csv` | Single-country run |
| `"IT"` | Italy | `IT_*.csv` | Single-country run |
| `"ES"` | Spain | `ES_*.csv` | Single-country run |
| `"JP"` | Japan | `JP_*.csv` | |
| `"IN"` | India | `IN_*.csv` | |

Default (all markets): `DOMAINS = ["US", "EU", "JP", "IN"]`

### `EU_COUNTRIES`

Controls which EU sub-countries are scraped when `"EU"` is in `DOMAINS`. Defaults to all five.

```python
EU_COUNTRIES = ["DE", "IT", "FR", "ES", "UK"]   # all (default)
EU_COUNTRIES = ["IT"]                             # Italy-only re-run
```

DE is always scraped first (Phase 1) if it's in the list. The remaining countries follow sequentially on the same tab (Phase 2). Removing DE from the list skips Phase 1 entirely — useful for appending a missed country to an existing EU CSV.

**Single-country re-run example** (append Italy to an existing EU CSV):
```python
DOMAINS       = ["EU"]
EU_COUNTRIES  = ["IT"]
APPEND_CSV    = True
PAGES         = 50
```

### `PAGES` / `PAGES_OVERRIDE`

`PAGES` is the default page limit per domain. `PAGES_OVERRIDE` lets you set different limits per domain.

```python
PAGES = 30                                    # 1,500 reviews at PAGE_SIZE=50
PAGES_OVERRIDE = {}                           # no overrides (default)
PAGES_OVERRIDE = {"US": 49, "JP": 10}        # US gets 49 pages, JP gets 10, others use PAGES
```

### `PAGE_SIZE`

Reviews per page. Supported: `25`, `50`, `100`.

```python
PAGE_SIZE = 50    # default — 50 reviews/page
```

### `START_PAGE` / `APPEND_CSV`

Resume an interrupted run without losing already-saved rows.

```python
START_PAGE = 1        # start from the beginning (default)
APPEND_CSV = False    # overwrite CSV on start (default)

# Resume example — pick up from page 20, keep existing rows:
START_PAGE = 20
APPEND_CSV = True
```

`APPEND_CSV = True` also controls EU Phase 1: when DE is in `EU_COUNTRIES`, setting `APPEND_CSV = True` appends DE rows to an existing EU CSV instead of rewriting it.

### `STAR_FILTER`

```python
STAR_FILTER = "1,2,3,4,5"   # all reviews (default)
STAR_FILTER = "1,2,3"        # critical reviews only
```

### `FETCH_IMAGES`

```python
FETCH_IMAGES = True    # fetch reviewer-attached image URLs (default)
FETCH_IMAGES = False   # skip image fetching (faster)
```

### `FETCH_IMAGES_ONLY`

Crash-recovery mode. Set to `True` to skip all scraping and re-run only the image fetch phase on already-saved CSVs.

```python
FETCH_IMAGES_ONLY = False   # normal run (default)
FETCH_IMAGES_ONLY = True    # skip scraping, re-fetch images on existing CSVs
```

### `MID_RUN_LOGIN_WAIT_SECONDS`

Seconds to wait when a login redirect is detected mid-scrape (e.g. session expired between EU countries). The script pauses, prints a warning, and retries automatically after the timer — no pages are skipped. Default: `120`.

### `DETECTION_AVOIDANCE`

| Level | Nav delay | Batch delay | Jitter | Batch size | Scroll | Use when |
|-------|-----------|-------------|--------|------------|--------|----------|
| `"LOW"` | 0.5–1.5s | 0.5–1.5s | 0–150ms | 20–30 | No | Testing / one-off |
| `"MEDIUM"` | 2.0–5.0s | 2.0–4.5s | 0–600ms | 15–22 | Yes | Daily scheduled runs |
| `"HIGH"` | 4.0–10.0s | 5.0–12.0s | 0–1200ms | 8–15 | Yes | Large scrapes / high frequency |

### `ASIN_FILTER_FILE`

Path to a plain-text file with one ASIN per line. Only reviews matching those ASINs appear in the output. `None` saves all reviews.

### `OUT_DIR`

Directory where CSVs are saved. Default: `~/Desktop`.

### `HEADERS_TO_INCLUDE`

Columns to keep in the output. `None` includes all 14 columns.

```python
HEADERS_TO_INCLUDE = ['ASIN', 'Created 날짜', 'Reviewer', 'Review Ratings',
                       'Review Title', '본문', 'Image URL']
```

Full column list: `ASIN` · `Created 날짜` · `사진 유무` · `Reviewer` · `Review Ratings` · `Review Title` · `본문` · `Product Rating` · `Ratings Count` · `Domain Code` · `국가` · `Review Link` · `Image URL` · `Review ID`

---

## Output CSV fields

| Field | Description |
|-------|-------------|
| `ASIN` | Child ASIN of the reviewed product |
| `Created 날짜` | Review date |
| `사진 유무` | `Y` if customer attached images, `N` otherwise |
| `Reviewer` | Reviewer display name |
| `Review Ratings` | Star rating (1–5) |
| `Review Title` | Review headline |
| `본문` | Full review body text |
| `Product Rating` | Overall product star rating |
| `Ratings Count` | Total ratings count for the product |
| `Domain Code` | Marketplace code (e.g. `US`, `JP`) |
| `국가` | Country code |
| `Review Link` | Direct link to the review |
| `Image URL` | Pipe-delimited full-resolution image URLs (if any) |
| `Review ID` | Amazon review ID (used for deduplication) |

---

## Adding a new marketplace

Add an entry to `_DOMAINS` in the script:

```python
"CA": {
    "sc_base":     "https://sellercentral.amazon.ca/brand-customer-reviews/",
    "amazon_home": "https://www.amazon.ca/",
    "review_url":  "https://www.amazon.ca/gp/customer-reviews/",
    "country":     "CA",
},
```

Then add `"CA"` to `DOMAINS` and run.

---

## Anti-bot measures

- Connects to an existing logged-in Chrome session (persistent profile, no bot fingerprint)
- Randomized delays between page navigations
- Human-like scroll simulation before each extraction (MEDIUM / HIGH)
- Random batch sizes for image fetching
- Per-request stagger (jitter) within each batch
- Realistic browser headers on all marketplace requests
- Same-origin `fetch()` with session cookies (indistinguishable from normal browsing)
- Deduplicates Review IDs before image fetching to prevent repeated requests
