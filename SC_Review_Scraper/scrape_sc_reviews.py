#!/usr/bin/env python3
"""Scrape reviews from Amazon Seller Central with configurable options.

Edit the USER CONFIG section below, then run:
    python3 scrape_sc_reviews.py
"""

import asyncio, csv, random, os, sys
from collections import defaultdict
from datetime import datetime
sys.stdout.reconfigure(line_buffering=True)  # flush every print immediately when running in background
from playwright.async_api import async_playwright

# ═══════════════════════════════════════════════════════════════════════════════
# USER CONFIG — edit these before each run
# ═══════════════════════════════════════════════════════════════════════════════

DOMAINS = ["JP", "EU"]
# List of domains to scrape in parallel. Each gets its own CSV file.
# Single domain example : DOMAINS = ["US"]
# Supported             : "US" | "EU" | "UK" | "DE" | "FR" | "IT" | "ES" | "JP" | "IN"
# "EU" automatically scrapes UK + DE + FR + IT + ES in sequence using each
# country's marketplaceId and writes all reviews into one EU_*.csv file.

PAGES = 30
# Default max pages to scrape per domain.
# Total reviews ≈ PAGES × PAGE_SIZE.
# Override per-domain with PAGES_OVERRIDE below.

PAGES_OVERRIDE = {}
# Per-domain page limit. Domains not listed here use PAGES.
# UK and DE are EU sub-countries — their overrides apply when scraping "EU" too.

PAGE_SIZE = 50
# Number of reviews per page returned by Seller Central.
# Supported values: 25 | 50 | 100
# Higher values mean fewer page loads but larger DOM per page.

START_PAGE = 1
# Page to start from. Set > 1 to resume a previously interrupted run.
# When resuming, also set APPEND_CSV = True to avoid overwriting saved rows.

APPEND_CSV = True
# False — overwrites the CSV at the start (default, fresh run).
# True  — appends to an existing CSV without rewriting the header.
#          Use together with START_PAGE to resume an interrupted run.

STAR_FILTER = "1,2,3,4,5"
# Comma-separated star ratings to include.
# Critical reviews only: "1,2,3"   All reviews: "1,2,3,4,5"

OUT_DIR = os.path.expanduser("~/Desktop")
# Directory where CSVs are saved.
# Each domain is saved as <OUT_DIR>/<DOMAIN>_seller_central_reviews.csv

HEADERS_TO_INCLUDE = None
# Columns to keep in the output CSV. None → all columns (default).
# Example: ['ASIN', 'Reviewer', 'Review Ratings', 'Review Title', '본문', 'Image URL']
# Full list: ASIN | Created 날짜 | 사진 유무 | Reviewer | Review Ratings | Review Title
#            본문 | Product Rating | Ratings Count | Domain Code | 국가
#            Review Link | Image URL | Review ID

ASIN_FILTER_FILE = None
# Path to a .txt file containing one ASIN per line.
# Only reviews whose ASIN matches an entry in this file will be saved to CSV.
# None → save all reviews regardless of ASIN (default).
# Example: ASIN_FILTER_FILE = "/Users/kevinkim/Desktop/target_asins.txt"

FETCH_IMAGES = True
# True  — fetch reviewer-attached media URLs after all page scraping is done.
#         EU fetches images for all countries in one pass after UK→DE→FR→IT→ES.
# False — skip image fetching entirely (faster runs, Image URL column stays empty).

FETCH_IMAGES_ONLY = False
# True  — skip all scraping; just re-run the image fetch on existing CSV files.
#         Use this to recover after a browser crash that interrupted the image fetch.
#         DOMAINS and OUT_DIR must match the original run so the right CSVs are found.

LOGIN_WAIT_SECONDS = 300
# Seconds to wait for manual login when running non-interactively (background / no TTY).
# In interactive mode the script waits for Enter instead (no fixed timeout).

MID_RUN_LOGIN_WAIT_SECONDS = 120
# Seconds to wait when a login redirect is detected mid-scrape (session expired).
# The script pauses, lets you complete OTP, then retries the same page.
# In interactive mode it waits for Enter instead.

DETECTION_AVOIDANCE = "MEDIUM"
# LOW    — short delays, fastest runs, higher detection risk
# MEDIUM — randomized delays + scroll simulation (recommended for daily use)
# HIGH   — aggressive randomization + long delays (safest for large/frequent scrapes)

HEADLESS = False
# False (default) — auto-launches Chrome with SCRAPER_PROFILE_DIR; sessions persist
#                   between runs so you only need to log in once. Browser is visible.
# True            — launches headless Chromium using SCRAPER_PROFILE_DIR.
#                   Chrome must be fully closed before running in headless mode.

SCRAPER_PROFILE_DIR = os.path.expanduser("~/.chrome-scraper-profile")
# Dedicated Chrome profile for scraping. SC login sessions are saved here between runs.
# First run: Chrome opens → log in to all SC accounts → sessions persist automatically.
# Subsequent runs: Chrome opens with saved sessions → scraping starts after Enter.

CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# Path to the Chrome executable. Used only when HEADLESS = False.

# ═══════════════════════════════════════════════════════════════════════════════
# DOMAIN REGISTRY
# Add new marketplaces here as they are onboarded.
# EU domains (UK/DE/FR/IT/ES) share sellercentral-europe.amazon.com but each
# requires its own marketplaceId parameter. When DOMAINS = ["EU"], the scraper
# automatically loops through all EU_COUNTRIES and writes to one EU_*.csv.
# ═══════════════════════════════════════════════════════════════════════════════

