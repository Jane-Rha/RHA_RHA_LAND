#!/usr/bin/env python3
"""
Seller Central DE brand reviews scraper + SP-API order ID matching → CSV

Usage:
    python3 ~/Desktop/GCX/scrape_brand_reviews.py [--pages N]
    Default: 3 pages (30 reviews). Use --pages 0 for all pages.

Requirements: Chrome open at sellercentral.amazon.de/brand-customer-reviews/ (logged in)
              ~/.sp-api-config.json with valid credentials
"""

import argparse
import asyncio
import csv
import datetime
import hashlib
import hmac
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

import requests
import websockets

# ── Config ────────────────────────────────────────────────────────────────────
CDP_URL       = "http://localhost:9222"
CONFIG_PATH   = Path.home() / ".sp-api-config.json"
MARKETPLACE   = "A1PA6795UKMFR9"   # DE
SP_ENDPOINT   = "https://sellingpartnerapi-eu.amazon.com"
SP_REGION     = "eu-west-1"
REVIEWS_URL   = "https://sellercentral.amazon.de/brand-customer-reviews/"

CFG = json.loads(CONFIG_PATH.read_text())

# ── SP-API auth ───────────────────────────────────────────────────────────────
_lwa_cache = {"token": None, "exp": 0.0}

def lwa_token():
    if time.time() < _lwa_cache["exp"] - 60:
        return _lwa_cache["token"]
    r = requests.post("https://api.amazon.com/auth/o2/token", data={
        "grant_type": "refresh_token",
        "refresh_token": CFG["refresh_token"],
        "client_id":     CFG["lwa_client_id"],
        "client_secret": CFG["lwa_client_secret"],
    }, timeout=15)
    r.raise_for_status()
    d = r.json()
    _lwa_cache["token"] = d["access_token"]
    _lwa_cache["exp"]   = time.time() + d.get("expires_in", 3600)
    return _lwa_cache["token"]

def _signing_key(secret, date_stamp, region):
    def sign(k, m):
        k = k if isinstance(k, bytes) else k.encode()
        return hmac.new(k, m.encode(), hashlib.sha256).digest()
    return sign(sign(sign(sign(f"AWS4{secret}", date_stamp), region), "execute-api"), "aws4_request")

def sp_get(path, params=None):
    token = lwa_token()
    host  = SP_ENDPOINT.removeprefix("https://")
    t     = datetime.datetime.utcnow()
    amz   = t.strftime("%Y%m%dT%H%M%SZ")
    ds    = t.strftime("%Y%m%d")
    qs    = ""
    if params:
        qs = "&".join(f"{urllib.parse.quote(str(k),safe='')}={urllib.parse.quote(str(v),safe='')}"
                      for k, v in sorted(params.items()))
    hdrs = {"host": host, "x-amz-access-token": token, "x-amz-date": amz}
    sk   = sorted(hdrs)
    ch   = "".join(f"{k}:{hdrs[k]}\n" for k in sk)
    sh   = ";".join(sk)
    ph   = hashlib.sha256(b"").hexdigest()
    cr   = "\n".join(["GET", path, qs, ch, sh, ph])
    sc   = f"{ds}/{SP_REGION}/execute-api/aws4_request"
    sts  = "\n".join(["AWS4-HMAC-SHA256", amz, sc, hashlib.sha256(cr.encode()).hexdigest()])
    sig  = hmac.new(_signing_key(CFG["aws_secret_access_key"], ds, SP_REGION),
                    sts.encode(), hashlib.sha256).hexdigest()
    auth = (f"AWS4-HMAC-SHA256 Credential={CFG['aws_access_key_id']}/{sc}, "
            f"SignedHeaders={sh}, Signature={sig}")
    url  = f"{SP_ENDPOINT}{path}" + (f"?{qs}" if qs else "")
    return requests.get(url, headers={**hdrs, "Authorization": auth}, timeout=20)

# ── Date parsing ──────────────────────────────────────────────────────────────
_MONTHS = {m: i+1 for i, m in enumerate(
    ["january","february","march","april","may","june",
     "july","august","september","october","november","december"])}

