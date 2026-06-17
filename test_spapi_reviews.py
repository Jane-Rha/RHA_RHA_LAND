#!/usr/bin/env python3
"""
SP-API review scraper — test script
Fetches product reviews via Reports API and recent orders via Orders API.

Usage:
    python3 ~/Desktop/GCX/test_spapi_reviews.py [--marketplace US|DE|FR|IT|ES|UK|JP]

Report flow:
    1. POST /reports  → reportId
    2. Poll GET /reports/{id} until DONE (up to ~5 min)
    3. GET /documents/{docId} → presigned S3 URL
    4. Download + parse TSV

Order ID linkage: only verified-purchase reviews carry an orderId in the report.
"""

import argparse
import csv
import datetime
import gzip
import hashlib
import hmac
import io
import json
import sys
import time
import urllib.parse
from pathlib import Path

import requests

# ── Config ────────────────────────────────────────────────────────────────────
CONFIG_PATH = Path.home() / ".sp-api-config.json"
CFG = json.loads(CONFIG_PATH.read_text())

MARKETPLACE_MAP = {
    "US": ("ATVPDKIKX0DER",  "https://sellingpartnerapi-na.amazon.com", "us-east-1",  "main"),
    "CA": ("A2EUQ1WTGCTBG2",  "https://sellingpartnerapi-na.amazon.com", "us-east-1",  "main"),
    "DE": ("A1PA6795UKMFR9",  "https://sellingpartnerapi-eu.amazon.com", "eu-west-1",  "main"),
    "FR": ("A13V1IB3VIYZZH",  "https://sellingpartnerapi-eu.amazon.com", "eu-west-1",  "main"),
    "IT": ("APJ6JRA9NG5V4",   "https://sellingpartnerapi-eu.amazon.com", "eu-west-1",  "main"),
    "ES": ("A1RKKUPIHCS9HS",  "https://sellingpartnerapi-eu.amazon.com", "eu-west-1",  "main"),
    "UK": ("A1F83G8C2ARO7P",  "https://sellingpartnerapi-eu.amazon.com", "eu-west-1",  "main"),
    "JP": ("A1VC38T7YXB528",  "https://sellingpartnerapi-fe.amazon.com", "us-west-2",  "jp"),
    "IN": ("A21TJRUUN4KGV",   "https://sellingpartnerapi-eu.amazon.com", "eu-west-1",  "main"),
}

# ── LWA ───────────────────────────────────────────────────────────────────────
_lwa_cache: dict = {"main": {"token": None, "exp": 0.0}, "jp": {"token": None, "exp": 0.0}}

def lwa_token(cred="main") -> str:
    cache = _lwa_cache[cred]
    if time.time() < cache["exp"] - 60:
        return cache["token"]
    suffix = "_jp" if cred == "jp" else ""
    r = requests.post("https://api.amazon.com/auth/o2/token", data={
        "grant_type":    "refresh_token",
        "refresh_token": CFG[f"refresh_token{suffix}"],
        "client_id":     CFG[f"lwa_client_id{suffix}"],
        "client_secret": CFG[f"lwa_client_secret{suffix}"],
    }, timeout=15)
    r.raise_for_status()
    d = r.json()
    cache["token"] = d["access_token"]
    cache["exp"]   = time.time() + d.get("expires_in", 3600)
    return cache["token"]

# ── SigV4 ────────────────────────────────────────────────────────────────────
def _signing_key(secret: str, date_stamp: str, region: str) -> bytes:
    def sign(key, msg):
        k = key if isinstance(key, bytes) else key.encode()
        return hmac.new(k, msg.encode(), hashlib.sha256).digest()
    return sign(sign(sign(sign(f"AWS4{secret}", date_stamp), region), "execute-api"), "aws4_request")

def _sp_request(method: str, endpoint: str, region: str, path: str,
                params: dict = None, body: dict = None, cred: str = "main") -> requests.Response:
    token = lwa_token(cred)
    host  = endpoint.removeprefix("https://")
    t     = datetime.datetime.utcnow()
    amz_date   = t.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = t.strftime("%Y%m%d")

    qs = ""
    if params:
        qs = "&".join(
            f"{urllib.parse.quote(str(k), safe='')}={urllib.parse.quote(str(v), safe='')}"
            for k, v in sorted(params.items())
        )

    payload_bytes = json.dumps(body).encode() if body else b""
    payload_hash  = hashlib.sha256(payload_bytes).hexdigest()

    hdrs = {"host": host, "x-amz-access-token": token, "x-amz-date": amz_date}
    if body:
        hdrs["content-type"] = "application/json"

    sorted_keys = sorted(hdrs)
    canon_hdrs  = "".join(f"{k}:{hdrs[k]}\n" for k in sorted_keys)
    signed_hdrs = ";".join(sorted_keys)
    canon_req   = "\n".join([method, path, qs, canon_hdrs, signed_hdrs, payload_hash])
    scope       = f"{date_stamp}/{region}/execute-api/aws4_request"
    sts         = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, scope,
        hashlib.sha256(canon_req.encode()).hexdigest(),
    ])
    sig  = hmac.new(_signing_key(CFG["aws_secret_access_key"], date_stamp, region),
                    sts.encode(), hashlib.sha256).hexdigest()
    auth = (f"AWS4-HMAC-SHA256 Credential={CFG['aws_access_key_id']}/{scope}, "
            f"SignedHeaders={signed_hdrs}, Signature={sig}")

    url     = f"{endpoint}{path}" + (f"?{qs}" if qs else "")
    headers = {**hdrs, "Authorization": auth}
    if body:
        headers["Content-Type"] = "application/json"

    if method == "POST":
        return requests.post(url, headers=headers, data=payload_bytes, timeout=30)
    return requests.get(url, headers=headers, timeout=30)