# When "EU" is in DOMAINS, these sub-countries are scraped in order.
EU_COUNTRIES = ["IT", "FR", "ES", "UK"]
# DE is scraped first (alone); IT, FR, ES, UK then scrape simultaneously in parallel.

_DOMAINS = {
    "US": {
        "sc_base":     "https://sellercentral.amazon.com/brand-customer-reviews/",
        "amazon_home": "https://www.amazon.com/",
        "review_url":  "https://www.amazon.com/gp/customer-reviews/",
        "country":     "US",
    },
    # EU countries all share sellercentral-europe.amazon.com (one login session).
    # sc_display_name: account-switcher dropdown label for this country.
    # sc_mkid: Amazon standard marketplace ID — used to construct mons_sel_* URL params
    #          directly without relying on the dropdown UI for every country.
    "UK": {
        "sc_base":         "https://sellercentral-europe.amazon.com/brand-customer-reviews/",
        "sc_display_name": "United Kingdom",
        "sc_mkid":         "A1F83G8C2ARO7P",
        "amazon_home":     "https://www.amazon.co.uk/",
        "review_url":      "https://www.amazon.co.uk/gp/customer-reviews/",
        "country":         "UK",
        "image_fetch":     False,  # no amazon.co.uk customer session in scraper profile
    },
    "DE": {
        "sc_base":         "https://sellercentral-europe.amazon.com/brand-customer-reviews/",
        "sc_display_name": "Germany",
        "sc_mkid":         "A1PA6795UKMFR9",
        "amazon_home":     "https://www.amazon.de/",
        "review_url":      "https://www.amazon.de/gp/customer-reviews/",
        "country":         "DE",
    },
    "FR": {
        "sc_base":         "https://sellercentral-europe.amazon.com/brand-customer-reviews/",
        "sc_display_name": "France",
        "sc_mkid":         "A13V1IB3VIYZZH",
        "amazon_home":     "https://www.amazon.fr/",
        "review_url":      "https://www.amazon.fr/gp/customer-reviews/",
        "country":         "FR",
        "image_fetch":     False,  # no amazon.fr customer session in scraper profile
    },
    "IT": {
        "sc_base":         "https://sellercentral-europe.amazon.com/brand-customer-reviews/",
        "sc_display_name": "Italy",
        "sc_mkid":         "APJ6JRA9NG5V4",
        "amazon_home":     "https://www.amazon.it/",
        "review_url":      "https://www.amazon.it/gp/customer-reviews/",
        "country":         "IT",
        "image_fetch":     False,  # no amazon.it customer session in scraper profile
    },
    "ES": {
        "sc_base":         "https://sellercentral-europe.amazon.com/brand-customer-reviews/",
        "sc_display_name": "Spain",
        "sc_mkid":         "A1RKKUPIHCS9HS",
        "amazon_home":     "https://www.amazon.es/",
        "review_url":      "https://www.amazon.es/gp/customer-reviews/",
        "country":         "ES",
        "image_fetch":     False,  # no amazon.es customer session in scraper profile
    },
    "JP": {
        "sc_base":     "https://sellercentral.amazon.co.jp/brand-customer-reviews/",
        "amazon_home": "https://www.amazon.co.jp/",
        "review_url":  "https://www.amazon.co.jp/gp/customer-reviews/",
        "country":     "JP",
    },
    "IN": {
        "sc_base":     "https://sellercentral.amazon.in/brand-customer-reviews/",
        "amazon_home": "https://www.amazon.in/",
        "review_url":  "https://www.amazon.in/gp/customer-reviews/",
        "country":     "IN",
    },
}

# ═══════════════════════════════════════════════════════════════════════════════
# DETECTION AVOIDANCE PROFILES
# ═══════════════════════════════════════════════════════════════════════════════

_PROFILES = {
    "LOW": {
        "nav_delay":    (0.5,  1.5),
        "read_delay":   (0.3,  0.8),
        "batch_delay":  (0.5,  1.5),
        "fetch_jitter": (0,    150),
        "batch_min":    20,
        "batch_max":    30,
        "scroll":       False,
    },
    "MEDIUM": {
        "nav_delay":    (2.0,  5.0),
        "read_delay":   (1.0,  2.5),
        "batch_delay":  (2.0,  4.5),
        "fetch_jitter": (0,    600),
        "batch_min":    15,
        "batch_max":    22,
        "scroll":       True,
    },
    "HIGH": {
        "nav_delay":    (4.0, 10.0),
        "read_delay":   (2.0,  5.0),
        "batch_delay":  (5.0, 12.0),
        "fetch_jitter": (0,   1200),
        "batch_min":    8,
        "batch_max":    15,
        "scroll":       True,
    },
}

# ═══════════════════════════════════════════════════════════════════════════════
# INTERNALS — no changes needed below this line
# ═══════════════════════════════════════════════════════════════════════════════

ALL_HEADERS = [
    'ASIN', 'Created 날짜', '사진 유무', 'Reviewer', 'Review Ratings',
    'Review Title', '본문', 'Product Rating', 'Ratings Count',
    'Domain Code', '국가', 'Review Link', 'Image URL', 'Review ID',
]
IDX = {h: i for i, h in enumerate(ALL_HEADERS)}