def parse_date(s):
    m = re.search(r'(\d{1,2})\s+(\w+)\s+(\d{4})', s or "")
    if m:
        try:
            return datetime.date(int(m.group(3)), _MONTHS[m.group(2).lower()], int(m.group(1)))
        except (KeyError, ValueError):
            pass
    return None

# ── SP-API order matching via Reports API bulk flat file ─────────────────────
def sp_post(path, body):
    import hmac as _hmac
    token = lwa_token()
    host  = SP_ENDPOINT.removeprefix("https://")
    t     = datetime.datetime.utcnow()
    amz   = t.strftime("%Y%m%dT%H%M%SZ")
    ds    = t.strftime("%Y%m%d")
    pb    = json.dumps(body).encode()
    ph    = hashlib.sha256(pb).hexdigest()
    hdrs  = {"content-type": "application/json", "host": host,
             "x-amz-access-token": token, "x-amz-date": amz}
    sk    = sorted(hdrs)
    ch    = "".join(f"{k}:{hdrs[k]}\n" for k in sk)
    sh    = ";".join(sk)
    cr    = "\n".join(["POST", path, "", ch, sh, ph])
    sc    = f"{ds}/{SP_REGION}/execute-api/aws4_request"
    sts   = "\n".join(["AWS4-HMAC-SHA256", amz, sc, hashlib.sha256(cr.encode()).hexdigest()])
    sig   = _hmac.new(_signing_key(CFG["aws_secret_access_key"], ds, SP_REGION),
                      sts.encode(), hashlib.sha256).hexdigest()
    auth  = (f"AWS4-HMAC-SHA256 Credential={CFG['aws_access_key_id']}/{sc}, "
             f"SignedHeaders={sh}, Signature={sig}")
    url   = f"{SP_ENDPOINT}{path}"
    return requests.post(url, headers={**hdrs, "Authorization": auth}, data=pb, timeout=30)

def request_orders_report(date_from: datetime.date, date_to: datetime.date) -> str | None:
    """Request GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL report, return reportId."""
    body = {
        "reportType": "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL",
        "marketplaceIds": [MARKETPLACE],
        "dataStartTime": date_from.strftime("%Y-%m-%dT00:00:00Z"),
        "dataEndTime":   date_to.strftime("%Y-%m-%dT23:59:59Z"),
    }
    r = sp_post("/reports/2021-06-30/reports", body)
    if not r.ok:
        print(f"  Report request failed {r.status_code}: {r.text[:200]}")
        return None
    return r.json().get("reportId")

def poll_report(report_id: str, timeout: int = 300) -> str | None:
    """Poll until DONE, return reportDocumentId."""
    print(f"  Polling report {report_id}", end="", flush=True)
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = sp_get(f"/reports/2021-06-30/reports/{report_id}")
        if not r.ok:
            print(f" ERROR {r.status_code}")
            return None
        d = r.json()
        status = d.get("processingStatus")
        doc_id = d.get("reportDocumentId")
        print(".", end="", flush=True)
        if status == "DONE" and doc_id:
            print(" DONE")
            return doc_id
        if status in ("CANCELLED", "FATAL"):
            print(f" {status}: {r.text[:150]}")
            return None
        time.sleep(15)
    print(" TIMEOUT")
    return None

