#!/usr/bin/env python3
"""
Capture Seller Central brand-customer-reviews API responses (including order IDs).
Navigates to the page and records every XHR/fetch response that contains review data.

Usage: python3 ~/Desktop/GCX/extract_page_state.py
Chrome must be open with --remote-debugging-port=9222 --remote-allow-origins='*'
"""

import asyncio, json, re, time, urllib.request
from pathlib import Path
import websockets

CDP_URL  = "http://localhost:9222"
ORDER_RE = re.compile(r'\b\d{3}-\d{7}-\d{7}\b')
SC_URL   = "https://sellercentral.amazon.de/brand-customer-reviews/"
OUT      = Path.home() / "Desktop/GCX/sc_api_responses.json"
CAPTURE  = 30   # seconds after page load event

async def main():
    data  = json.loads(urllib.request.urlopen(f"{CDP_URL}/json/list").read())
    pages = [t for t in data if t.get("type") == "page"]
    if not pages:
        raise SystemExit("No Chrome tab found.")
    ws_url = pages[0]["webSocketDebuggerUrl"]
    print(f"Connecting to tab: {pages[0].get('url','')}")

    async with websockets.connect(ws_url, max_size=200*1024*1024) as ws:
        mid = [0]
        captured = []
        pending     = {}   # requestId -> url
        fetch_to_url = {}  # fetch_id -> url

        async def send(method, params=None):
            mid[0] += 1
            await ws.send(json.dumps({"id": mid[0], "method": method, "params": params or {}}))
            return mid[0]

        await send("Network.enable")
        await send("Page.enable")
        await send("Runtime.enable")

        print(f"Navigating to {SC_URL} ...")
        await send("Page.navigate", {"url": SC_URL})

        page_loaded = False
        deadline    = time.time() + 90   # overall timeout

        while time.time() < deadline:
            remaining = deadline - time.time()
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=min(remaining, 1.5))
            except (asyncio.TimeoutError, TimeoutError):
                if page_loaded and (time.time() - load_time) > CAPTURE:
                    print("Capture window complete.")
                    break
                continue

            msg   = json.loads(raw)
            event = msg.get("method", "")

            if event == "Page.loadEventFired":
                page_loaded = True
                load_time   = time.time()
                print(f"Page loaded. Capturing for {CAPTURE}s...")

            elif event == "Network.responseReceived":
                p     = msg["params"]
                resp  = p.get("response", {})
                url2  = resp.get("url", "")
                mime  = resp.get("mimeType", "")
                rtype = p.get("type", "")
                if rtype in ("XHR", "Fetch") or "json" in mime or "text" in mime:
                    pending[p["requestId"]] = url2

            elif event == "Network.loadingFinished":
                req_id = msg["params"]["requestId"]
                if req_id in pending:
                    url2 = pending.pop(req_id)
                    mid[0] += 1
                    fetch_id = mid[0]
                    fetch_to_url[fetch_id] = url2
                    await ws.send(json.dumps({
                        "id": fetch_id,
                        "method": "Network.getResponseBody",
                        "params": {"requestId": req_id}
                    }))

            elif "id" in msg and "result" in msg:
                resp_url = fetch_to_url.pop(msg.get("id", -1), "unknown")
                body = msg.get("result", {}).get("body", "")
                if not body or len(body) < 10:
                    continue

                order_ids = list(set(ORDER_RE.findall(body)))
                bl = body.lower()
                is_review = any(k in bl for k in [
                    '"reviewid"', '"review_id"', '"orderid"', '"order_id"',
                    '"verifiedpurchase"', '"verified_purchase"',
                    '"totalreviewcount"', '"reviews":[',
                ])

                if order_ids or is_review:
                    entry = {
                        "url":        resp_url,
                        "orderIds":   order_ids,
                        "bodyLength": len(body),
                        "body":       body,   # full body
                    }
                    captured.append(entry)
                    if order_ids:
                        print(f"\n  *** {len(order_ids)} ORDER IDs found!")
                        print(f"      URL: {resp_url}")
                        print(f"      {order_ids[:4]}...")
                        try:
                            d = json.loads(body)
                            if isinstance(d, dict):
                                print(f"      Top-level keys: {list(d.keys())[:10]}")
                                # Show structure of first review
                                reviews = d.get("reviews", [])
                                if reviews:
                                    print(f"      Review[0] keys: {list(reviews[0].keys())}")
                        except Exception:
                            pass
                        print(f"      Preview: {body[:500]}\n")
                    else:
                        print(f"  [Review JSON — {len(body)} bytes, no order IDs]")

        OUT.write_text(json.dumps(captured, indent=2, ensure_ascii=False))
        with_orders = [c for c in captured if c["orderIds"]]
        print(f"\n{'='*60}")
        print(f"Total review/order responses: {len(captured)}")
        print(f"With order IDs:               {len(with_orders)}")
        print(f"Saved → {OUT}")

if __name__ == "__main__":
    asyncio.run(main())
