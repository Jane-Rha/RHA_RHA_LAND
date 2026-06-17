#!/usr/bin/env python3
"""
Seller Central brand reviews scraper — direct internal API approach.

Pulls session cookies from a logged-in Chrome CDP session, then calls
  https://sellercentral.amazon.{tld}/brandcustomerreviews/api/reviews
which returns orderId, reviewText, rating, ASIN, author, etc. per review.

Output CSV matches SQ's column format:
  Marketplace, ChildASIN, ParentASIN, OrderID, ReviewID, ASINTitle,
  ReviewTitle, ReviewText, Rating, ReviewCreatedAt(UTC), Author,
  VerifiedPurchase, HasImages, ReviewDetailURL, ProductURL,
  FirstSeenAt(UTC), Source, SyncDate(PT)

Usage:
    python3 ~/Desktop/GCX/scrape_brand_reviews.py [--marketplace DE] [--pages 5]
    --pages 0  → scrape all pages
    --marketplace DE|ES|FR|GB|IT|JP|US|IN  (default: DE)

Prerequisites:
    Chrome open with --remote-debugging-port=9222 --remote-allow-origins='*'
    Logged in to Seller Central for the target marketplace.
"""

import argparse
import asyncio
import csv
import datetime
import json
import time
import urllib.request
from pathlib import Path

import requests
import websockets

# ── Config ────────────────────────────────────────────────────────────────────
CDP_URL  = "http://localhost:9222"
PAGE_SIZE = 50   # max rows per API call

MARKETPLACE_MAP = {
    "DE": ("DE", "sellercentral.amazon.de",     "https://www.amazon.de"),
    "ES": ("ES", "sellercentral.amazon.es",     "https://www.amazon.es"),
    "FR": ("FR", "sellercentral.amazon.fr",     "https://www.amazon.fr"),
    "GB": ("GB", "sellercentral.amazon.co.uk",  "https://www.amazon.co.uk"),
    "IT": ("IT", "sellercentral.amazon.it",     "https://www.amazon.it"),
    "JP": ("JP", "sellercentral.amazon.co.jp",  "https://www.amazon.co.jp"),
    "US": ("US", "sellercentral.amazon.com",    "https://www.amazon.com"),
    "IN": ("IN", "sellercentral.amazon.in",     "https://www.amazon.in"),
}

CSV_FIELDS = [
    "Marketplace", "ChildASIN", "ParentASIN", "OrderID", "ReviewID",
    "ASINTitle", "ReviewTitle", "ReviewText", "Rating",
    "ReviewCreatedAt(UTC)", "Author", "VerifiedPurchase", "HasImages",
    "ReviewDetailURL", "ProductURL", "FirstSeenAt(UTC)", "Source", "SyncDate(PT)",
]

# ── Chrome cookie extraction ──────────────────────────────────────────────────
async def get_cookies_for_domain(domain: str) -> dict:
    """Connect to Chrome CDP and return cookies for the SC domain as a dict."""
    data  = json.loads(urllib.request.urlopen(f"{CDP_URL}/json/list").read())
    pages = [t for t in data if t.get("type") == "page"]
    if not pages:
        raise SystemExit("No Chrome tab found. Open Chrome with --remote-debugging-port=9222")
    ws_url = pages[0]["webSocketDebuggerUrl"]

    cookies = {}
    async with websockets.connect(ws_url) as ws:
        msg_id = 1
        await ws.send(json.dumps({
            "id": msg_id,
            "method": "Network.getCookies",
            "params": {"urls": [f"https://{domain}"]},
        }))
        deadline = time.time() + 10
        while time.time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=3)
            except (asyncio.TimeoutError, TimeoutError):
                break
            msg = json.loads(raw)
            if msg.get("id") == msg_id:
                for c in msg.get("result", {}).get("cookies", []):
                    cookies[c["name"]] = c["value"]
                break
    return cookies

# ── API pagination ─────────────────────────────────────────────────────────────
def fetch_reviews_page(session: requests.Session, sc_domain: str,
                       page_id: int, page_size: int) -> dict:
    url = (f"https://{sc_domain}/brandcustomerreviews/api/reviews"
           f"?pageId={page_id}&pageSize={page_size}"
           f"&sortByType=REVIEW_CREATED_DATE&isAscending=false&includeDone=false")
    r = session.get(url, timeout=30)
    r.raise_for_status()
    return r.json()