def download_report(doc_id: str) -> list[dict]:
    """Download report document, return parsed rows."""
    import gzip, io, csv as _csv
    raw = None
    compression = None
    for attempt in range(4):
        # Re-fetch presigned URL each attempt — it expires in ~5 min
        r = sp_get(f"/reports/2021-06-30/documents/{doc_id}")
        if not r.ok:
            print(f"  Doc fetch failed {r.status_code}: {r.text[:100]}")
            return []
        doc = r.json()
        compression = doc.get("compressionAlgorithm")
        try:
            chunks = []
            with requests.get(doc["url"], timeout=(30, 600), stream=True) as dl:
                dl.raise_for_status()
                total = 0
                for chunk in dl.iter_content(chunk_size=512*1024):
                    chunks.append(chunk)
                    total += len(chunk)
            raw = b"".join(chunks)
            print(f"  Downloaded {total/1024/1024:.1f} MB")
            break
        except (requests.exceptions.Timeout,
                requests.exceptions.ConnectionError,
                requests.exceptions.ChunkedEncodingError) as e:
            print(f"  Download error (attempt {attempt+1}/4): {type(e).__name__}")
            if attempt == 3:
                print("  All download attempts failed.")
                return []
            time.sleep(10)
    if raw is None:
        return []
    if compression == "GZIP":
        raw = gzip.decompress(raw)
    text = raw.decode("latin-1")  # Amazon flat files use latin-1
    return list(_csv.DictReader(io.StringIO(text), delimiter="\t"))

def build_asin_order_map(rows: list[dict]) -> dict:
    """Build {asin: [(order_id, purchase_date), ...]} from flat file rows."""
    mapping: dict = {}
    for row in rows:
        asin = row.get("asin") or row.get("ASIN") or ""
        oid  = row.get("amazon-order-id") or row.get("AmazonOrderId") or ""
        date_str = row.get("purchase-date") or row.get("PurchaseDate") or ""
        if asin and oid:
            mapping.setdefault(asin, []).append((oid, date_str[:10]))
    return mapping

def match_order(asin: str, review_date: datetime.date,
                asin_map: dict, window_days: int = 7) -> str:
    """Find unique order ID matching ASIN within window_days before review_date."""
    candidates = asin_map.get(asin, [])
    matched = []
    for oid, order_date_str in candidates:
        try:
            od = datetime.date.fromisoformat(order_date_str)
            if -1 <= (review_date - od).days <= window_days:
                matched.append(oid)
        except ValueError:
            pass
    if len(matched) == 1:
        return matched[0]
    if len(matched) > 1:
        return f"AMBIGUOUS({len(matched)})"
    return ""

# ── CDP helpers ───────────────────────────────────────────────────────────────
JS_GET_LINKS = r"""
(function() {
    function allEls(root) {
        var els=[], w=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT);
        var n; while((n=w.nextNode())){ els.push(n); if(n.shadowRoot) els=els.concat(allEls(n.shadowRoot)); }
        return els;
    }
    return allEls(document.body)
        .filter(e => e.tagName==='A' && (e.href||'').includes('gp/customer-reviews'))
        .map(e => e.href);
})()
"""

JS_GET_TEXT = "document.body.innerText"

JS_GET_RATINGS = r"""
(function() {
    function allEls(root) {
        var els=[], w=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT);
        var n; while((n=w.nextNode())){ els.push(n); if(n.shadowRoot) els=els.concat(allEls(n.shadowRoot)); }
        return els;
    }
    return allEls(document.body)
        .filter(e => /^\d+ star/.test(e.getAttribute('aria-label')||''))
        .map(e => (e.getAttribute('aria-label').match(/\d+/)||[''])[0]);
})()
"""

async def cdp_eval(ws, expr, msg_id_ref):
    msg_id_ref[0] += 1
    rid = msg_id_ref[0]
    await ws.send(json.dumps({"id": rid, "method": "Runtime.evaluate",
                              "params": {"expression": expr, "returnByValue": True}}))
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
        if msg.get("id") == rid:
            return msg.get("result", {}).get("result", {}).get("value")