def _normalize_date(s):
    """Normalize SC date strings to yyyy-mm-dd. Falls back to original on parse failure."""
    for fmt in ("%B %d, %Y", "%d %B %Y"):
        try:
            return datetime.strptime(s.strip(), fmt).strftime('%Y-%m-%d')
        except ValueError:
            pass
    return s


def _make_extract_js(domain_code, country):
    return f"""
() => {{
  const cards = document.querySelectorAll('.reviewContainer[data-testid]');
  const rows = [];
  cards.forEach(card => {{
    const reviewId    = card.getAttribute('data-testid').replace('review-', '');
    const rating      = card.querySelector('kat-star-rating.reviewRating')?.getAttribute('value') || '';
    const rdText      = card.querySelector('.css-g7g1lz')?.textContent?.trim() || '';
    const rdMatch     = rdText.match(/^Review by (.+?) on (.+)$/);
    const reviewer    = rdMatch?.[1] || '';
    const createdDate = rdMatch?.[2] || '';
    const titleEl     = card.querySelector('#' + reviewId + '-title');
    const title       = titleEl?.querySelector('b')?.textContent?.trim() || titleEl?.textContent?.trim() || '';
    const body        = (document.getElementById('review-content-' + reviewId)?.innerText || '').trim().replace(/\\n/g,' ');
    const reviewLink  = card.querySelector('kat-link[href*="customer-reviews/' + reviewId + '"]')?.getAttribute('href') || '';
    // Collect all meta label→value pairs from the review card detail rows.
    // Prefer 'Child ASIN'; fall back to 'ASIN' only when no child entry exists.
    // Also try extracting ASIN from the product link href (most reliable).
    let childAsin = '';
    const _meta = {{}};
    card.querySelectorAll('.css-yyccc7').forEach(r => {{
      const label = r.querySelector('.css-1ggdaz4')?.textContent?.trim();
      const divs  = r.querySelectorAll('div');
      const val   = [...divs].slice(1).map(d => d.textContent.trim()).filter(Boolean)[0] || '';
      if (label) _meta[label] = val;
    }});
    if (_meta['Child ASIN']) {{
      childAsin = _meta['Child ASIN'];
    }} else {{
      // Try extracting from the product link kat-link href (contains /dp/ASIN or ?ASIN=)
      const prodLink = card.querySelector('kat-link[href*="/dp/"], kat-link[href*="ASIN="]')?.getAttribute('href') || '';
      const asinFromLink = prodLink.match(/\\/dp\\/([A-Z0-9]{{10}})/)?.[1]
                        || new URLSearchParams(prodLink.split('?')[1] || '').get('ASIN') || '';
      childAsin = asinFromLink || _meta['ASIN'] || '';
    }}
    const pStarEl       = card.querySelector('.asinDetail kat-star-rating');
    const productRating = pStarEl?.getAttribute('value') || '';
    const ratingsCount  = pStarEl?.getAttribute('review') || '';
    // Derive actual domain/country from review link — more reliable than the
    // scraper-assigned value when a marketplace switch silently falls back.
    let domainCode = '{domain_code}';
    let countryCode = '{country}';
    if (reviewLink) {{
      const m = reviewLink.match(/amazon\\.(com(?!\\.)|co\\.uk|co\\.jp|de|fr|it|es|in)/);
      if (m) {{
        const _map = {{'com':'US','co.uk':'UK','co.jp':'JP','de':'DE','fr':'FR','it':'IT','es':'ES','in':'IN'}};
        if (_map[m[1]]) {{ domainCode = _map[m[1]]; countryCode = _map[m[1]]; }}
      }}
    }}
    rows.push([childAsin, createdDate, 'N', reviewer, rating, title, body,
               productRating, ratingsCount, domainCode, countryCode, reviewLink, '', reviewId]);
  }});
  return rows;
}}
"""


SCROLL_JS = """
() => new Promise(resolve => {
  const maxScroll = document.body.scrollHeight * 0.75;
  let pos = 0;
  const cap = setTimeout(resolve, 5000);  // hard cap: always resolves within 5 s
  const tick = () => {
    pos += Math.random() * 180 + 60;
    window.scrollTo(0, Math.min(pos, maxScroll));
    if (pos < maxScroll) setTimeout(tick, Math.random() * 120 + 60);
    else { clearTimeout(cap); resolve(); }
  };
  tick();
})
"""


def _make_batch_fetch_js(review_url_base):
    return f"""
async (args) => {{
  const reviewIds = args[0];
  const jitterMin = args[1];
  const jitterMax = args[2];
  const results = {{}};
  await Promise.all(reviewIds.map(async (id, idx) => {{
    await new Promise(r => setTimeout(r, idx * (Math.random() * (jitterMax - jitterMin) + jitterMin)));
    try {{
      const resp = await fetch('{review_url_base}' + id, {{
        credentials: 'include',
        headers: {{
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': '{review_url_base}',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin',
          'Upgrade-Insecure-Requests': '1'
        }}
      }});
      const html = await resp.text();
      const doc  = new DOMParser().parseFromString(html, 'text/html');
      const tiles = doc.querySelectorAll('[data-hook="review-image-tile"]');
      results[id] = [...tiles].map(el => {{
        const src = el.getAttribute('src') || el.querySelector('img')?.getAttribute('src') || '';
        return src.replace(/\\._[A-Z0-9_,]+_\\./, '.');
      }}).filter(Boolean);
    }} catch(e) {{
      results[id] = [];
    }}
  }}));
  return results;
}}
"""