# ── Row builder ───────────────────────────────────────────────────────────────
def build_row(review: dict, marketplace: str, store_base: str,
              scraped_at: str, sync_date: str) -> dict:
    rev_id    = review.get("reviewId", "")
    child     = review.get("childAsin", "")
    parent    = review.get("asin", "")   # parent ASIN
    vp        = "Y" if review.get("reviewIsVerifiedPurchase") else "N"
    has_img   = "Y" if review.get("reviewHasImages") else "N"
    order_id  = review.get("orderId", "") or ""
    ts        = review.get("reviewCreatedTimestamp", "")
    if ts and "T" in ts:
        ts = ts.replace("T", " ").split(".")[0]   # "2026-06-08 11:39:02"
    return {
        "Marketplace":        marketplace,
        "ChildASIN":          child,
        "ParentASIN":         parent,
        "OrderID":            order_id,
        "ReviewID":           rev_id,
        "ASINTitle":          review.get("asinTitle", ""),
        "ReviewTitle":        review.get("reviewTitle", ""),
        "ReviewText":         review.get("reviewText", ""),
        "Rating":             int(review.get("reviewRating", 0) or 0),
        "ReviewCreatedAt(UTC)": ts,
        "Author":             review.get("reviewAuthorPublicName", ""),
        "VerifiedPurchase":   vp,
        "HasImages":          has_img,
        "ReviewDetailURL":    f"{store_base}/gp/customer-reviews/{rev_id}" if rev_id else "",
        "ProductURL":         f"{store_base}/dp/{child}" if child else "",
        "FirstSeenAt(UTC)":   scraped_at,
        "Source":             "daily_full_refresh",
        "SyncDate(PT)":       sync_date,
    }

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--marketplace", default="DE", choices=list(MARKETPLACE_MAP))
    parser.add_argument("--pages", type=int, default=5,
                        help="Max pages to scrape (0 = all, default 5 = 250 reviews)")
    parser.add_argument("--min-rating", type=int, default=0,
                        help="Only keep reviews with rating >= this (0 = all)")
    parser.add_argument("--max-rating", type=int, default=5,
                        help="Only keep reviews with rating <= this (5 = all)")
    args = parser.parse_args()

    marketplace, sc_domain, store_base = MARKETPLACE_MAP[args.marketplace]
    today = datetime.date.today().isoformat()
    scraped_at = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

    # Get cookies from Chrome
    print(f"Extracting session cookies from Chrome for {sc_domain}...")
    cookies = asyncio.run(get_cookies_for_domain(sc_domain))
    if not cookies:
        raise SystemExit(f"No cookies found for {sc_domain}. "
                         "Make sure Chrome is open and logged in to Seller Central.")
    print(f"  Got {len(cookies)} cookies.")

    session = requests.Session()
    session.cookies.update(cookies)
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/130.0.0.0 Safari/537.36",
        "Referer": f"https://{sc_domain}/brand-customer-reviews/",
        "Accept": "application/json, text/plain, */*",
    })

    # First call to get total page count
    print(f"\nFetching page 0 (page size {PAGE_SIZE})...")
    first = fetch_reviews_page(session, sc_domain, 0, PAGE_SIZE)
    total_pages = first.get("totalPageCount", 1)
    total_reviews = first.get("totalReviewCount", 0)
    print(f"  Total reviews: {total_reviews}  |  Total pages: {total_pages}")

    max_pages = total_pages if args.pages == 0 else min(args.pages, total_pages)
    print(f"  Will scrape {max_pages} page(s) ({max_pages * PAGE_SIZE} reviews max)\n")

    all_rows = []
    for page_id in range(max_pages):
        if page_id == 0:
            data = first
        else:
            print(f"  Page {page_id+1}/{max_pages}...", end="", flush=True)
            try:
                data = fetch_reviews_page(session, sc_domain, page_id, PAGE_SIZE)
                time.sleep(0.3)
            except Exception as e:
                print(f" ERROR: {e}")
                break
        reviews = data.get("reviews", [])
        rows = [build_row(r, marketplace, store_base, scraped_at, today)
                for r in reviews]
        # Rating filter
        if args.min_rating > 0 or args.max_rating < 5:
            rows = [r for r in rows
                    if args.min_rating <= r["Rating"] <= args.max_rating]
        all_rows.extend(rows)
        orders_on_page = sum(1 for r in rows if r["OrderID"])
        if page_id > 0:
            print(f" {len(reviews)} reviews, {orders_on_page} with OrderID")
        else:
            print(f"  Page 1: {len(reviews)} reviews, "
                  f"{orders_on_page} with OrderID")

    # Dedup by ReviewID
    seen = set()
    unique = [r for r in all_rows if r["ReviewID"] not in seen
              and not seen.add(r["ReviewID"])]

    out = Path.home() / f"Desktop/GCX/brand_reviews_{marketplace}_{today}.csv"
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(unique)

    with_order = sum(1 for r in unique if r["OrderID"])
    vp_count   = sum(1 for r in unique if r["VerifiedPurchase"] == "Y")
    print(f"\nSaved {len(unique)} reviews → {out}")
    print(f"  With OrderID:        {with_order}/{len(unique)} "
          f"({100*with_order/max(len(unique),1):.1f}%)")
    print(f"  Verified Purchase:   {vp_count}/{len(unique)} "
          f"({100*vp_count/max(len(unique),1):.1f}%)")

if __name__ == "__main__":
    main()