def parse_reviews_from_text(text, links, ratings):
    """Parse reviews from page innerText + shadow DOM links/ratings."""
    blocks = re.split(r'(?=Review by .+ on \d+ \w+ \d{4})', text)
    review_blocks = [b for b in blocks if re.match(r'Review by .+ on \d+ \w+ \d{4}', b.strip())]
    reviews = []
    for i, block in enumerate(review_blocks):
        lines = [l.strip() for l in block.split('\n') if l.strip()]
        meta = re.match(r'Review by (.+) on (\d+ \w+ \d{4})', lines[0])
        reviewer = meta.group(1) if meta else ''
        rev_date = meta.group(2) if meta else ''
        parent_asin = child_asin = title = ''
        body_lines = []
        skip_next = False
        for j, line in enumerate(lines[1:], 1):
            if line == 'Parent ASIN':
                parent_asin = lines[j + 1] if j + 1 < len(lines) else ''
                skip_next = True; continue
            if line == 'Child ASIN':
                child_asin = lines[j + 1] if j + 1 < len(lines) else ''
                skip_next = True; continue
            if skip_next:
                skip_next = False; continue
            if line in ("Product's star rating", 'Brand', 'Show Review Details',
                        'View more', 'View less') or re.match(r'^[A-Z0-9]{10}$', line):
                continue
            if re.match(r'^\d+ stars?$', line) or re.match(r'^\d+$', line):
                continue
            if not title:
                title = line
            else:
                body_lines.append(line)
        review_url = links[i] if i < len(links) else ''
        review_id  = (re.search(r'customer-reviews/([A-Z0-9]+)', review_url) or [None, ''])[1]
        rating     = ratings[i] if i < len(ratings) else ''
        reviews.append({
            'reviewId': review_id, 'reviewer': reviewer, 'reviewDate': rev_date,
            'rating': rating, 'parentASIN': parent_asin, 'childASIN': child_asin,
            'title': title, 'body': ' '.join(body_lines)[:500], 'reviewUrl': review_url,
        })
    return reviews

async def scrape_all_pages(ws, msg_id_ref, max_pages):
    all_reviews = []
    page_num = 1
    while True:
        print(f"  Page {page_num}...", end="", flush=True)
        await asyncio.sleep(2.5)
        links   = await cdp_eval(ws, JS_GET_LINKS,   msg_id_ref)
        text    = await cdp_eval(ws, JS_GET_TEXT,    msg_id_ref)
        ratings = await cdp_eval(ws, JS_GET_RATINGS, msg_id_ref)
        reviews = parse_reviews_from_text(text or '', links or [], ratings or [])
        if not reviews:
            print(" 0 reviews — stopping")
            break
        all_reviews.extend(reviews)
        print(f" {len(reviews)} reviews (total: {len(all_reviews)})")

        if max_pages and page_num >= max_pages:
            break

        nav_result = await cdp_eval(ws, r"""
            (function() {
                function allEls(root) {
                    var els=[], w=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT);
                    var n; while((n=w.nextNode())){ els.push(n); if(n.shadowRoot) els=els.concat(allEls(n.shadowRoot)); }
                    return els;
                }
                var all = allEls(document.body);
                var fwd = all.find(e => (e.getAttribute('aria-label')||'').includes('Navigate forward'));
                if (fwd && !fwd.hasAttribute('disabled')) { fwd.click(); return 'clicked forward'; }
                var current = parseInt((all.find(e=>e.getAttribute('aria-current')==='page')||{}).textContent||'0');
                var next = all.find(e => (e.getAttribute('aria-label')||'').includes('Page '+(current+1)));
                if (next) { next.click(); return 'page '+(current+1); }
                return 'no next';
            })()
        """, msg_id_ref)
        if "no next" in str(nav_result):
            print("  No more pages.")
            break
        page_num += 1

    return all_reviews

# ── Main ─────────────────────────────────────────────────────────────────────
async def async_main(max_pages):
    data  = json.loads(urllib.request.urlopen(f"{CDP_URL}/json/list").read())
    pages = [t for t in data if t.get("type") == "page"]
    ws_url = pages[0]["webSocketDebuggerUrl"]

    async with websockets.connect(ws_url, max_size=20*1024*1024) as ws:
        mid = [0]

        async def send(method, params=None):
            mid[0] += 1
            await ws.send(json.dumps({"id": mid[0], "method": method, "params": params or {}}))

        await send("Runtime.enable")
        await send("Page.enable")

        # Navigate to brand reviews page
        cur = await cdp_eval(ws, "location.href", mid)
        if "brand-customer-reviews" not in (cur or ""):
            print("Navigating to brand reviews page...")
            await send("Page.navigate", {"url": REVIEWS_URL})
            await asyncio.sleep(4)

        print(f"Scraping (max {max_pages or 'all'} pages)...")
        reviews = await scrape_all_pages(ws, mid, max_pages)

    return reviews