# ── Orders quick test ─────────────────────────────────────────────────────────
def test_orders(marketplace_id, endpoint, region, cred, n=5):
    print(f"\n[Orders API] Fetching last {n} orders …")
    created_after = (datetime.datetime.utcnow() - datetime.timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    r = _sp_request("GET", endpoint, region, "/orders/v0/orders", params={
        "MarketplaceIds": marketplace_id,
        "CreatedAfter":   created_after,
        "MaxResultsPerPage": n,
    }, cred=cred)
    if not r.ok:
        print(f"  ERROR {r.status_code}: {r.text[:300]}")
        return
    orders = r.json().get("payload", {}).get("Orders", [])
    print(f"  Got {len(orders)} orders:")
    for o in orders:
        print(f"  {o.get('AmazonOrderId')}  status={o.get('OrderStatus')}  date={o.get('PurchaseDate','')[:10]}")

# ── Review report ─────────────────────────────────────────────────────────────
def request_review_report(marketplace_id, endpoint, region, cred) -> str | None:
    print(f"\n[Reports API] Requesting GET_CUSTOMER_REVIEWS report …")
    body = {
        "reportType":     "GET_CUSTOMER_REVIEWS",
        "marketplaceIds": [marketplace_id],
    }
    r = _sp_request("POST", endpoint, region, "/reports/2021-06-30/reports", body=body, cred=cred)
    if not r.ok:
        print(f"  ERROR {r.status_code}: {r.text[:400]}")
        return None
    report_id = r.json().get("reportId")
    print(f"  reportId: {report_id}")
    return report_id

def poll_report(report_id, endpoint, region, cred, timeout=300) -> str | None:
    print(f"  Polling (up to {timeout}s) …", end="", flush=True)
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = _sp_request("GET", endpoint, region, f"/reports/2021-06-30/reports/{report_id}", cred=cred)
        if not r.ok:
            print(f"\n  Poll error {r.status_code}: {r.text[:200]}")
            return None
        status = r.json().get("processingStatus")
        doc_id = r.json().get("reportDocumentId")
        print(".", end="", flush=True)
        if status == "DONE" and doc_id:
            print(f" DONE")
            return doc_id
        if status in ("CANCELLED", "FATAL"):
            print(f" {status}")
            print(f"  Detail: {r.text[:300]}")
            return None
        time.sleep(15)
    print(" TIMEOUT")
    return None

def download_report(doc_id, endpoint, region, cred) -> list[dict]:
    print(f"  Fetching document URL …")
    r = _sp_request("GET", endpoint, region, f"/reports/2021-06-30/documents/{doc_id}", cred=cred)
    if not r.ok:
        print(f"  ERROR {r.status_code}: {r.text[:300]}")
        return []
    doc = r.json()
    url         = doc.get("url")
    compression = doc.get("compressionAlgorithm", "")
    print(f"  Downloading … (compression={compression or 'none'})")
    dl = requests.get(url, timeout=60)
    dl.raise_for_status()
    raw = dl.content
    if compression == "GZIP":
        raw = gzip.decompress(raw)
    text = raw.decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(text), delimiter="\t"))
    return rows

def print_reviews(rows, limit=10):
    print(f"\n  Total rows: {len(rows)}")
    if not rows:
        return
    print(f"  Columns: {list(rows[0].keys())}")
    print(f"\n  First {min(limit, len(rows))} rows:")
    for row in rows[:limit]:
        order_id  = row.get("order-id") or row.get("OrderId") or row.get("orderId") or "—"
        review_id = row.get("review-id") or row.get("ReviewId") or "—"
        rating    = row.get("rating") or row.get("Rating") or "—"
        title     = (row.get("title") or row.get("ReviewTitle") or "")[:50]
        verified  = row.get("verified-purchase") or row.get("VerifiedPurchase") or "—"
        print(f"  OrderID={order_id}  ReviewID={review_id}  Rating={rating}  VP={verified}  Title={title}")

# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--marketplace", default="US", choices=list(MARKETPLACE_MAP))
    parser.add_argument("--orders-only", action="store_true", help="Skip review report, just test orders")
    args = parser.parse_args()

    marketplace_id, endpoint, region, cred = MARKETPLACE_MAP[args.marketplace]
    print(f"Marketplace: {args.marketplace}  ({marketplace_id})")
    print(f"Endpoint:    {endpoint}")

    # 1) Auth sanity check
    print("\n[Auth] Getting LWA token …")
    try:
        tok = lwa_token(cred)
        print(f"  OK — token prefix: {tok[:20]}…")
    except Exception as e:
        print(f"  FAILED: {e}")
        sys.exit(1)

    # 2) Orders API (quick sanity)
    test_orders(marketplace_id, endpoint, region, cred)

    if args.orders_only:
        return

    # 3) Review report
    report_id = request_review_report(marketplace_id, endpoint, region, cred)
    if not report_id:
        print("\nNote: GET_CUSTOMER_REVIEWS may require Brand Registry approval on this account.")
        print("Try --orders-only to confirm auth is working.")
        return

    doc_id = poll_report(report_id, endpoint, region, cred)
    if not doc_id:
        return

    rows = download_report(doc_id, endpoint, region, cred)
    print_reviews(rows)

    # Save to file
    out_path = Path.home() / f"Desktop/GCX/spapi_reviews_{args.marketplace}_{datetime.date.today()}.tsv"
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        if rows:
            writer = csv.DictWriter(f, fieldnames=rows[0].keys(), delimiter="\t")
            writer.writeheader()
            writer.writerows(rows)
    print(f"\nSaved {len(rows)} rows → {out_path}")

if __name__ == "__main__":
    main()