async def simulate_reading(page, prof):
    if prof["scroll"]:
        try:
            await page.evaluate(SCROLL_JS)
        except Exception:
            pass
    await asyncio.sleep(random.uniform(*prof["read_delay"]))


def _out_file(domain):
    return os.path.join(OUT_DIR, f"{domain}_seller_central_reviews.csv")


def _csv_write_header(path, headers):
    """Create/overwrite CSV with header row only."""
    with open(path, 'w', newline='', encoding='utf-8-sig') as f:
        csv.writer(f).writerow(headers)


def _csv_append_rows(path, rows):
    """Append rows to an existing CSV (no header)."""
    with open(path, 'a', newline='', encoding='utf-8-sig') as f:
        csv.writer(f).writerows(rows)


def _csv_rewrite(path, headers, rows):
    """Full rewrite — used at end to apply image data to all rows."""
    with open(path, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(headers)
        w.writerows(rows)


async def _switch_sc_marketplace(page, display_name, prof):
    """Switch SC Europe to a specific marketplace via the two-level account switcher.

    Flow:
      1. Navigate to /home (dropdown only renders account items here).
      2. Click header to open the account list.
      3. Click "Spigen EU" — this EXPANDS its country sub-list (no navigation).
      4. Click the target country item (indented) — this DOES navigate.
      5. Capture mons_sel_* URL params, then navigate to reviews with target mkid.
    """
    print(f"  Switching SC marketplace → {display_name} ...", end=" ", flush=True)
    from urllib.parse import urlparse, parse_qs
    target_dc = next((v for v in _DOMAINS.values()
                      if v.get("sc_display_name") == display_name), None)
    target_mkid = target_dc.get("sc_mkid", "") if target_dc else ""
    try:
        await page.goto("https://sellercentral-europe.amazon.com/home",
                        wait_until="domcontentloaded", timeout=30000)

        # Guard: if session expired, wait for re-login then retry (up to 3 attempts).
        for _attempt in range(3):
            if not any(x in page.url for x in ["/ap/", "signin", "mfa"]):
                break
            print(f"\n  ⚠  SC Europe session expired before switching to {display_name}.")
            print(f"  Complete login + OTP in Chrome — scraper will retry automatically.")
            if sys.stdin.isatty():
                input(f"  Press Enter after logging in... ")
            else:
                for _s in range(MID_RUN_LOGIN_WAIT_SECONDS, 0, -1):
                    print(f"  {_s}s remaining …  ", end="\r", flush=True)
                    await asyncio.sleep(1)
                print()
            await page.goto("https://sellercentral-europe.amazon.com/home",
                            wait_until="domcontentloaded", timeout=30000)

        await page.wait_for_selector('.dropdown-account-switcher-header', timeout=15000)
        await asyncio.sleep(0.5)

        # Run the full dropdown interaction in a single JS evaluate to avoid CDP
        # round-trip delays that let the dropdown auto-close between steps.
        # Sequence: click header → wait for Spigen EU → click Spigen EU →
        # wait for country sub-list → click target country (triggers navigation).
        # The evaluate will throw "context destroyed" when navigation fires — that's expected.
        try:
            async with page.expect_navigation(timeout=15000):
                try:
                    await page.evaluate(f"""
                        async () => {{
                            const header = document.querySelector('.dropdown-account-switcher-header');
                            if (!header) throw new Error('no header');
                            header.click();

                            const waitFor = (selector, text, maxMs=5000) => new Promise((resolve, reject) => {{
                                const start = Date.now();
                                const iv = setInterval(() => {{
                                    const el = [...document.querySelectorAll(selector)]
                                        .find(e => e.textContent.trim() === text);
                                    if (el) {{ clearInterval(iv); resolve(el); return; }}
                                    if (Date.now() - start > maxMs) {{ clearInterval(iv); reject(new Error('timeout: ' + text)); }}
                                }}, 80);
                            }});

                            const spigen = await waitFor('.dropdown-account-switcher-list-item-label', 'Spigen EU');
                            spigen.click();

                            const country = await waitFor('.dropdown-account-switcher-list-item-indented', '{display_name}');
                            country.click();
                        }}
                    """)
                except Exception:
                    pass  # "Execution context destroyed" when navigation fires — expected
        except Exception as e:
            print(f"WARN: country navigation failed ({e}) — falling back to mkid-only")
            return f"mons_sel_mkid={target_mkid}" if target_mkid else ""
        await asyncio.sleep(0.3)

        # Capture mons_sel_* params from the landed URL.
        # Use the exact mkid from the URL (includes amzn1.mp.o. prefix SC requires).
        qs = parse_qs(urlparse(page.url).query, keep_blank_values=True)
        dir_mcid  = qs.get("mons_sel_dir_mcid", [""])[0]
        mkid_from_url = qs.get("mons_sel_mkid",     [""])[0]

        if dir_mcid and mkid_from_url:
            mons_params = f"mons_sel_dir_mcid={dir_mcid}&mons_sel_mkid={mkid_from_url}"
            await page.goto(
                f"https://sellercentral-europe.amazon.com/brand-customer-reviews/?{mons_params}",
                wait_until="domcontentloaded", timeout=30000,
            )
            await asyncio.sleep(random.uniform(*prof["read_delay"]))
            print("done")
            return mons_params

        result_params = "&".join(f"{k}={v[0]}" for k, v in qs.items() if k.startswith("mons_sel"))
        if result_params:
            print(f"done (params: {result_params})")
            return result_params

        if target_mkid:
            print("done (mkid-only fallback)")
            return f"mons_sel_mkid={target_mkid}"

        print("WARN: could not determine marketplace params")
        return ""

    except Exception as e:
        print(f"WARN: marketplace switch failed ({e})")
        return f"mons_sel_mkid={target_mkid}" if target_mkid else ""


async def _enrich_rows_with_images(all_rows, dc, page, prof):
    """Fetch reviewer images for rows from a single domain. Enriches rows in-place."""
    if not all_rows:
        return 0
    fetch_js  = _make_batch_fetch_js(dc["review_url"])
    jitter    = prof["fetch_jitter"]
    batch_min = prof["batch_min"]
    batch_max = prof["batch_max"]

    print(f"  Switching to {dc['amazon_home']} for image fetching …")
    await page.goto(dc["amazon_home"], wait_until="domcontentloaded", timeout=30000)
    await asyncio.sleep(random.uniform(1.5, 3.0))

    review_ids = [row[IDX['Review ID']] for row in all_rows]
    id_to_row  = {row[IDX['Review ID']]: row for row in all_rows}
    total      = 0
    i          = 0

    print(f"  Image fetch     : batches {batch_min}–{batch_max}, jitter {jitter[0]}–{jitter[1]}ms")
    while i < len(review_ids):
        batch = review_ids[i:i + random.randint(batch_min, batch_max)]
        try:
            results = await page.evaluate(fetch_js, [batch, jitter[0], jitter[1]])
        except Exception as _err:
            if "closed" in str(_err).lower():
                raise
            print(f"  WARN image batch failed ({_err}) — re-navigating and retrying …")
            try:
                await page.goto(dc["amazon_home"], wait_until="domcontentloaded", timeout=30000)
                await asyncio.sleep(random.uniform(1.5, 3.0))
                results = await page.evaluate(fetch_js, [batch, jitter[0], jitter[1]])
            except Exception:
                results = {}
        for rid, imgs in results.items():
            if imgs and rid in id_to_row:
                id_to_row[rid][IDX['사진 유무']] = 'Y'
                id_to_row[rid][IDX['Image URL']] = '|'.join(imgs)
                total += 1
        i   += len(batch)
        done = min(i, len(review_ids))
        print(f"    {done}/{len(review_ids)}  ({total} with images)")
        if done < len(review_ids):
            await asyncio.sleep(random.uniform(*prof["batch_delay"]))
    return total


async def _enrich_csv_with_images(csv_path, page, prof):
    """Read csv_path, fetch reviewer images grouped by Domain Code, rewrite the file.

    Used by the EU flow to run image fetching for all countries in one pass
    after all page scraping is complete.
    """
    if not os.path.exists(csv_path):
        return 0

    with open(csv_path, encoding='utf-8-sig') as f:
        reader  = csv.reader(f)
        headers = next(reader, None)
        rows    = list(reader)

    if not headers or not rows:
        return 0

    file_idx = {h: idx for idx, h in enumerate(headers)}
    if 'Domain Code' not in file_idx or 'Review ID' not in file_idx:
        print(f"  SKIP image fetch — Domain Code / Review ID column missing in {csv_path}")
        return 0

    dc_col    = file_idx['Domain Code']
    rid_col   = file_idx['Review ID']
    img_col   = file_idx.get('Image URL')
    photo_col = file_idx.get('사진 유무')

    by_domain = defaultdict(list)
    for i, row in enumerate(rows):
        by_domain[row[dc_col]].append(i)

    jitter    = prof["fetch_jitter"]
    batch_min = prof["batch_min"]
    batch_max = prof["batch_max"]
    total     = 0

    for dc_code, row_indices in by_domain.items():
        if dc_code not in _DOMAINS:
            print(f"  SKIP [{dc_code}] — not in domain registry")
            continue
        if not _DOMAINS[dc_code].get("image_fetch", True):
            print(f"  SKIP [{dc_code}] — no customer session for image fetch (amazon.{dc_code.lower()} not logged in)")
            continue
        dc       = _DOMAINS[dc_code]
        fetch_js = _make_batch_fetch_js(dc["review_url"])

        print(f"\n  Image fetch [{dc_code}] : navigating to {dc['amazon_home']} …")
        await page.goto(dc["amazon_home"], wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(random.uniform(1.5, 3.0))

        review_ids = [rows[i][rid_col] for i in row_indices]
        id_to_idx  = {rows[i][rid_col]: i for i in row_indices}

        print(f"  Image fetch     : {len(review_ids)} reviews, batches {batch_min}–{batch_max}, jitter {jitter[0]}–{jitter[1]}ms")
        i = 0
        while i < len(review_ids):
            batch = review_ids[i:i + random.randint(batch_min, batch_max)]
            try:
                results = await page.evaluate(fetch_js, [batch, jitter[0], jitter[1]])
            except Exception as _err:
                if "closed" in str(_err).lower():
                    raise
                print(f"  WARN image batch failed ({_err}) — re-navigating and retrying …")
                try:
                    await page.goto(dc["amazon_home"], wait_until="domcontentloaded", timeout=30000)
                    await asyncio.sleep(random.uniform(1.5, 3.0))
                    results = await page.evaluate(fetch_js, [batch, jitter[0], jitter[1]])
                except Exception:
                    results = {}
            for rid, imgs in results.items():
                if imgs and rid in id_to_idx:
                    row_i = id_to_idx[rid]
                    if photo_col is not None:
                        rows[row_i][photo_col] = 'Y'
                    if img_col is not None:
                        rows[row_i][img_col] = '|'.join(imgs)
                    total += 1
            i   += len(batch)
            done = min(i, len(review_ids))
            print(f"    [{dc_code}] {done}/{len(review_ids)}  ({total} total with images)")
            if done < len(review_ids):
                await asyncio.sleep(random.uniform(*prof["batch_delay"]))

        # Flush after each country so a crash mid-run doesn't lose already-fetched images.
        _csv_rewrite(csv_path, headers, rows)
        print(f"    [{dc_code}] images saved to CSV")
    return total


async def scrape_domain(domain, page, ctx, prof, asin_filter, out_file=None, append=False, pages=None, skip_images=False, mkp_params=""):
    """Scrape one domain end-to-end. Returns (total_rows, total_with_imgs).

    out_file    : override output path (used by EU group to share one CSV).
    append      : skip header write and load existing rows from out_file first
                  (used for EU sub-countries 2-5 so they append to the shared file).
    pages       : page limit for this domain (overrides PAGES global).
    skip_images : defer image fetching to the caller (used by EU so images are
                  fetched for all countries in one pass after all scraping is done).
                  Ignored when FETCH_IMAGES = False.
    mkp_params  : pre-captured mons_sel_* URL params from a prior marketplace switch.
                  When provided, skips the internal dropdown switch and embeds these
                  params in every page URL so the tab stays locked to the right
                  marketplace even if a parallel tab changes the shared session cookie.
    """
    pages      = pages if pages is not None else PAGES
    dc         = _DOMAINS[domain]
    out_file   = out_file or _out_file(domain)
    extract_js = _make_extract_js(domain, dc["country"])
    params     = f"?pageSize={PAGE_SIZE}&stars={STAR_FILTER}"
    if mkp_params:
        params += f"&{mkp_params}"

    print(f"\n{'═'*60}")
    print(f"  Domain : {domain}  ({dc['sc_base']})")
    print(f"  Pages  : {pages}  |  Page size: {PAGE_SIZE}  |  Stars: {STAR_FILTER}  |  Output: {out_file}")
    print(f"{'═'*60}")

    # Switch SC marketplace via UI dropdown if needed.
    # Skipped when mkp_params is already provided by the caller (EU parallel flow).
    if "sc_display_name" in dc and not mkp_params:
        captured = await _switch_sc_marketplace(page, dc["sc_display_name"], prof)
        if captured:
            params += f"&{captured}"

    # ── Step 1: scrape pages — write header once, append after each page ──
    if APPEND_CSV or append:
        # Resume / EU-group append: read existing rows for dedup + image enrichment
        all_rows = []
        if os.path.exists(out_file):
            with open(out_file, encoding='utf-8-sig') as f:
                reader = csv.reader(f)
                next(reader, None)  # skip header
                all_rows = list(reader)
            label = "Resume mode" if APPEND_CSV else "Appending to shared file"
            print(f"  {label}   : loaded {len(all_rows)} existing rows from CSV")
    else:
        _csv_write_header(out_file, ALL_HEADERS)
        all_rows = []

    p = START_PAGE
    _t_retries = 0  # retry counter for transient Playwright race-condition errors
    while p <= pages:
        url = dc["sc_base"] + params + (f"&pageNumber={p}" if p > 1 else "")
        print(f"  Page {p}/{pages} …", end=" ", flush=True)
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_selector('.reviewContainer[data-testid]', timeout=15000)
        except Exception as e:
            if "list.remove" in str(e) and _t_retries < 2:
                _t_retries += 1
                await asyncio.sleep(1)
                continue  # retry same page
            _t_retries = 0
            if "closed" in str(e).lower():
                raise  # browser disconnected — abort this domain immediately
            cur_url = page.url
            if any(x in cur_url for x in ["/ap/", "signin", "mfa"]):
                print(f"LOGIN REDIRECT detected — session expired on page {p}")
                print(f"  ⚠  Complete login + OTP in Chrome now.")
                if sys.stdin.isatty():
                    input(f"  Press Enter after logging in to retry page {p}... ")
                else:
                    print(f"  Waiting {MID_RUN_LOGIN_WAIT_SECONDS}s for login, then retrying page {p}...")
                    for remaining in range(MID_RUN_LOGIN_WAIT_SECONDS, 0, -1):
                        print(f"  {remaining}s remaining …  ", end="\r", flush=True)
                        await asyncio.sleep(1)
                    print()
                continue  # retry same page — do NOT increment p
            print(f"SKIP (timeout/error: {e})")
            p += 1
            continue
        _t_retries = 0
        await simulate_reading(page, prof)
        try:
            rows = await page.evaluate(extract_js)
        except Exception as e:
            if "list.remove" in str(e) and _t_retries < 2:
                _t_retries += 1
                await asyncio.sleep(1)
                continue  # retry same page from goto
            _t_retries = 0
            raise
        di = IDX['Created 날짜']
        for row in rows:
            row[di] = _normalize_date(row[di])
        print(f"{len(rows)} reviews  →  flushed to CSV")
        all_rows.extend(rows)
        _csv_append_rows(out_file, rows)   # ← incremental write after every page
        p += 1
        if p <= pages:
            await asyncio.sleep(random.uniform(*prof["nav_delay"]))

    print(f"\n  Total collected : {len(all_rows)}")

    # ── Step 2: deduplicate ───────────────────────────────────────────────
    seen, unique = set(), []
    for row in all_rows:
        rid = row[IDX['Review ID']]
        if rid and rid not in seen:
            seen.add(rid); unique.append(row)
    if len(all_rows) - len(unique):
        print(f"  Dedup           : removed {len(all_rows)-len(unique)} duplicates → {len(unique)} unique")
    all_rows = unique

    # ── Step 3: image enrichment (skipped for EU — caller runs _enrich_csv_with_images) ──
    total_with_imgs = 0
    if FETCH_IMAGES and not skip_images:
        total_with_imgs = await _enrich_rows_with_images(all_rows, dc, page, prof)

    # ── Step 4: ASIN filter ───────────────────────────────────────────────
    if asin_filter:
        before   = len(all_rows)
        all_rows = [r for r in all_rows if r[IDX['ASIN']] in asin_filter]
        print(f"  ASIN filter     : kept {len(all_rows)}/{before}")

    # ── Step 5: column filter ─────────────────────────────────────────────
    if HEADERS_TO_INCLUDE:
        keep_idx    = [IDX[h] for h in HEADERS_TO_INCLUDE if h in IDX]
        out_headers = [ALL_HEADERS[k] for k in keep_idx]
        out_rows    = [[row[k] for k in keep_idx] for row in all_rows]
    else:
        out_headers = ALL_HEADERS
        out_rows    = all_rows

    # ── Step 6: final rewrite with image data ─────────────────────────────
    # out_rows already contains all rows (previous countries loaded at start +
    # newly scraped), so no read-back needed even in append mode.
    _csv_rewrite(out_file, out_headers, out_rows)
    print(f"\n  ✓ {domain} done — {total_with_imgs}/{len(all_rows)} with images → {out_file}")

    return len(all_rows), total_with_imgs


async def main():
    if DETECTION_AVOIDANCE not in _PROFILES:
        raise ValueError("DETECTION_AVOIDANCE must be LOW, MEDIUM, or HIGH.")
    unknown = [d for d in DOMAINS if d not in _DOMAINS and d != "EU"]
    if unknown:
        raise ValueError(f"Unknown domain(s): {unknown}. Choose from: EU | {list(_DOMAINS)}")

    prof = _PROFILES[DETECTION_AVOIDANCE]

    asin_filter = None
    if ASIN_FILTER_FILE:
        with open(os.path.expanduser(ASIN_FILTER_FILE), encoding='utf-8') as af:
            asin_filter = {line.strip() for line in af if line.strip()}
        print(f"ASIN filter loaded: {len(asin_filter)} ASINs from {ASIN_FILTER_FILE}")

    if FETCH_IMAGES_ONLY:
        print(f"Mode        : FETCH_IMAGES_ONLY — skipping scrape, re-fetching images on existing CSVs")
    print(f"Domains     : {DOMAINS}  (parallel)")
    print(f"Pages/domain: {PAGES}  |  Overrides: {PAGES_OVERRIDE or 'none'}  |  Page size: {PAGE_SIZE}  |  Stars: {STAR_FILTER}  |  Avoidance: {DETECTION_AVOIDANCE}")
    print(f"Headless    : {HEADLESS}")

    async with async_playwright() as pw:
        if HEADLESS:
            import shutil
            if shutil.which("pgrep") and __import__("subprocess").run(
                    ["pgrep", "-x", "Google Chrome"], capture_output=True).returncode == 0:
                print("⚠  Chrome is open — close it first (Cmd+Q), then press Enter.")
                if sys.stdin.isatty():
                    await asyncio.get_event_loop().run_in_executor(None, input)
            ctx     = await pw.chromium.launch_persistent_context(
                SCRAPER_PROFILE_DIR, channel="chrome", headless=True)
            browser = None
        else:
            import subprocess, socket, time as _time

            def _port_open(p):
                s = socket.socket(); r = s.connect_ex(('127.0.0.1', p)); s.close(); return r == 0

            if not _port_open(9222):
                print(f"Launching Chrome with scraper profile: {SCRAPER_PROFILE_DIR}")
                os.makedirs(SCRAPER_PROFILE_DIR, exist_ok=True)
                subprocess.Popen([CHROME_PATH,
                    "--remote-debugging-port=9222",
                    f"--user-data-dir={SCRAPER_PROFILE_DIR}",
                    "--no-first-run",
                    "--no-default-browser-check",
                ], stderr=subprocess.DEVNULL)
                print("Waiting for Chrome to start …", end=" ", flush=True)
                for _ in range(30):
                    if _port_open(9222): break
                    _time.sleep(1)
                else:
                    raise RuntimeError("Chrome did not open on port 9222 within 30 s")
                print("ready")
            else:
                print("Chrome already running on port 9222 — connecting …")

            browser = await pw.chromium.connect_over_cdp("http://localhost:9222")
            ctx     = browser.contexts[0]

        # ── Session check: navigate to each SC URL; only prompt login if needed ──
        _login_endpoints = []
        _seen_eu = False
        for _d in DOMAINS:
            if _d == "EU":
                if not _seen_eu:
                    _seen_eu = True
                    _login_endpoints.append(("EU", "https://sellercentral-europe.amazon.com/brand-customer-reviews/"))
            else:
                _login_endpoints.append((_d, _DOMAINS[_d]["sc_base"]))

        print("Opening Seller Central tabs …")
        existing  = list(ctx.pages)
        needs_login = []
        for _label, _url in _login_endpoints:
            _p = existing.pop(0) if existing else await ctx.new_page()
            try:
                await _p.goto(_url, wait_until="domcontentloaded", timeout=30000)
                # Login redirects always land on a URL containing /ap/ or signin
                _logged_in = not any(x in _p.url for x in ["/ap/", "signin", "mfa"])
            except Exception:
                _logged_in = False

            # Always bring every tab to front so the user can verify the correct
            # marketplace is selected — even valid sessions may be on the wrong one.
            try:
                await _p.bring_to_front()
            except Exception:
                pass
            if _logged_in:
                print(f"  [{_label}] Session valid — verify correct marketplace")
            else:
                needs_login.append(_label)
                print(f"  [{_label}] Not logged in — log in now")

        login_notice = f"Login required for: {needs_login}\n  " if needs_login else ""
        print(f"\n  {login_notice}→ Log in if needed, then navigate each tab to the correct marketplace.")
        print(f"  Press Enter when ready, or wait {LOGIN_WAIT_SECONDS} s for auto-start.")
        if sys.stdin.isatty():
            await asyncio.get_event_loop().run_in_executor(None, input)
        elif not needs_login:
            print("\r  All sessions valid — starting immediately!    ")
        else:
            wait = LOGIN_WAIT_SECONDS
            print(f"  (non-interactive: starting in {wait} s)")
            for remaining in range(wait, 0, -1):
                print(f"\r  {remaining:3d}s remaining …", end="", flush=True)
                await asyncio.sleep(1)
            print("\r  Starting scrape!                    ")

        # ── Create one dedicated scraping page per domain group ───────────────
        # Each group gets its own fresh visible tab; all share session cookies.
        domain_pages = {}
        for d in DOMAINS:
            group = "EU" if d == "EU" else d
            if group not in domain_pages:
                domain_pages[group] = await ctx.new_page()

        # ── Run all domains simultaneously ────────────────────────────────────
        async def _run(domain):
            try:
                group = "EU" if domain == "EU" else domain
                page  = domain_pages[group]
                if domain == "EU":
                    eu_file = os.path.join(OUT_DIR, "EU_seller_central_reviews.csv")
                    eu_rows = 0

                    if not FETCH_IMAGES_ONLY:
                        # Phase 1 — Germany (always first if included, clears or appends per APPEND_CSV)
                        if "DE" in EU_COUNTRIES:
                            n_de, _ = await scrape_domain(
                                "DE", page, ctx, prof, asin_filter,
                                out_file=eu_file, append=APPEND_CSV,
                                pages=PAGES_OVERRIDE.get("DE", PAGES), skip_images=True
                            )
                            eu_rows += n_de

                        # Phase 2 — remaining EU countries sequentially on the same tab.
                        # Reusing the active tab keeps the SC Europe session alive between
                        # country switches. Opening a new tab per country was prone to
                        # session expiry mid-run when DE took 30-60 min to complete.
                        eu_rest = [s for s in EU_COUNTRIES if s != "DE"]

                        de_was_written = "DE" in EU_COUNTRIES
                        for i, sub in enumerate(eu_rest):
                            # First country appends only if DE already wrote the CSV;
                            # otherwise respect APPEND_CSV (fresh vs resume).
                            first_append = True if de_was_written else (APPEND_CSV if i == 0 else True)
                            mkp = await _switch_sc_marketplace(
                                page, _DOMAINS[sub]["sc_display_name"], prof
                            )
                            await scrape_domain(
                                sub, page, ctx, prof, asin_filter,
                                out_file=eu_file, append=first_append,
                                pages=PAGES_OVERRIDE.get(sub, PAGES),
                                skip_images=True, mkp_params=mkp
                            )

                    # Count actual EU rows from CSV (append mode returns cumulative totals)
                    if os.path.exists(eu_file):
                        with open(eu_file, encoding='utf-8-sig') as _f:
                            eu_rows = sum(1 for _ in _f) - 1  # subtract header

                    # Phase 3 — fetch images for all EU rows in one pass
                    eu_imgs = 0
                    if FETCH_IMAGES:
                        print(f"\n{'═'*60}")
                        print(f"  EU image fetch phase  ({eu_rows} reviews across {len(EU_COUNTRIES)} countries)")
                        print(f"{'═'*60}")
                        eu_imgs = await _enrich_csv_with_images(eu_file, page, prof)
                    return ("EU", eu_rows, eu_imgs, "OK")
                else:
                    if FETCH_IMAGES_ONLY:
                        return (domain, 0, 0, "SKIP (FETCH_IMAGES_ONLY — non-EU domain)")
                    eff_pages = PAGES_OVERRIDE.get(domain, PAGES)
                    n_rows, n_imgs = await scrape_domain(
                        domain, page, ctx, prof, asin_filter, pages=eff_pages)
                    return (domain, n_rows, n_imgs, "OK")
            except Exception as e:
                print(f"\n  ✗ {domain} failed: {e}")
                return (domain, 0, 0, f"FAILED: {e}")

        results = await asyncio.gather(*[_run(d) for d in DOMAINS])

        if HEADLESS:
            await ctx.close()
        else:
            await browser.close()

    print(f"\n{'═'*60}")
    print("  SUMMARY")
    print(f"{'═'*60}")
    for domain, n_rows, n_imgs, status in results:
        print(f"  {domain:4s}  {n_rows:>5} reviews  {n_imgs:>4} with images  [{status}]")
    print(f"{'═'*60}")


if __name__ == '__main__':
    asyncio.run(main())