FIELDS = ["reviewId","reviewDate","reviewer","rating","parentASIN","childASIN",
          "title","body","orderId","reviewUrl"]

def save_csv(reviews, path):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(reviews)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", type=int, default=3,
                        help="Pages to scrape (0 = all, default 3)")
    parser.add_argument("--skip-scrape", action="store_true",
                        help="Load existing CSV and only redo order matching")
    args = parser.parse_args()

    out = Path.home() / f"Desktop/GCX/brand_reviews_DE_{datetime.date.today()}.csv"

    if args.skip_scrape and out.exists():
        print(f"Loading existing CSV: {out}")
        with open(out, newline="", encoding="utf-8-sig") as f:
            reviews = list(csv.DictReader(f))
        print(f"Loaded {len(reviews)} reviews")
    else:
        reviews = asyncio.run(async_main(args.pages))
        print(f"\nScraped {len(reviews)} reviews total")

        if not reviews:
            print("No reviews found — check that Chrome is open and logged in.")
            return

        # De-duplicate by reviewId
        seen = set()
        reviews = [r for r in reviews if r["reviewId"] not in seen and not seen.add(r["reviewId"])]
        print(f"After dedup: {len(reviews)} reviews")

        # Save immediately — order matching can fail without losing data
        for r in reviews:
            r.setdefault("orderId", "")
        save_csv(reviews, out)
        print(f"Saved (no order IDs yet) → {out}")

    # Determine date range across all reviews
    dates = [parse_date(r.get("reviewDate", "")) for r in reviews]
    dates = [d for d in dates if d]
    if not dates:
        print("No parseable review dates — skipping order matching.")
        return

    date_from = min(dates) - datetime.timedelta(days=7)
    date_to   = max(dates) + datetime.timedelta(days=2)
    print(f"\nRequesting orders report: {date_from} → {date_to}")

    report_id = request_orders_report(date_from, date_to)
    if not report_id:
        print("Could not request report — CSV saved without order IDs.")
        return

    doc_id = poll_report(report_id, timeout=600)
    if not doc_id:
        print("Report did not complete — CSV saved without order IDs.")
        return

    print("  Downloading flat file...")
    rows = download_report(doc_id)
    if not rows:
        print("  Empty report — CSV saved without order IDs.")
        return
    print(f"  {len(rows)} order rows downloaded. Columns: {list(rows[0].keys())[:6]}...")

    asin_map = build_asin_order_map(rows)
    print(f"  {len(asin_map)} unique ASINs in order data.")

    # Match order IDs — use 30-day window (reviews can be delayed)
    exact = ambiguous = no_match = 0
    for rev in reviews:
        asin = rev.get("childASIN", "")
        date = parse_date(rev.get("reviewDate", ""))
        if asin and date:
            oid = match_order(asin, date, asin_map, window_days=30)
            rev["orderId"] = oid
            if not oid:
                no_match += 1
            elif oid.startswith("AMBIGUOUS"):
                ambiguous += 1
            else:
                exact += 1
        else:
            no_match += 1

    # Save final CSV with order IDs
    save_csv(reviews, out)
    print(f"\nSaved {len(reviews)} rows → {out}")
    print(f"Exact match:    {exact}/{len(reviews)}")
    print(f"Ambiguous:      {ambiguous}/{len(reviews)}  (verified purchase, multiple orders in window)")
    print(f"No match:       {no_match}/{len(reviews)}  (likely non-verified purchase)")
    print(f"\nNote: 'AMBIGUOUS(n)' in orderId means n orders for that ASIN were placed")
    print(f"within 30 days before the review — can't identify which one without buyer name.")

if __name__ == "__main__":
    main()
